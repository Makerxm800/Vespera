//! Extension registry for the Tauri build.
//!
//! Chrome extensions cannot execute inside Tauri's webview engine (no
//! chrome-extension:// scheme or Extension API), so installing or loading them
//! is reported honestly. The registry keeps the Extensions page fully
//! functional for everything that is local: the built-in grid and catalog come
//! from src/shared/extensions.mjs in the renderer, and enable/disable/remove
//! manage the persisted state so the UI stays consistent.

use serde_json::{json, Value};
use std::sync::Mutex;

pub struct ExtensionRegistry {
    /// Metadata for locally managed extensions (mirrors the old shell's
    /// extensionMetadata pref).
    pub metadata: Vec<Value>,
}

const UNSUPPORTED: &str = "Chrome extensions can't run inside Vespera's Tauri webview engine — there is no Chromium extension runtime. The Extensions page still manages Vespera's built-in features and your saved extensions.";

impl ExtensionRegistry {
    pub fn new(metadata: Vec<Value>) -> Self {
        ExtensionRegistry { metadata }
    }

    /// List installed extensions in the shape the Extensions page expects.
    pub fn list(&self, disabled_ids: &[String]) -> Vec<Value> {
        self.metadata
            .iter()
            .filter(|m| !disabled_ids.contains(m.get("id").and_then(Value::as_str).unwrap_or("")))
            .map(|m| {
                let enabled = !disabled_ids.contains(m.get("id").and_then(Value::as_str).unwrap_or(""));
                let mut entry = m.clone();
                entry["enabled"] = json!(enabled);
                entry
            })
            .collect()
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool, disabled_ids: &mut Vec<String>) -> Value {
        if !self.metadata.iter().any(|m| m.get("id").and_then(Value::as_str) == Some(id)) {
            return json!({ "ok": false, "message": "That extension is not installed." });
        }
        if enabled {
            disabled_ids.retain(|d| d != id);
        } else if !disabled_ids.contains(&id.to_string()) {
            disabled_ids.push(id.to_string());
        }
        json!({ "ok": true, "extensions": self.list(disabled_ids) })
    }

    pub fn remove(&mut self, id: &str) -> Value {
        let before = self.metadata.len();
        self.metadata.retain(|m| m.get("id").and_then(Value::as_str) != Some(id));
        if self.metadata.len() == before {
            return json!({ "ok": false, "message": "That extension is not installed." });
        }
        json!({ "ok": true, "extensions": self.list(&[]) })
    }

    pub fn install(&self) -> Value {
        json!({ "ok": false, "message": UNSUPPORTED })
    }

    pub fn load_unpacked(&self) -> Value {
        json!({ "ok": false, "message": UNSUPPORTED })
    }

    pub fn install_from_store(&self, _url: &str) -> Value {
        json!({ "ok": false, "message": UNSUPPORTED })
    }
}

/// Bundled catalog mirror (src/shared/extensions.mjs) — available for tools.
pub fn bundled_catalog() -> Value {
    include_str!("../assets/extensions.json")
        .parse::<Value>()
        .unwrap_or_else(|_| json!({ "builtins": [], "catalog": [] }))
}

pub type SharedRegistry = Mutex<ExtensionRegistry>;
