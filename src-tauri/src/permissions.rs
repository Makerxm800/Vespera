//! Site permission rules — Rust port of src/shared/permissions.js.
//!
//! Pure functions so the policy is unit-testable without any webview.

use serde_json::{json, Map, Value};

const ALWAYS_ALLOWED: [&str; 2] = ["fullscreen", "clipboard-sanitized-write"];
const ASKABLE: [&str; 3] = ["media", "geolocation", "notifications"];

fn is_always_allowed(permission: &str) -> bool {
    ALWAYS_ALLOWED.contains(&permission)
}

fn is_askable(permission: &str) -> bool {
    ASKABLE.contains(&permission)
}

pub fn origin_of(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    if u.scheme() == "http" || u.scheme() == "https" {
        Some(u.origin().to_string())
    } else {
        None
    }
}

pub fn normalize_store(value: Value) -> Value {
    let mut store = Map::new();
    let Some(obj) = value.as_object() else {
        return Value::Object(store);
    };
    for (origin, perms) in obj {
        let Some(origin_ok) = origin_of(origin) else {
            continue;
        };
        let Some(perms_obj) = perms.as_object() else {
            continue;
        };
        let mut kept = Map::new();
        for (permission, verdict) in perms_obj {
            if is_askable(permission)
                && (verdict == "allow" || verdict == "deny")
            {
                kept.insert(permission.clone(), verdict.clone());
            }
        }
        if !kept.is_empty() {
            store.insert(origin_ok, Value::Object(kept));
        }
    }
    Value::Object(store)
}

/// @returns 'allow' | 'deny' | 'ask'
pub fn decide(
    permission: &str,
    origin: &str,
    private_mode: bool,
    remembered: &Value,
    session_granted: &[String],
) -> &'static str {
    if is_always_allowed(permission) {
        return "allow";
    }
    if !is_askable(permission) || private_mode || origin.is_empty() {
        return "deny";
    }
    if let Some(saved) = remembered
        .get(origin)
        .and_then(|o| o.get(permission))
        .and_then(Value::as_str)
    {
        if saved == "allow" || saved == "deny" {
            return saved;
        }
    }
    if session_granted.contains(&format!("{origin}|{permission}")) {
        return "allow";
    }
    "ask"
}

pub fn set_decision(store: &mut Value, origin: &str, permission: &str, verdict: &str) -> bool {
    if origin_of(origin).is_none() || !is_askable(permission) || !(verdict == "allow" || verdict == "deny") {
        return false;
    }
    if let Some(obj) = store.as_object_mut() {
        let entry = obj.entry(origin.to_string()).or_insert_with(|| Value::Object(Map::new()));
        if let Some(perms) = entry.as_object_mut() {
            perms.insert(permission.to_string(), Value::String(verdict.to_string()));
            return true;
        }
    }
    false
}

pub fn reset(store: &mut Value) {
    if let Some(obj) = store.as_object_mut() {
        obj.clear();
    }
}

pub fn summarize(store: &Value) -> Value {
    let Some(obj) = store.as_object() else {
        return json!([]);
    };
    let mut out = Vec::new();
    for (origin, perms) in obj {
        if let Some(perms_obj) = perms.as_object() {
            for (permission, verdict) in perms_obj {
                out.push(json!({ "origin": origin, "permission": permission, "verdict": verdict }));
            }
        }
    }
    Value::Array(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_allowed_and_deny_paths() {
        assert_eq!(decide("fullscreen", "https://a.com", false, &json!({}), &[]), "allow");
        assert_eq!(decide("clipboard-sanitized-write", "https://a.com", false, &json!({}), &[]), "allow");
        assert_eq!(decide("media", "https://a.com", false, &json!({}), &[]), "ask");
        assert_eq!(decide("media", "https://a.com", true, &json!({}), &[]), "deny");
        assert_eq!(decide("midi", "https://a.com", false, &json!({}), &[]), "deny");
        assert_eq!(decide("media", "", false, &json!({}), &[]), "deny");
    }

    #[test]
    fn remembered_and_session_grants() {
        let remembered = json!({ "https://a.com": { "media": "allow" } });
        assert_eq!(decide("media", "https://a.com", false, &remembered, &[]), "allow");
        assert_eq!(
            decide("media", "https://a.com", false, &json!({}), &["https://a.com|media".to_string()]),
            "allow"
        );
        assert_eq!(decide("media", "https://a.com", false, &json!({}), &[]), "ask");
    }

    #[test]
    fn normalize_drops_junk() {
        let store = json!({
            "https://a.com": { "media": "allow", "junk": "x" },
            "not-a-url": { "media": "deny" },
            "https://b.com": { "media": "bogus" }
        });
        let cleaned = normalize_store(store);
        assert_eq!(cleaned.get("https://a.com").unwrap().get("media").unwrap(), "allow");
        assert!(cleaned.get("not-a-url").is_none());
        assert!(cleaned.get("https://b.com").is_none());
    }
}
