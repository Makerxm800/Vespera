//! Default-browser registration (port of the former shell's protocol client
//! handling). Best effort per platform: Windows via the UserChoice registry
//! entries, Linux via xdg-settings, macOS via a clear system-settings message.

use serde_json::json;
use std::process::Command;

fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn windows_registered(scheme: &str) -> bool {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\Shell\Associations\URLAssociations",
            &format!("{scheme}\\UserChoice"),
            "/v",
            "ProgId",
        ])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("vespera"),
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
fn windows_register() -> Result<bool, String> {
    let exe = exe_path();
    if exe.is_empty() {
        return Err("Could not locate the Vespera executable.".to_string());
    }
    let command = format!("\"{exe}\" \"%1\"");
    let icon = format!("\"{exe}\"");
    let prog_id = "Vespera";
    for scheme in ["http", "https"] {
        let steps = [
            format!(r"reg add "HKCU\Software\Classes\{prog_id}" /v "" /t REG_SZ /d "Vespera" /f"),
            format!(r"reg add "HKCU\Software\Classes\{prog_id}\shell\open\command" /v "" /t REG_SZ /d "{command}" /f"),
            format!(r"reg add "HKCU\Software\Classes\{prog_id}\DefaultIcon" /v "" /t REG_SZ /d "{icon}" /f"),
            format!(r"reg add "HKCU\Software\Microsoft\Windows\Shell\Associations\URLAssociations\{scheme}\UserChoice" /v ProgId /t REG_SZ /d {prog_id} /f"),
        ];
        for step in steps {
            let mut parts: Vec<&str> = step.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }
            let status = Command::new(&parts[0]).args(&parts[1..]).status();
            if !matches!(status, Ok(s) if s.success()) {
                return Err("The operating system declined the registration. Confirm Vespera in the Windows default-apps settings.".to_string());
            }
        }
    }
    Ok(windows_registered("http") && windows_registered("https"))
}

#[cfg(target_os = "linux")]
fn linux_registered() -> bool {
    let output = Command::new("xdg-settings").arg("get").arg("default-web-browser").output();
    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_lowercase();
            text.contains("vespera")
        }
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn linux_register() -> Result<bool, String> {
    let desktop = "vespera.desktop";
    let data_home = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/.local/share")
    });
    let dir = std::path::Path::new(&data_home).join("applications");
    if std::fs::create_dir_all(&dir).is_err() {
        return Err("Could not create the applications folder.".to_string());
    }
    let exe = exe_path();
    let desktop_file = format!(
        "[Desktop Entry]\nType=Application\nName=Vespera\nExec={exe} %U\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;\n"
    );
    std::fs::write(dir.join(desktop), desktop_file).map_err(|e| format!("Could not write the desktop file. ({e})"))?;
    let status = Command::new("xdg-settings").arg("set").arg("default-web-browser").arg(desktop).status();
    match status {
        Ok(s) if s.success() => Ok(linux_registered()),
        _ => Err("The desktop environment declined the registration. Set Vespera in your system's default-applications settings.".to_string()),
    }
}

pub fn status() -> serde_json::Value {
    let platform = std::env::consts::OS;
    #[cfg(target_os = "windows")]
    {
        let http = windows_registered("http");
        let https = windows_registered("https");
        return json!({ "supported": true, "registered": http && https, "http": http, "https": https, "platform": platform });
    }
    #[cfg(target_os = "linux")]
    {
        let registered = linux_registered();
        return json!({ "supported": true, "registered": registered, "http": registered, "https": registered, "platform": platform });
    }
    #[cfg(target_os = "macos")]
    {
        return json!({
            "supported": false,
            "registered": false,
            "platform": platform,
            "message": "macOS manages the default browser in System Settings → Desktop → Default Applications. Choose Vespera there to make it the default."
        });
    }
    #[allow(unreachable_code)]
    json!({ "supported": false, "registered": false, "platform": platform, "message": "Default-browser registration is not available on this platform." })
}

pub fn register() -> serde_json::Value {
    let platform = std::env::consts::OS;
    #[cfg(target_os = "windows")]
    let result: Result<bool, String> = windows_register();
    #[cfg(target_os = "linux")]
    let result: Result<bool, String> = linux_register();
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let result: Result<bool, String> = Err("Default-browser registration is not available on this platform.".to_string());
    match result {
        Ok(registered) => json!({ "ok": registered, "registered": registered, "platform": platform }),
        Err(message) => json!({ "ok": false, "registered": false, "platform": platform, "message": message }),
    }
}

pub fn open_settings() -> serde_json::Value {
    let target = if std::env::consts::OS == "windows" {
        "ms-settings:defaultapps"
    } else if std::env::consts::OS == "macos" {
        "x-apple.systempreferences:com.apple._default-apps"
    } else {
        "xdg-settings:default-applications"
    };
    let status = if std::env::consts::OS == "windows" {
        Command::new("cmd").args(["/c", "start", "", target]).status()
    } else {
        Command::new("xdg-open").arg(target).status()
    };
    match status {
        Ok(s) if s.success() => json!({ "ok": true }),
        Ok(_) => json!({ "ok": false, "message": "Could not open the system settings." }),
        Err(e) => json!({ "ok": false, "message": format!("Could not open the system settings. ({e})") }),
    }
}
