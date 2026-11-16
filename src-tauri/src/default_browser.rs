//! Default-browser registration (port of the former shell's protocol client
//! handling). Best effort per platform: Windows protocol registration plus
//! the supported Default Apps UI, Linux via xdg-settings, and macOS via a clear
//! system-settings message.

use serde_json::json;
use std::process::Command;

fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn windows_registered(scheme: &str) -> bool {
    let key = format!(
        r"HKCU\Software\Microsoft\Windows\Shell\Associations\URLAssociations\{scheme}\UserChoice"
    );
    let output = Command::new("reg")
        .args(["query"])
        .arg(key)
        .args(["/v", "ProgId"])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("vespera"),
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
fn windows_registry_add(key: &str, name: &str, value: &str) -> Result<(), String> {
    // Pass each registry argument directly to reg.exe. Building a shell command
    // and splitting it on whitespace breaks paths containing spaces and also
    // cannot safely quote the "%1" argument.
    let mut command = Command::new("reg");
    command.args(["add", key]);
    if name.is_empty() {
        command.arg("/ve");
    } else {
        command.args(["/v", name]);
    }
    let status = command
        .args(["/t", "REG_SZ", "/d", value, "/f"])
        .status()
        .map_err(|e| format!("Could not run reg.exe. ({e})"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Windows declined to register Vespera's URL handlers.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn windows_register() -> Result<bool, String> {
    let exe = exe_path();
    if exe.is_empty() {
        return Err("Could not locate the Vespera executable.".to_string());
    }

    // Windows protects URLAssociations\\*\\UserChoice with a system-generated
    // hash. Register the protocol classes here and let the supported Default
    // Apps settings UI set the user's choice.
    let prog_id = "VesperaURL";
    let class_key = format!(r"HKCU\Software\Classes\{prog_id}");
    let command_key = format!(r"{class_key}\shell\open\command");
    let icon_key = format!(r"{class_key}\DefaultIcon");
    let command = format!(r#""{exe}" "%1""#);
    let icon = format!(r#""{exe}",0"#);

    windows_registry_add(&class_key, "", "Vespera URL")?;
    windows_registry_add(&class_key, "URL Protocol", "")?;
    windows_registry_add(&command_key, "", &command)?;
    windows_registry_add(&icon_key, "", &icon)?;
    for scheme in ["http", "https"] {
        let scheme_key = format!(r"HKCU\Software\Classes\{scheme}");
        windows_registry_add(&scheme_key, "", prog_id)?;
        windows_registry_add(&scheme_key, "URL Protocol", "")?;
    }

    // Register the capabilities so Vespera appears in Windows Default Apps.
    let capabilities = r"HKCU\Software\Vespera\Capabilities";
    windows_registry_add(capabilities, "ApplicationName", "Vespera")?;
    windows_registry_add(capabilities, "ApplicationDescription", "Vespera Browser")?;
    for scheme in ["http", "https"] {
        let associations = format!(r"{capabilities}\URLAssociations");
        windows_registry_add(&associations, scheme, prog_id)?;
    }
    windows_registry_add(
        r"HKCU\Software\RegisteredApplications",
        "Vespera",
        r"Software\Vespera\Capabilities",
    )?;

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
        return json!({
            "supported": true,
            "registered": http && https,
            "http": http,
            "https": https,
            "platform": platform,
            "message": if http && https { "Vespera is the default browser for HTTP and HTTPS." } else { "To finish, choose Vespera under Default apps in Windows Settings." }
        });
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
    {
        return match windows_register() {
            Ok(registered) => json!({
                "ok": true,
                "registered": registered,
                "platform": platform,
                "message": if registered {
                    "Vespera is already the default browser for HTTP and HTTPS."
                } else {
                    "Vespera's URL handlers are registered. Choose Vespera under Default apps in Windows Settings to finish."
                }
            }),
            Err(message) => json!({ "ok": false, "registered": false, "platform": platform, "message": message }),
        };
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "linux")]
        let result: Result<bool, String> = linux_register();
        #[cfg(not(target_os = "linux"))]
        let result: Result<bool, String> = Err("Default-browser registration is not available on this platform.".to_string());
        match result {
            Ok(registered) => json!({ "ok": registered, "registered": registered, "platform": platform }),
            Err(message) => json!({ "ok": false, "registered": false, "platform": platform, "message": message }),
        }
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
