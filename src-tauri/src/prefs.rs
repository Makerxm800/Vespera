//! Preferences store — JSON file persisted atomically (port of the prefs
//! handling in the former Electron main).

use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

pub struct Prefs {
    pub data: Value,
    pub path: std::path::PathBuf,
}

pub fn default_prefs() -> Value {
    json!({
        "shields": {
            "enabled": true,
            "blockTrackers": true,
            "blockAds": true,
            "blockAnnoyances": false,
            "cleanLinks": true,
            "httpsOnly": true,
            "gpc": true
        },
        "allowlist": {},
        "askDownloadLocation": true,
        "downloadPath": "",
        "extensionPaths": [],
        "disabledExtensionIds": [],
        "extensionMetadata": [],
        "sitePermissions": {}
    })
}

impl Prefs {
    pub fn load(path: &Path) -> Self {
        let data = match fs::read_to_string(path) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(saved) if saved.is_object() => merge_defaults(&saved),
                _ => default_prefs(),
            },
            Err(_) => default_prefs(),
        };
        Prefs {
            data,
            path: path.to_path_buf(),
        }
    }

    pub fn persist(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(&self.data)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
        }
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Merge a saved object over the defaults (same rules as the old shell).
    fn apply_saved(base: &mut Value, saved: &Value) {
        if let (Some(base), Some(saved)) = (base.as_object_mut(), saved.as_object()) {
            for (k, v) in saved {
                if k == "shields" {
                    if let (Some(bs), Some(ss)) = (base.get_mut("shields").and_then(Value::as_object_mut), v.as_object()) {
                        for (sk, sv) in ss {
                            bs.insert(sk.clone(), sv.clone());
                        }
                    }
                } else {
                    base.insert(k.clone(), v.clone());
                }
            }
        }
    }

    pub fn merge(&mut self, value: &Value) {
        let mut merged = self.data.clone();
        if let (Some(base), Some(incoming)) = (merged.as_object_mut(), value.as_object()) {
            for (k, v) in incoming {
                if k == "shields" {
                    if let (Some(bs), Some(ss)) = (base.get_mut("shields").and_then(Value::as_object_mut), v.as_object()) {
                        for (sk, sv) in ss {
                            bs.insert(sk.clone(), sv.clone());
                        }
                    }
                } else if k == "allowlist" {
                    if let (Some(al), Some(iv)) = (base.get_mut("allowlist").and_then(Value::as_object_mut), v.as_object()) {
                        for (ak, av) in iv {
                            al.insert(ak.clone(), av.clone());
                        }
                    }
                } else if k == "extensionPaths" {
                    if !v.is_array() {
                        continue;
                    }
                    base.insert(k.clone(), v.clone());
                } else {
                    base.insert(k.clone(), v.clone());
                }
            }
            base.remove("wallpaperData");
        }
        // Normalize remembered site permissions (drop junk entries).
        if let Some(sp) = merged.get_mut("sitePermissions") {
            *sp = crate::permissions::normalize_store(sp.clone());
        }
        self.data = merged;
    }

    pub fn shield_mask(&self) -> u32 {
        let s = self.data.get("shields").cloned().unwrap_or(json!({}));
        let b = |key: &str| s.get(key).and_then(Value::as_bool).unwrap_or(false);
        let mut mask = 0u32;
        if b("enabled") {
            mask |= 1;
        }
        if b("blockTrackers") {
            mask |= 2;
        }
        if b("blockAds") {
            mask |= 4;
        }
        if b("blockAnnoyances") {
            mask |= 8;
        }
        if b("gpc") {
            mask |= 16;
        }
        if let Some(allowlist) = self.data.get("allowlist").and_then(Value::as_object) {
            for host in allowlist.keys() {
                if crate::permissions::origin_of(host).is_some() {
                    mask |= 32;
                    break;
                }
            }
        }
        mask
    }
}

fn merge_defaults(saved: &Value) -> Value {
    let mut base = default_prefs();
    Prefs::apply_saved(&mut base, saved);
    if let Some(sp) = base.get_mut("sitePermissions") {
        *sp = crate::permissions::normalize_store(sp.clone());
    }
    base
}

pub fn shield_mask_from_value(shields: &Map<String, Value>, allowlist: &Map<String, Value>) -> u32 {
    let b = |key: &str| shields.get(key).and_then(Value::as_bool).unwrap_or(false);
    let mut mask = 0u32;
    if b("enabled") {
        mask |= 1;
    }
    if b("blockTrackers") {
        mask |= 2;
    }
    if b("blockAds") {
        mask |= 4;
    }
    if b("blockAnnoyances") {
        mask |= 8;
    }
    if b("gpc") {
        mask |= 16;
    }
    if allowlist.values().any(|v| v.as_bool().unwrap_or(false)) {
        mask |= 32;
    }
    mask
}
