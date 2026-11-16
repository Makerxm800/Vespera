//! GitHub Releases updater — Rust port of electron/update.js.
//! Checks the latest release, picks the installer for the current platform and
//! launches it (quitting afterwards on Windows so the installer can replace
//! the files), exactly like the Electron updater did.

use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const RELEASES_API: &str = "https://api.github.com/repos/Makerxm800/Vespera/releases/latest";

fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |v: &str| -> Vec<u64> {
        v.split('.')
            .map(|p| p.trim_start_matches('v').parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (x, y) = (parse(a), parse(b));
    let len = x.len().max(y.len());
    for i in 0..len {
        let xi = *x.get(i).unwrap_or(&0);
        let yi = *y.get(i).unwrap_or(&0);
        if xi != yi {
            return if xi > yi { 1 } else { -1 };
        }
    }
    0
}

pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn pick_asset(release: &Value) -> Option<(String, String)> {
    let tag = release.get("tag_name").and_then(Value::as_str).unwrap_or("");
    let version = tag.trim_start_matches('v');
    let assets = release.get("assets").and_then(Value::as_array)?;
    let find = |candidates: &[String]| -> Option<(String, String)> {
        for name in candidates {
            if let Some(asset) = assets
                .iter()
                .find(|a| a.get("name").and_then(Value::as_str) == Some(name.as_str()))
            {
                let url = asset.get("browser_download_url").and_then(Value::as_str).unwrap_or("");
                return Some((name.clone(), url.to_string()));
            }
        }
        None
    };
    if std::env::consts::OS == "windows" {
        find(&[format!("Vespera-Setup-{version}.exe"), format!("Vespera-Portable-{version}.exe")])
    } else if std::env::consts::OS == "macos" {
        let arch = if std::env::consts::ARCH == "aarch64" { "arm64" } else { "x64" };
        find(&[format!("Vespera-{version}-mac-{arch}.dmg")])
    } else {
        find(&[
            format!("Vespera-{version}-linux-x86_64.AppImage"),
            format!("Vespera-{version}-linux-amd64.deb"),
        ])
    }
}

pub fn check(app: &AppHandle) -> Value {
    let current = current_version();
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(format!("Vespera/{current}"))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return json!({ "ok": false, "current": current, "latest": "", "hasUpdate": false, "message": e.to_string() });
        }
    };
    let response = match client.get(RELEASES_API).send() {
        Ok(r) => r,
        Err(e) => {
            return json!({ "ok": false, "current": current, "latest": "", "hasUpdate": false, "message": e.to_string() });
        }
    };
    let release: Value = match response.json() {
        Ok(v) => v,
        Err(e) => {
            return json!({ "ok": false, "current": current, "latest": "", "hasUpdate": false, "message": e.to_string() });
        }
    };
    let latest = release.get("tag_name").and_then(Value::as_str).unwrap_or("").replacen('v', "", 1);
    json!({
        "ok": true,
        "current": current,
        "latest": latest,
        "hasUpdate": compare_versions(&latest, &current) > 0,
        "url": release.get("html_url").and_then(Value::as_str).unwrap_or("https://github.com/Makerxm800/Vespera/releases"),
        "publishedAt": release.get("published_at").and_then(Value::as_str).unwrap_or(""),
        "notes": release.get("body").and_then(Value::as_str).unwrap_or("").chars().take(4000).collect::<String>(),
    })
}

pub fn install(app: &AppHandle, release_info: &Value) -> Value {
    let current = current_version();
    let latest = release_info
        .get("latest")
        .and_then(Value::as_str)
        .unwrap_or("")
        .replacen('v', "", 1);
    if compare_versions(&latest, &current) <= 0 {
        return json!({ "ok": false, "message": "This is already the latest version of Vespera." });
    }
    let response = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(format!("Vespera/{current}"))
        .build()
        .and_then(|c| c.get(RELEASES_API).send())
    {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "message": e.to_string() }),
    };
    let release: Value = match response.json() {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "message": e.to_string() }),
    };
    let Some((asset_name, asset_url)) = pick_asset(&release) else {
        return json!({ "ok": false, "message": "No installer for your platform was published with this release." });
    };

    let dir = std::env::temp_dir().join(format!("vespera-update-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        return json!({ "ok": false, "message": "Could not create the update folder." });
    }
    let file_path: PathBuf = dir.join(&asset_name);
    let download = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .and_then(|c| c.get(&asset_url).send())
    {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "message": e.to_string() }),
    };
    let bytes = match download.bytes() {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "message": e.to_string() }),
    };
    if let Err(e) = std::fs::write(&file_path, &bytes) {
        return json!({ "ok": false, "message": format!("Could not save the update file. ({e})") });
    }

    #[cfg(target_os = "windows")]
    {
        let path = file_path.to_string_lossy().to_string();
        let _ = std::process::Command::new(&path).spawn();
        // Let the installer take over the files, then leave the app.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2500));
            app.exit(0);
        });
        json!({ "ok": true, "message": "The Vespera installer is launching. Vespera will close so the new build can be installed.", "latest": latest })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let path = file_path.to_string_lossy().to_string();
        let opener = if std::env::consts::OS == "macos" { "open" } else { "xdg-open" };
        let _ = std::process::Command::new(opener).arg(&path).status();
        json!({ "ok": true, "message": "The Vespera installer is opening. Install it to update Vespera.", "latest": latest })
    }
}

/// Startup auto-check helper: returns the update result for the renderer's
/// scheduleUpdateCheck, or a quiet failure when offline.
pub fn auto_check(app: &AppHandle) -> Value {
    let result = check(app);
    if result.get("ok").and_then(Value::as_bool).unwrap_or(false) && result.get("hasUpdate").and_then(Value::as_bool).unwrap_or(false) {
        result
    } else {
        json!({ "ok": false, "message": "No update available right now." })
    }
}

#[allow(dead_code)]
fn _manager_hint(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some()
}
