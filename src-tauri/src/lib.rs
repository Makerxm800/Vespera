//! Vespera — Tauri v2 shell. Wires the local server, downloads, updates,
//! extensions registry and the IPC commands the renderer bridge calls.

pub mod default_browser;
pub mod downloads;
pub mod extensions;
pub mod filters;
pub mod logs;
pub mod permissions;
pub mod prefs;
pub mod proxy;
pub mod server;
pub mod state;
pub mod update;
pub mod window;

use prefs::Prefs;
use serde_json::{json, Value};
use state::AppState;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Data locations: VESPERA_DATA wins for dev/test, then the
            // platform app-data directory.
            let data_dir = match std::env::var("VESPERA_DATA") {
                Ok(dir) if !dir.is_empty() => std::path::PathBuf::from(dir),
                _ => app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("Could not resolve the app data directory: {e}"))?
                    .to_path_buf(),
            };
            std::fs::create_dir_all(&data_dir).ok();

            let prefs_path = data_dir.join("preferences.json");
            let prefs = Prefs::load(&prefs_path);
            let mut disabled_ids: Vec<String> = prefs
                .data
                .get("disabledExtensionIds")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let metadata: Vec<Value> = prefs
                .data
                .get("extensionMetadata")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let registry = extensions::ExtensionRegistry::new(metadata);
            let extensions_state = std::sync::Arc::new(std::sync::Mutex::new(registry));

            let logs_dir = data_dir.join("logs");
            let log_path = logs_dir.join("vespera.log");
            let _ = std::fs::create_dir_all(&logs_dir);

            let downloads_dir = prefs
                .data
                .get("downloadPath")
                .and_then(Value::as_str)
                .filter(|p| !p.is_empty() && std::path::Path::new(p).exists())
                .map(|p| std::path::PathBuf::from(p))
                .unwrap_or_else(default_downloads_dir);
            let downloads_manager = downloads::DownloadManager::new(&data_dir, &downloads_dir, app_handle.clone());
            downloads::register_manager(std::sync::Arc::clone(&downloads_manager));

            let proxy = std::sync::Arc::new(proxy::ProxyEngine::new());
            let rules_snapshot = proxy.rules_snapshot();

            let server_handle = server::start(
                std::sync::Arc::clone(&proxy),
                rules_snapshot.clone(),
                env!("CARGO_PKG_VERSION").to_string(),
            )
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

            let state = AppState {
                data_dir: data_dir.clone(),
                prefs: std::sync::Mutex::new(prefs),
                prefs_path,
                logs: std::sync::Mutex::new(Vec::new()),
                log_path,
                downloads: downloads_manager,
                extensions: std::sync::Arc::clone(&extensions_state),
                proxy,
                server_origin: std::sync::Mutex::new(server_handle.origin.clone()),
                rules_snapshot,
            };
            app_handle.manage(state);

            let window_url = server_handle.url("/index.html");
            eprintln!("  Vespera UI → {window_url}");
            let _ = WebviewWindowBuilder::new(&app_handle, "main", WebviewUrl::External(url::Url::parse(&window_url).unwrap()))
                .title("Vespera")
                .inner_size(1320.0, 860.0)
                .min_inner_size(720.0, 500.0)
                .decorations(false)
                .build();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // window
            window_minimize,
            window_maximize,
            window_close,
            window_fullscreen_toggle,
            window_incognito,
            // prefs + app
            prefs_save,
            app_version,
            app_read_log,
            app_log_path,
            app_open_logs,
            app_default_browser_status,
            app_default_browser,
            app_open_default_browser_settings,
            tabs_memory,
            app_update_check,
            app_update_install,
            app_inspect_tab,
            // downloads
            downloads_list,
            downloads_start,
            downloads_action,
            downloads_clear,
            downloads_choose_folder,
            downloads_folder,
            // permissions
            permissions_list,
            permissions_reset,
            // extensions
            extensions_list,
            extensions_install,
            extensions_load_unpacked,
            extensions_install_store,
            extensions_enable,
            extensions_disable,
            extensions_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vespera");
}

fn default_downloads_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        return std::path::PathBuf::from("downloads");
    }
    std::path::PathBuf::from(home).join("Downloads")
}

// ---------------------------------------------------------------------------
// Commands — names mirror the channels the renderer bridge calls.
// ---------------------------------------------------------------------------

#[tauri::command]
fn window_minimize(app: AppHandle) -> Result<(), String> {
    window::minimize(&app)
}

#[tauri::command]
fn window_maximize(app: AppHandle) -> Result<(), String> {
    window::maximize(&app)
}

#[tauri::command]
fn window_close(app: AppHandle) -> Result<(), String> {
    window::close(&app)
}

#[tauri::command]
fn window_fullscreen_toggle(app: AppHandle) -> Result<(), String> {
    window::toggle_fullscreen(&app)
}

#[tauri::command]
fn window_incognito(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    let base = state.server_origin.lock().unwrap().clone();
    window::incognito(&app, &base)
}

#[tauri::command]
fn prefs_save(state: tauri::State<AppState>, value: Value) -> Result<Value, String> {
    if !value.is_object() {
        return Ok(json!({ "ok": true }));
    }
    let mut guard = state.prefs.lock().unwrap();
    guard.merge(&value);
    guard.persist().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn app_version() -> String {
    update::current_version()
}

#[tauri::command]
fn app_read_log(state: tauri::State<AppState>) -> String {
    logs::read_tail(&state.log_path, 400)
}

#[tauri::command]
fn app_log_path(state: tauri::State<AppState>) -> String {
    state.log_path.to_string_lossy().to_string()
}

#[tauri::command]
fn app_open_logs(state: tauri::State<AppState>) -> Value {
    match logs::open_dir(state.log_path.parent().unwrap_or(&state.data_dir)) {
        Ok(()) => json!({ "ok": true, "path": state.log_path.parent().unwrap_or(&state.data_dir).to_string_lossy() }),
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
fn app_default_browser_status() -> Value {
    default_browser::status()
}

#[tauri::command]
fn app_default_browser() -> Value {
    default_browser::register()
}

#[tauri::command]
fn app_open_default_browser_settings() -> Value {
    default_browser::open_settings()
}

#[tauri::command]
fn tabs_memory() -> Value {
    match window::tab_memory() {
        Ok(bytes) => json!({ "ok": true, "bytes": bytes }),
        Err(e) => json!({ "ok": false, "message": e }),
    }
}

#[tauri::command]
fn app_update_check(app: AppHandle) -> Value {
    update::check(&app)
}

#[tauri::command]
fn app_update_install(app: AppHandle, release_info: Value) -> Value {
    update::install(&app, &release_info)
}

#[tauri::command]
fn app_inspect_tab(app: AppHandle) -> Value {
    match window::inspect_tab(&app) {
        Ok(()) => json!({ "ok": true }),
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
fn downloads_list(state: tauri::State<AppState>, private: bool) -> Value {
    let guard = state.downloads.lock().unwrap();
    json!(guard.list(private))
}

#[tauri::command]
async fn downloads_start(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    private: bool,
    options: Option<Value>,
) -> Result<Value, String> {
    match url::Url::parse(&url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => {},
        _ => return Ok(json!({ "ok": false, "message": "Only HTTP and HTTPS files can be downloaded." })),
    }
    let requested_name = options.as_ref().and_then(|value| value.get("name"))
        .and_then(Value::as_str).map(str::to_string);
    let filename = downloads::suggested_filename(&url, requested_name.as_deref());
    let (ask_location, folder) = {
        let prefs = state.prefs.lock().unwrap();
        let configured_ask = prefs.data.get("askDownloadLocation").and_then(Value::as_bool).unwrap_or(true);
        let ask = options.as_ref().and_then(|value| value.get("askLocation")).and_then(Value::as_bool).unwrap_or(configured_ask);
        let folder = match options.as_ref().and_then(|value| value.get("folder")) {
            Some(Value::String(path)) if !path.trim().is_empty() => Some(std::path::PathBuf::from(path)),
            Some(_) => None,
            None => prefs.data.get("downloadPath").and_then(Value::as_str)
                .filter(|path| !path.trim().is_empty())
                .map(std::path::PathBuf::from),
        };
        (ask, folder)
    };

    let target_path = if ask_location {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.dialog()
            .file()
            .set_title("Save downloaded file")
            .set_file_name(filename.clone())
            .save_file(move |selection| {
                let _ = sender.send(selection);
            });
        let selection = match tauri::async_runtime::spawn_blocking(move || receiver.recv()).await {
            Ok(Ok(selection)) => selection,
            Ok(Err(error)) => return Ok(json!({ "ok": false, "message": error.to_string() })),
            Err(error) => return Ok(json!({ "ok": false, "message": error.to_string() })),
        };
        let Some(selection) = selection else { return Ok(json!({ "ok": false, "canceled": true })); };
        match selection.into_path() {
            Ok(path) => Some(path),
            Err(error) => return Ok(json!({ "ok": false, "message": error.to_string() })),
        }
    } else {
        folder.filter(|path| path.is_dir()).map(|path| path.join(&filename))
    };

    let mut guard = state.downloads.lock().unwrap();
    match guard.start(&url, private, target_path) {
        Ok(value) => Ok(value),
        Err(message) => Ok(json!({ "ok": false, "message": message })),
    }
}

#[tauri::command]
fn downloads_action(state: tauri::State<AppState>, action: String, id: String, private: bool) -> Value {
    let mut guard = state.downloads.lock().unwrap();
    match guard.action(&action, &id, private) {
        Ok(v) => v,
        Err(message) => json!({ "ok": false, "message": message }),
    }
}

#[tauri::command]
fn downloads_clear(state: tauri::State<AppState>, private: bool) -> Value {
    state.downloads.lock().unwrap().clear(private);
    json!({ "ok": true })
}

#[tauri::command]
async fn downloads_choose_folder(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Choose download folder")
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = match tauri::async_runtime::spawn_blocking(move || receiver.recv()).await {
        Ok(Ok(selection)) => selection,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(e) => return Err(e.to_string()),
    };
    let Some(path) = selection else {
        return Ok(json!({ "ok": false, "canceled": true }));
    };
    let path = path.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    let mut guard = state.prefs.lock().unwrap();
    if let Some(obj) = guard.data.as_object_mut() {
        obj.insert("downloadPath".to_string(), Value::String(path.clone()));
    }
    guard.persist().map_err(|e| e.to_string())?;
    drop(guard);
    state.downloads.lock().unwrap().set_folder(std::path::PathBuf::from(&path));
    Ok(json!({ "ok": true, "path": path }))
}

#[tauri::command]
fn downloads_folder(state: tauri::State<AppState>) -> Value {
    let path = state.downloads.lock().unwrap().folder();
    json!({ "ok": true, "path": path.to_string_lossy() })
}

#[tauri::command]
fn permissions_list(state: tauri::State<AppState>) -> Value {
    let guard = state.prefs.lock().unwrap();
    let store = guard
        .data
        .get("sitePermissions")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default()));
    permissions::summarize(&store)
}

#[tauri::command]
fn permissions_reset(state: tauri::State<AppState>) -> Value {
    let mut guard = state.prefs.lock().unwrap();
    if let Some(store) = guard.data.as_object_mut().and_then(|o| o.get_mut("sitePermissions")) {
        permissions::reset(store);
    }
    let _ = guard.persist();
    json!({ "ok": true })
}

#[tauri::command]
fn extensions_list(state: tauri::State<AppState>) -> Value {
    let disabled: Vec<String> = {
        let guard = state.prefs.lock().unwrap();
        guard
            .data
            .get("disabledExtensionIds")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default()
    };
    let registry = state.extensions.lock().unwrap();
    json!(registry.list(&disabled))
}

#[tauri::command]
fn extensions_install(state: tauri::State<AppState>) -> Value {
    state.extensions.lock().unwrap().install()
}

#[tauri::command]
fn extensions_load_unpacked(state: tauri::State<AppState>) -> Value {
    state.extensions.lock().unwrap().load_unpacked()
}

#[tauri::command]
fn extensions_install_store(state: tauri::State<AppState>, url: String) -> Value {
    state.extensions.lock().unwrap().install_from_store(&url)
}

#[tauri::command]
fn extensions_enable(state: tauri::State<AppState>, id: String) -> Value {
    set_extension_enabled(&state, &id, true)
}

#[tauri::command]
fn extensions_disable(state: tauri::State<AppState>, id: String) -> Value {
    set_extension_enabled(&state, &id, false)
}

fn set_extension_enabled(state: &tauri::State<AppState>, id: &str, enabled: bool) -> Value {
    let mut guard = state.prefs.lock().unwrap();
    let mut disabled_ids = guard
        .data
        .get_mut("disabledExtensionIds")
        .and_then(Value::as_array_mut)
        .map(|a| {
            a.iter_mut()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    let mut registry = state.extensions.lock().unwrap();
    let result = registry.set_enabled(id, enabled, &mut disabled_ids);
    if let Some(obj) = guard.data.as_object_mut() {
        obj.insert("disabledExtensionIds".to_string(), json!(disabled_ids));
    }
    let _ = guard.persist();
    result
}

#[tauri::command]
fn extensions_remove(state: tauri::State<AppState>, id: String) -> Value {
    state.extensions.lock().unwrap().remove(&id)
}
