//! Window controls, private windows, tab inspect and process memory.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

pub fn minimize(app: &AppHandle) -> Result<(), String> {
    main_window(app)
        .ok_or_else(|| "No main window.".to_string())?
        .minimize()
        .map_err(|e| e.to_string())
}

pub fn maximize(app: &AppHandle) -> Result<(), String> {
    let win = main_window(app).ok_or_else(|| "No main window.".to_string())?;
    if win.is_maximized().map_err(|e| e.to_string())? {
        win.unmaximize().map_err(|e| e.to_string())?;
        app.emit("window:maximized", false).map_err(|e| e.to_string())?;
    } else {
        win.maximize().map_err(|e| e.to_string())?;
        app.emit("window:maximized", true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    main_window(app)
        .ok_or_else(|| "No main window.".to_string())?
        .close()
        .map_err(|e| e.to_string())
}

pub fn toggle_fullscreen(app: &AppHandle) -> Result<(), String> {
    let win = main_window(app).ok_or_else(|| "No main window.".to_string())?;
    let next = !win.is_fullscreen().map_err(|e| e.to_string())?;
    win.set_fullscreen(next).map_err(|e| e.to_string())?;
    app.emit("browser:fullscreen", next).map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a private window (fresh session, no persisted state).
pub fn incognito(app: &AppHandle, base_url: &str) -> Result<(), String> {
    let url = format!("{base_url}?private=1");
    let target = url::Url::parse(&url).map_err(|e| format!("Invalid window URL: {e}"))?;
    let _ = WebviewWindowBuilder::new(app, "private", WebviewUrl::External(target))
        .title("Vespera — Private")
        .inner_size(1320.0, 860.0)
        .min_inner_size(720.0, 500.0)
        .decorations(false)
        .build();
    Ok(())
}

/// Open the developer tools for the page (Tauri webviews expose devtools for
/// the window; in proxy mode every tab's page runs in that webview).
pub fn inspect_tab(app: &AppHandle) -> Result<(), String> {
    let win = main_window(app).ok_or_else(|| "That tab has no web page to inspect.".to_string())?;
    win.open_devtools();
    Ok(())
}

/// Process memory for the memory display (the whole browser process, since the
/// Tauri webview is a single engine).
pub fn tab_memory() -> Result<u64, String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    let pids = [pid];
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    system
        .process(pid)
        .map(|process| process.memory())
        .ok_or_else(|| "Could not read Vespera's process memory.".to_string())
}

#[allow(dead_code)]
pub fn memory_summary() -> serde_json::Value {
    json!({ "ok": true, "bytes": tab_memory().unwrap_or(0) })
}
