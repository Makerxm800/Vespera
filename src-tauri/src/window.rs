//! Window controls, private windows, tab inspect and process memory.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

fn main_window<'a>(app: &'a AppHandle) -> Option<tauri::WebviewWindow<'a>> {
    app.get_webview_window("main")
}

pub fn minimize(app: &AppHandle) -> Result<(), String> {
    main_window(app).map(|w| w.minimize()).ok_or_else(|| "No main window.".to_string())
}

pub fn maximize(app: &AppHandle) -> Result<(), String> {
    let win = main_window(app).ok_or_else(|| "No main window.".to_string())?;
    if win.is_maximized() {
        win.unmaximize();
        app.emit("window:maximized", false);
    } else {
        win.maximize();
        app.emit("window:maximized", true);
    }
    Ok(())
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    main_window(app).map(|w| w.close()).ok_or_else(|| "No main window.".to_string())
}

pub fn toggle_fullscreen(app: &AppHandle) -> Result<(), String> {
    let win = main_window(app).ok_or_else(|| "No main window.".to_string())?;
    let next = !win.is_fullscreen();
    win.set_fullscreen(next);
    app.emit("browser:fullscreen", next);
    Ok(())
}

/// Open a private window (fresh session, no persisted state).
pub fn incognito(app: &AppHandle, base_url: &str) -> Result<(), String> {
    let url = format!("{base_url}?private=1");
    let target = url::Url::parse(&url).map_err(|e| format!("Invalid window URL: {e}"))?;
    let _ = WebviewWindowBuilder::new(app, "private", WebviewUrl::Url(target))
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
    use sysinfo::{Pid, Process};
    let pid = Pid::from_u32(std::process::id());
    let process = Process::new(pid);
    Ok(process.memory())
}

#[allow(dead_code)]
pub fn memory_summary() -> serde_json::Value {
    json!({ "ok": true, "bytes": tab_memory().unwrap_or(0) })
}
