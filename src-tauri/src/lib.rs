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
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// The first http(s) address in a command line (what the OS passes when Vespera
/// is the default browser and the user opens a link). Skips the program name.
pub fn launch_url_from_args<S: AsRef<str>>(args: &[S]) -> Option<String> {
    args.iter()
        .skip(1)
        .map(|a| a.as_ref().trim().trim_matches('"'))
        .find(|a| {
            let lower = a.to_ascii_lowercase();
            (lower.starts_with("http://") || lower.starts_with("https://")) && url::Url::parse(a).is_ok()
        })
        .map(|a| a.to_string())
}

fn focus_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Open a link from outside the app in a new tab of the running window.
fn open_external_url(app: &AppHandle, url: &str) {
    focus_main_window(app);
    let _ = app.emit("browser:new-tab", json!({ "url": url, "foreground": true }));
}

pub fn run() {
    let app = tauri::Builder::default()
        // Must be registered first: a second launch (for example clicking a
        // link while Vespera is the default browser) hands its address to the
        // running window instead of opening a second browser.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            match launch_url_from_args(&argv) {
                Some(url) => open_external_url(app, &url),
                None => focus_main_window(app),
            }
        }))
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
            let disabled_ids: Vec<String> = prefs
                .data
                .get("disabledExtensionIds")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let registry = extensions::ExtensionRegistry::load(data_dir.join("extensions"));
            let injections = registry.injections(&disabled_ids);
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
            proxy.set_injections(injections);
            let rules_snapshot = proxy.rules_snapshot();

            let server_handle = server::start(
                std::sync::Arc::clone(&proxy),
                std::sync::Arc::clone(&extensions_state),
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
                launch_url: std::sync::Mutex::new(launch_url_from_args(&std::env::args().collect::<Vec<_>>())),
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
            app_take_launch_url,
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
        .build(tauri::generate_context!())
        .expect("error while building Vespera");

    app.run(|_app, _event| {
        // macOS delivers links opened with Vespera as the default browser as
        // an event, not as command-line arguments.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if matches!(url.scheme(), "http" | "https") {
                    open_external_url(_app, url.as_str());
                }
            }
        }
    });
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

/// The link Vespera was launched with (cold start as the default browser).
/// Returned once, then cleared.
#[tauri::command]
fn app_take_launch_url(state: tauri::State<AppState>) -> Option<String> {
    state.launch_url.lock().ok().and_then(|mut guard| guard.take())
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
fn downloads_start(state: tauri::State<AppState>, url: String, private: bool) -> Value {
    let mut guard = state.downloads.lock().unwrap();
    match guard.start(&url, private) {
        Ok(v) => v,
        Err(message) => json!({ "ok": false, "message": message }),
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
    let _ = guard.persist();
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

fn disabled_ids(state: &AppState) -> Vec<String> {
    let guard = state.prefs.lock().unwrap();
    guard
        .data
        .get("disabledExtensionIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

fn store_disabled_ids(state: &AppState, ids: &[String]) {
    let mut guard = state.prefs.lock().unwrap();
    if let Some(obj) = guard.data.as_object_mut() {
        obj.insert("disabledExtensionIds".to_string(), json!(ids));
    }
    let _ = guard.persist();
}

/// Push the current extension set to the page injector and tell the UI.
fn sync_extensions(app: &AppHandle, state: &AppState) -> Vec<Value> {
    let disabled = disabled_ids(state);
    let registry = state.extensions.lock().unwrap();
    state.proxy.set_injections(registry.injections(&disabled));
    let list = registry.list(&disabled);
    drop(registry);
    let _ = app.emit("browser:extensions-changed", &list);
    list
}

fn install_outcome(app: &AppHandle, state: &AppState, outcome: Result<(String, String, Option<String>), String>) -> Value {
    match outcome {
        Ok((id, name, note)) => {
            // A (re)installed extension starts enabled.
            let mut disabled = disabled_ids(state);
            if disabled.iter().any(|d| d == &id) {
                disabled.retain(|d| d != &id);
                store_disabled_ids(state, &disabled);
            }
            state.log(format!("Extension installed: {name} ({id})"));
            let list = sync_extensions(app, state);
            json!({ "ok": true, "id": id, "name": name, "note": note, "extensions": list })
        }
        Err(message) => {
            state.log(format!("Extension install failed: {message}"));
            json!({ "ok": false, "message": message })
        }
    }
}

/// Native file or folder picker. `None` means the user cancelled.
async fn pick_path(app: &AppHandle, folder: bool) -> Result<Option<std::path::PathBuf>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let builder = app.dialog().file();
    if folder {
        builder
            .set_title("Choose an unpacked extension folder")
            .pick_folder(move |selection| {
                let _ = sender.send(selection);
            });
    } else {
        builder
            .set_title("Choose an extension package")
            .add_filter("Extension package", &["zip", "crx"])
            .pick_file(move |selection| {
                let _ = sender.send(selection);
            });
    }
    let selection = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    match selection {
        Some(path) => Ok(Some(path.into_path().map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

fn download_package(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Could not start the download. ({e})"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Could not download the extension. Check your connection. ({e})"))?;
    if !response.status().is_success() {
        return Err(format!("The download failed (HTTP {}). The extension may be unavailable.", response.status().as_u16()));
    }
    let bytes = response.bytes().map_err(|e| format!("The download was interrupted. ({e})"))?;
    if bytes.is_empty() {
        return Err("The store returned nothing for this extension. It may be unavailable or removed.".to_string());
    }
    if bytes.len() > 100 * 1024 * 1024 {
        return Err("The extension download is too large.".to_string());
    }
    Ok(bytes.to_vec())
}

#[tauri::command]
fn extensions_list(state: tauri::State<AppState>) -> Value {
    let disabled = disabled_ids(&state);
    let registry = state.extensions.lock().unwrap();
    json!(registry.list(&disabled))
}

#[tauri::command]
async fn extensions_install(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let Some(path) = pick_path(&app, false).await? else {
        return Ok(json!({ "ok": false, "canceled": true }));
    };
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) => return Ok(json!({ "ok": false, "message": format!("Could not read that file. ({e})") })),
    };
    let outcome = state.extensions.lock().unwrap().install_package(&bytes, None);
    Ok(install_outcome(&app, &state, outcome))
}

#[tauri::command]
async fn extensions_load_unpacked(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let Some(path) = pick_path(&app, true).await? else {
        return Ok(json!({ "ok": false, "canceled": true }));
    };
    let outcome = state.extensions.lock().unwrap().install_folder(&path);
    Ok(install_outcome(&app, &state, outcome))
}

#[tauri::command]
async fn extensions_install_store(app: AppHandle, state: tauri::State<'_, AppState>, url: String) -> Result<Value, String> {
    let url = url.trim().to_string();
    let (download_url, id) = if let Some(id) = extensions::store_extension_id(&url) {
        (extensions::store_download_url(&id), Some(id))
    } else {
        let path = url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
        if url.starts_with("https://") && (path.ends_with(".zip") || path.ends_with(".crx")) {
            (url.clone(), None)
        } else {
            return Ok(json!({ "ok": false, "message": "Paste a Chrome Web Store link, or a direct https link to a .zip or .crx package." }));
        }
    };
    let bytes = match tauri::async_runtime::spawn_blocking(move || download_package(&download_url))
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(bytes) => bytes,
        Err(message) => return Ok(json!({ "ok": false, "message": message })),
    };
    let outcome = state.extensions.lock().unwrap().install_package(&bytes, id.as_deref());
    Ok(install_outcome(&app, &state, outcome))
}

#[tauri::command]
fn extensions_enable(app: AppHandle, state: tauri::State<AppState>, id: String) -> Value {
    set_extension_enabled(&app, &state, &id, true)
}

#[tauri::command]
fn extensions_disable(app: AppHandle, state: tauri::State<AppState>, id: String) -> Value {
    set_extension_enabled(&app, &state, &id, false)
}

fn set_extension_enabled(app: &AppHandle, state: &AppState, id: &str, enabled: bool) -> Value {
    if !state.extensions.lock().unwrap().contains(id) {
        return json!({ "ok": false, "message": "That extension is not installed." });
    }
    let mut disabled = disabled_ids(state);
    if enabled {
        disabled.retain(|d| d != id);
    } else if !disabled.iter().any(|d| d == id) {
        disabled.push(id.to_string());
    }
    store_disabled_ids(state, &disabled);
    let list = sync_extensions(app, state);
    json!({ "ok": true, "extensions": list })
}

#[tauri::command]
fn extensions_remove(app: AppHandle, state: tauri::State<AppState>, id: String) -> Value {
    let removed = state.extensions.lock().unwrap().remove(&id);
    match removed {
        Ok(()) => {
            let mut disabled = disabled_ids(&state);
            if disabled.iter().any(|d| d == &id) {
                disabled.retain(|d| d != &id);
                store_disabled_ids(&state, &disabled);
            }
            let list = sync_extensions(&app, &state);
            json!({ "ok": true, "extensions": list })
        }
        Err(message) => json!({ "ok": false, "message": message }),
    }
}
