//! Shared application state for the Vespera Tauri shell.

use crate::downloads::DownloadManager;
use crate::extensions::ExtensionRegistry;
use crate::prefs::Prefs;
use crate::proxy::ProxyEngine;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub data_dir: PathBuf,
    pub prefs: Mutex<Prefs>,
    pub prefs_path: PathBuf,
    pub logs: Mutex<Vec<String>>,
    pub log_path: PathBuf,
    pub downloads: Arc<Mutex<DownloadManager>>,
    pub extensions: Arc<Mutex<ExtensionRegistry>>,
    pub proxy: Arc<ProxyEngine>,
    /// Origin the local server is reachable at (e.g. http://127.0.0.1:4600).
    pub server_origin: Mutex<String>,
    /// Rules snapshot served at /api/filters so shield counts match the proxy.
    pub rules_snapshot: Value,
    /// Link the app was launched with (default-browser cold start), taken once by the UI.
    pub launch_url: Mutex<Option<String>>,
}

impl AppState {
    pub fn log(&self, line: String) {
        let stamp = now_stamp();
        if let Ok(mut guard) = self.logs.lock() {
            guard.push(format!("[{stamp}] {line}"));
            if guard.len() > 2000 {
                let overflow = guard.len() - 2000;
                guard.drain(0..overflow);
            }
        }
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            use std::io::Write;
            let _ = writeln!(file, "[{stamp}] {line}");
        }
    }
}

pub fn now_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Local-ish UTC timestamp, compact.
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}")
}

/// Days-from-civil inverse (Howard Hinnant's algorithm) — no chrono dependency.
fn civil_from_unix(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mo0 = (doy + 306) / 153;
    let d = (doy - mo0 * 153 + 2) % 30 + 1;
    let mo = if mo0 < 10 { mo0 + 3 } else { mo0 - 9 };
    (if mo <= 2 { y + 1 } else { y }, mo as u32, d as u32, h as u32, mi as u32, s as u32)
}
