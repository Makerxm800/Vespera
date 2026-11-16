//! Download manager — Rust port of the former Electron download manager.
//! Streams HTTP(S) files to the downloads folder and emits the same
//! `download:started` / `download:updated` / `download:done` events the UI
//! listens for.

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
pub struct DownloadRecord {
    pub id: String,
    pub name: String,
    pub url: String,
    pub path: String,
    pub size: u64,
    pub received: u64,
    pub status: String,
    pub at: u64,
    pub can_resume: bool,
    pub is_private: bool,
    pub error: String,
}

impl DownloadRecord {
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "path": self.path,
            "size": self.size,
            "received": self.received,
            "status": self.status,
            "at": self.at,
            "canResume": self.can_resume,
        })
    }
}

pub struct DownloadManager {
    pub records: Vec<DownloadRecord>,
    records_path: PathBuf,
    downloads_dir: PathBuf,
    emitter: AppHandle,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn random_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("dl-{nanos:x}-{:x}", std::process::id())
}

fn safe_filename(url: &str) -> String {
    let name = url::Url::parse(url)
        .ok()
        .map(|u| u.path().rsplit('/').next().unwrap_or("download").to_string())
        .unwrap_or_else(|| "download".to_string());
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = if cleaned.is_empty() { "download".to_string() } else { cleaned };
    cleaned.chars().take(150).collect()
}

impl DownloadManager {
    pub fn new(
        data_dir: &std::path::Path,
        downloads_dir: &std::path::Path,
        emitter: AppHandle,
    ) -> Arc<Mutex<Self>> {
        let records_path = data_dir.join("downloads.json");
        let records = match fs::read_to_string(&records_path) {
            Ok(raw) => serde_json::from_str::<Vec<Value>>(&raw)
                .unwrap_or_default()
                .into_iter()
                .map(|v| DownloadRecord {
                    id: v.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                    name: v.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                    url: v.get("url").and_then(Value::as_str).unwrap_or_default().to_string(),
                    path: v.get("path").and_then(Value::as_str).unwrap_or_default().to_string(),
                    size: v.get("size").and_then(Value::as_u64).unwrap_or(0),
                    received: v.get("received").and_then(Value::as_u64).unwrap_or(0),
                    // Old in-flight records are interrupts after a restart.
                    status: match v.get("status").and_then(Value::as_str).unwrap_or("") {
                        "progressing" | "paused" => "interrupted".to_string(),
                        other => other.to_string(),
                    },
                    at: v.get("at").and_then(Value::as_u64).unwrap_or(0),
                    can_resume: false,
                    is_private: false,
                    error: String::new(),
                })
                .filter(|r| !r.id.is_empty())
                .collect(),
            Err(_) => Vec::new(),
        };
        Arc::new(Mutex::new(DownloadManager {
            records,
            records_path,
            downloads_dir: downloads_dir.to_path_buf(),
            emitter,
        }))
    }

    fn persist(&self) {
        let _ = fs::create_dir_all(&self.downloads_dir);
        let values: Vec<Value> = self.records.iter().map(|r| r.to_json()).collect();
        let _ = fs::write(&self.records_path, serde_json::to_string_pretty(&values).unwrap_or_default());
    }

    fn emit_started(&self, record: &DownloadRecord) {
        let _ = self.emitter.emit("download:started", record.to_json());
    }

    fn emit_updated(&self, record: &DownloadRecord) {
        let _ = self.emitter.emit("download:updated", record.to_json());
    }

    fn emit_done(&self, record: &DownloadRecord) {
        let _ = self.emitter.emit("download:done", record.to_json());
    }

    pub fn list(&self, is_private: bool) -> Vec<Value> {
        self.records
            .iter()
            .filter(|r| r.is_private == is_private)
            .map(|r| r.to_json())
            .collect()
    }

    pub fn start(&mut self, url: &str, is_private: bool) -> Result<Value, String> {
        let parsed = url::Url::parse(url)
            .map_err(|_| "Only HTTP and HTTPS files can be downloaded.".to_string())?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Only HTTP and HTTPS files can be downloaded.".to_string());
        }
        let _ = fs::create_dir_all(&self.downloads_dir);
        let record = DownloadRecord {
            id: random_id(),
            name: safe_filename(url),
            url: url.to_string(),
            path: String::new(),
            size: 0,
            received: 0,
            status: "progressing".to_string(),
            at: now_ms(),
            can_resume: true,
            is_private,
            error: String::new(),
        };
        {
            let mut guard = self.records.clone();
            guard.retain(|r| !(r.is_private == is_private && r.status == "progressing" && r.url == url));
            guard.insert(0, record.clone());
            if guard.len() > 100 {
                guard.truncate(100);
            }
            self.records = guard;
        }
        self.persist();
        self.emit_started(&record);

        let target_path = self.downloads_dir.join(&record.name);
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .map_err(|e| format!("Download client failed: {e}"))?;
        let record_id = record.id.clone();
        let emitter = self.emitter.clone();
        let records_path = self.records_path.clone();
        let record_name = record.name.clone();
        let record_at = record.at;
        let record_url = record.url.clone();
        let record_private = record.is_private;

        std::thread::spawn(move || {
            let result = (|| -> Result<(u64, u64), String> {
                let mut resp = client
                    .get(&record_url)
                    .send()
                    .map_err(|e| format!("The file could not be downloaded. ({e})"))?;
                if !resp.status().is_success() {
                    return Err(format!("The server returned {} for this file.", resp.status()));
                }
                let total = resp.content_length().unwrap_or(0);
                let mut file = std::fs::File::create(&target_path)
                    .map_err(|e| format!("Could not write the file. ({e})"))?;
                let mut received = 0u64;
                let mut last_emit = now_ms();
                let mut buffer = [0u8; 32 * 1024];
                loop {
                    use std::io::{Read, Write};
                    let count = resp.read(&mut buffer).map_err(|e| format!("Download interrupted. ({e})"))?;
                    if count == 0 {
                        break;
                    }
                    file.write_all(&buffer[..count]).map_err(|e| format!("Could not write the file. ({e})"))?;
                    received += count as u64;
                    if now_ms() - last_emit > 400 {
                        last_emit = now_ms();
                        let entry = DownloadRecord {
                            id: record_id.clone(),
                            name: record_name.clone(),
                            url: record_url.clone(),
                            path: target_path.to_string_lossy().to_string(),
                            size: total,
                            received,
                            status: "progressing".to_string(),
                            at: record_at,
                            can_resume: true,
                            is_private: record_private,
                            error: String::new(),
                        };
                        let _ = emitter.emit("download:updated", entry.to_json());
                    }
                }
                Ok((received, total))
            })();

            let manager = {
            let guard = managers().lock().unwrap();
            guard.get(&records_path.to_string_lossy().to_string()).cloned()
            };
            let Some(manager) = manager else { return };
            let mut guard = manager.lock().unwrap();
            if let Some(entry) = guard.records.iter_mut().find(|r| r.id == record_id) {
                match result {
                    Ok((received, total)) => {
                        entry.received = received;
                        entry.size = total;
                        entry.path = target_path.to_string_lossy().to_string();
                        entry.status = "completed".to_string();
                        entry.can_resume = false;
                    }
                    Err(err) => {
                        entry.status = "interrupted".to_string();
                        entry.error = err;
                    }
                }
                let snapshot = entry.clone();
                drop(guard);
                manager.lock().unwrap().persist();
                let _ = emitter.emit("download:done", snapshot.to_json());
            }
        });

        Ok(json!({ "ok": true }))
    }

    pub fn action(&mut self, action: &str, id: &str, is_private: bool) -> Result<Value, String> {
        let record = self
            .records
            .iter()
            .find(|r| r.id == id && r.is_private == is_private)
            .ok_or_else(|| "This download is no longer in the list.".to_string())?;

        if action == "open" || action == "show" {
            if record.status != "completed" || record.path.is_empty() || !std::path::Path::new(&record.path).exists() {
                return Err("The file has been moved, deleted, or is not finished.".to_string());
            }
            let target = record.path.clone();
            let opener = if std::env::consts::OS == "windows" {
                "explorer"
            } else if std::env::consts::OS == "macos" {
                "open"
            } else {
                "xdg-open"
            };
            let _ = std::process::Command::new(opener).arg(&target).status();
            return Ok(json!({ "ok": true }));
        }

        // Cancel/pause/resume: the streaming worker notices the state change on
        // its next progress tick and finalizes the record.
        if action == "cancel" {
            if let Some(entry) = self.records.iter_mut().find(|r| r.id == id) {
                entry.status = "cancelled".to_string();
                entry.can_resume = false;
            }
            self.persist();
            return Ok(json!({ "ok": true }));
        }
        if action == "pause" {
            if let Some(entry) = self.records.iter_mut().find(|r| r.id == id) {
                entry.status = "paused".to_string();
                entry.can_resume = true;
            }
            self.persist();
            return Ok(json!({ "ok": true }));
        }
        if action == "resume" {
            if let Some(entry) = self.records.iter_mut().find(|r| r.id == id) {
                if entry.status == "interrupted" || entry.status == "paused" {
                    let url = entry.url.clone();
                    let private = entry.is_private;
                    entry.status = "progressing".to_string();
                    entry.can_resume = true;
                    self.persist();
                    return self.start(&url, private);
                }
            }
            return Err("This download cannot be resumed. Please retry it.".to_string());
        }
        Err("This download cannot be resumed. Please retry it.".to_string())
    }

    pub fn clear(&mut self, is_private: bool) {
        self.records
            .retain(|r| !(r.is_private == is_private && matches!(r.status.as_str(), "progressing" | "paused")));
        self.persist();
    }

    pub fn folder(&self) -> PathBuf {
        self.downloads_dir.clone()
    }
}

/// Every live DownloadManager keyed by its records path, so background
/// download threads can find the manager that owns a record.
static MANAGERS: OnceLock<Mutex<std::collections::HashMap<String, Arc<Mutex<DownloadManager>>>>> = OnceLock::new();

fn managers() -> &'static Mutex<std::collections::HashMap<String, Arc<Mutex<DownloadManager>>>> {
    MANAGERS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub fn register_manager(manager: Arc<Mutex<DownloadManager>>) {
    let key = manager
        .lock()
        .map(|m| m.records_path.to_string_lossy().to_string())
        .unwrap_or_default();
    if let Ok(mut guard) = managers().lock() {
        guard.insert(key, manager);
    }
}
