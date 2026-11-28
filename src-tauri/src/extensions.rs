//! Extension runtime for the Tauri build.
//!
//! Tauri's system webview has no Chromium extension host, so Vespera runs
//! extensions itself. Pages are already rendered through Vespera's local
//! proxy, which lets the proxy inject an extension's *content scripts* and
//! *content-script CSS* into every page whose URL matches the extension's
//! `content_scripts[].matches`, together with a small `chrome.*` shim
//! (`runtime`, `storage`, `i18n`, `extension`).
//!
//! What works: content scripts, injected stylesheets, extension-hosted assets
//! (`chrome.runtime.getURL`) and local `chrome.storage`.
//! What does not: background pages / service workers, popups, `webRequest`.
//! Extensions that depend only on those are installed but flagged honestly.
//!
//! Extensions live on disk in `<data>/extensions/<id>/`. The folder is the
//! source of truth: the registry is rebuilt by scanning it at startup.

use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// One `content_scripts` entry with its files already read from disk.
#[derive(Clone, Debug)]
pub struct ContentScript {
    pub matches: Vec<String>,
    pub exclude_matches: Vec<String>,
    pub js: String,
    pub css: String,
    pub run_at: String,
}

/// An installed extension.
#[derive(Clone, Debug)]
pub struct Extension {
    pub id: String,
    pub dir: PathBuf,
    pub manifest: Value,
    pub name: String,
    pub version: String,
    pub description: String,
    pub manifest_version: u64,
    pub permissions: Vec<String>,
    pub host_permissions: Vec<String>,
    pub icon: Option<String>,
    pub scripts: Vec<ContentScript>,
}

/// What the proxy needs to inject for an enabled extension.
#[derive(Clone, Debug)]
pub struct Injection {
    pub ext_id: String,
    pub manifest_json: String,
    pub script: ContentScript,
}

pub struct ExtensionRegistry {
    pub dir: PathBuf,
    pub items: Vec<Extension>,
}

pub type SharedRegistry = std::sync::Arc<Mutex<ExtensionRegistry>>;

const MAX_ICON_BYTES: u64 = 300 * 1024;
const MAX_SCRIPT_BYTES: u64 = 8 * 1024 * 1024;

impl ExtensionRegistry {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let mut registry = ExtensionRegistry { dir, items: Vec::new() };
        registry.rescan();
        registry
    }

    /// Re-read every extension folder.
    pub fn rescan(&mut self) {
        let mut items = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if !path.is_dir() || name.starts_with('.') {
                    continue;
                }
                if let Ok(ext) = read_extension(&name, &path) {
                    items.push(ext);
                }
            }
        }
        items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        self.items = items;
    }

    fn is_enabled(id: &str, disabled_ids: &[String]) -> bool {
        !disabled_ids.iter().any(|d| d == id)
    }

    /// List installed extensions in the shape the Extensions page expects.
    pub fn list(&self, disabled_ids: &[String]) -> Vec<Value> {
        self.items
            .iter()
            .map(|ext| {
                let has_scripts = !ext.scripts.is_empty();
                json!({
                    "id": ext.id,
                    "name": ext.name,
                    "version": ext.version,
                    "description": ext.description,
                    "manifestVersion": ext.manifest_version,
                    "permissions": ext.permissions,
                    "hostPermissions": ext.host_permissions,
                    "icon": ext.icon,
                    "enabled": Self::is_enabled(&ext.id, disabled_ids),
                    "runsOnPages": has_scripts,
                    "actionTitle": if has_scripts { Value::Null } else { json!("No page scripts: it only uses features Vespera cannot run yet") },
                })
            })
            .collect()
    }

    /// The injections the proxy applies to pages (enabled extensions only).
    pub fn injections(&self, disabled_ids: &[String]) -> Vec<Injection> {
        let mut out = Vec::new();
        for ext in &self.items {
            if !Self::is_enabled(&ext.id, disabled_ids) {
                continue;
            }
            let manifest_json = json!({
                "name": ext.name,
                "version": ext.version,
                "manifest_version": ext.manifest_version,
                "description": ext.description,
            })
            .to_string();
            for script in &ext.scripts {
                out.push(Injection {
                    ext_id: ext.id.clone(),
                    manifest_json: manifest_json.clone(),
                    script: script.clone(),
                });
            }
        }
        out
    }

    pub fn contains(&self, id: &str) -> bool {
        self.items.iter().any(|e| e.id == id)
    }

    /// Absolute path of a file inside an extension, or None when it escapes
    /// the extension folder or does not exist.
    pub fn resolve_file(&self, id: &str, rel: &str) -> Option<PathBuf> {
        if !self.contains(id) {
            return None;
        }
        let base = self.dir.join(id);
        let safe = safe_join(&base, rel)?;
        if safe.is_file() {
            Some(safe)
        } else {
            None
        }
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if !self.contains(id) {
            return Err("That extension is not installed.".to_string());
        }
        let dir = self.dir.join(id);
        fs::remove_dir_all(&dir).map_err(|e| format!("Could not remove the extension files. ({e})"))?;
        self.rescan();
        Ok(())
    }

    /// Install a `.zip` or `.crx` package. Returns (id, name, note).
    pub fn install_package(&mut self, bytes: &[u8], preferred_id: Option<&str>) -> Result<(String, String, Option<String>), String> {
        let zip_bytes = strip_crx_header(bytes)?;
        let staging = self.dir.join(format!(".staging-{}", unique_suffix()));
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(&staging).map_err(|e| format!("Could not prepare the install folder. ({e})"))?;
        let result = (|| {
            extract_zip(zip_bytes, &staging)?;
            let root = find_manifest_root(&staging)?;
            self.finish_install(&root, preferred_id, false)
        })();
        let _ = fs::remove_dir_all(&staging);
        result
    }

    /// Install (copy) an unpacked folder.
    pub fn install_folder(&mut self, folder: &Path) -> Result<(String, String, Option<String>), String> {
        let root = if folder.join("manifest.json").is_file() {
            folder.to_path_buf()
        } else {
            find_manifest_root(folder)?
        };
        self.finish_install(&root, None, true)
    }

    fn finish_install(&mut self, root: &Path, preferred_id: Option<&str>, copy: bool) -> Result<(String, String, Option<String>), String> {
        let manifest_text = fs::read_to_string(root.join("manifest.json"))
            .map_err(|_| "This package has no manifest.json, so it is not a Chrome extension.".to_string())?;
        // Validate before touching the extension store.
        let probe = parse_manifest(&manifest_text)?;
        let name = resolve_name(root, &probe);
        let id = match preferred_id {
            Some(id) if is_safe_id(id) => id.to_string(),
            _ => format!("{}-{}", slug(&name), fnv_hex(&manifest_text)),
        };
        let target = self.dir.join(&id);
        let _ = fs::remove_dir_all(&target);
        if copy {
            copy_dir(root, &target)?;
        } else if fs::rename(root, &target).is_err() {
            copy_dir(root, &target)?;
        }
        self.rescan();
        let ext = self
            .items
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(|| "The extension was copied but could not be read back.".to_string())?;
        let note = if ext.scripts.is_empty() {
            Some(format!(
                "{} installed, but it has no page scripts. Vespera runs content scripts; background pages, popups and request blocking are not supported yet, so it may do nothing visible.",
                ext.name
            ))
        } else {
            None
        };
        Ok((ext.id.clone(), ext.name.clone(), note))
    }
}

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

fn parse_manifest(text: &str) -> Result<Value, String> {
    let text = text.trim_start_matches('\u{feff}');
    let value: Value = serde_json::from_str(text).map_err(|e| format!("manifest.json is not valid JSON. ({e})"))?;
    if !value.is_object() {
        return Err("manifest.json is not a valid extension manifest.".to_string());
    }
    if value.get("name").and_then(Value::as_str).is_none() || value.get("version").and_then(Value::as_str).is_none() {
        return Err("manifest.json must have a name and a version.".to_string());
    }
    Ok(value)
}

fn str_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

fn looks_like_host_pattern(s: &str) -> bool {
    s == "<all_urls>" || s.contains("://")
}

/// Resolve `__MSG_key__` strings from `_locales`.
fn localize(root: &Path, manifest: &Value, text: &str) -> String {
    let Some(key) = text.strip_prefix("__MSG_").and_then(|t| t.strip_suffix("__")) else {
        return text.to_string();
    };
    let default_locale = manifest.get("default_locale").and_then(Value::as_str).unwrap_or("en");
    for locale in [default_locale, "en", "en_US"] {
        let path = root.join("_locales").join(locale).join("messages.json");
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}')) {
                for (k, v) in map {
                    if k.eq_ignore_ascii_case(key) {
                        if let Some(m) = v.get("message").and_then(Value::as_str) {
                            return m.to_string();
                        }
                    }
                }
            }
        }
    }
    text.to_string()
}

fn resolve_name(root: &Path, manifest: &Value) -> String {
    let raw = manifest.get("name").and_then(Value::as_str).unwrap_or("Extension");
    let name = localize(root, manifest, raw);
    if name.trim().is_empty() {
        "Extension".to_string()
    } else {
        name
    }
}

fn read_text_limited(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_SCRIPT_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string())
}

fn read_extension(id: &str, dir: &Path) -> Result<Extension, String> {
    let text = fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?;
    let manifest = parse_manifest(&text)?;
    let name = resolve_name(dir, &manifest);
    let version = manifest.get("version").and_then(Value::as_str).unwrap_or("0").to_string();
    let description = localize(dir, &manifest, manifest.get("description").and_then(Value::as_str).unwrap_or(""));
    let manifest_version = manifest.get("manifest_version").and_then(Value::as_u64).unwrap_or(2);

    let mut permissions = Vec::new();
    let mut host_permissions = str_list(manifest.get("host_permissions"));
    for p in str_list(manifest.get("permissions")).into_iter().chain(str_list(manifest.get("optional_permissions"))) {
        if looks_like_host_pattern(&p) {
            host_permissions.push(p);
        } else {
            permissions.push(p);
        }
    }

    let mut scripts = Vec::new();
    if let Some(entries) = manifest.get("content_scripts").and_then(Value::as_array) {
        for entry in entries {
            let matches = str_list(entry.get("matches"));
            if matches.is_empty() {
                continue;
            }
            let mut js = String::new();
            for file in str_list(entry.get("js")) {
                if let Some(path) = safe_join(dir, &file) {
                    if let Some(src) = read_text_limited(&path) {
                        js.push_str(&src);
                        js.push_str("\n;\n");
                    }
                }
            }
            let mut css = String::new();
            for file in str_list(entry.get("css")) {
                if let Some(path) = safe_join(dir, &file) {
                    if let Some(src) = read_text_limited(&path) {
                        css.push_str(&src);
                        css.push('\n');
                    }
                }
            }
            if js.is_empty() && css.is_empty() {
                continue;
            }
            scripts.push(ContentScript {
                matches,
                exclude_matches: str_list(entry.get("exclude_matches")),
                js,
                css,
                run_at: entry.get("run_at").and_then(Value::as_str).unwrap_or("document_idle").to_string(),
            });
        }
    }

    Ok(Extension {
        id: id.to_string(),
        dir: dir.to_path_buf(),
        icon: read_icon(dir, &manifest),
        manifest,
        name,
        version,
        description,
        manifest_version,
        permissions,
        host_permissions,
        scripts,
    })
}

fn read_icon(dir: &Path, manifest: &Value) -> Option<String> {
    let mut candidates: Vec<(u32, String)> = Vec::new();
    let mut collect = |v: Option<&Value>| match v {
        Some(Value::Object(map)) => {
            for (k, val) in map {
                if let (Ok(size), Some(path)) = (k.parse::<u32>(), val.as_str()) {
                    candidates.push((size, path.to_string()));
                }
            }
        }
        Some(Value::String(path)) => candidates.push((16, path.clone())),
        _ => {}
    };
    collect(manifest.get("icons"));
    collect(manifest.pointer("/action/default_icon"));
    collect(manifest.pointer("/browser_action/default_icon"));
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, rel) in candidates {
        let Some(path) = safe_join(dir, &rel) else { continue };
        let mime = match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("gif") => "image/gif",
            _ => continue,
        };
        if fs::metadata(&path).map(|m| m.len() > MAX_ICON_BYTES).unwrap_or(true) {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            return Some(format!("data:{mime};base64,{}", base64_encode(&bytes)));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Match patterns
// ---------------------------------------------------------------------------

/// Chrome match-pattern check for http(s) pages.
pub fn url_matches(pattern: &str, url: &url::Url) -> bool {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let pattern = pattern.trim();
    if pattern == "<all_urls>" {
        return true;
    }
    let Some((pscheme, rest)) = pattern.split_once("://") else { return false };
    let scheme_ok = match pscheme {
        "*" => true,
        "http" | "https" => pscheme == scheme,
        _ => false,
    };
    if !scheme_ok {
        return false;
    }
    let (phost, ppath) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/*"),
    };
    let host = url.host_str().unwrap_or("").to_lowercase();
    let phost = phost.to_lowercase();
    let host_ok = if phost == "*" {
        true
    } else if let Some(base) = phost.strip_prefix("*.") {
        host == base || host.ends_with(&format!(".{base}"))
    } else {
        host == phost
    };
    if !host_ok {
        return false;
    }
    let mut target = url.path().to_string();
    if let Some(q) = url.query() {
        target.push('?');
        target.push_str(q);
    }
    let mut re = String::from("^");
    for ch in ppath.chars() {
        if ch == '*' {
            re.push_str(".*");
        } else {
            re.push_str(&regex::escape(&ch.to_string()));
        }
    }
    re.push('$');
    Regex::new(&re).map(|r| r.is_match(&target)).unwrap_or(false)
}

impl Injection {
    pub fn applies_to(&self, page_url: &str) -> bool {
        let Ok(url) = url::Url::parse(page_url) else { return false };
        if !self.script.matches.iter().any(|p| url_matches(p, &url)) {
            return false;
        }
        !self.script.exclude_matches.iter().any(|p| url_matches(p, &url))
    }
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

const SHIM: &str = r#"var __id=__EXT_ID__,__origin=__ORIGIN__,__manifest=__MANIFEST__;
var __mem={},__ls=null;try{__ls=window.localStorage}catch(e){}
var __k=function(a,k){return 'vx:'+__id+':'+a+':'+k};
var __read=function(a,k){try{if(__ls){var v=__ls.getItem(__k(a,k));return v==null?undefined:JSON.parse(v)}}catch(e){}return __mem[a+':'+k]};
var __write=function(a,k,v){try{if(__ls){__ls.setItem(__k(a,k),JSON.stringify(v));return}}catch(e){}__mem[a+':'+k]=v};
var __del=function(a,k){try{if(__ls){__ls.removeItem(__k(a,k));return}}catch(e){}delete __mem[a+':'+k]};
var __keys=function(a){var out=[];try{if(__ls){var p='vx:'+__id+':'+a+':';for(var i=0;i<__ls.length;i++){var n=__ls.key(i);if(n&&n.indexOf(p)===0)out.push(n.slice(p.length))}return out}}catch(e){}for(var n in __mem){if(n.indexOf(a+':')===0)out.push(n.slice(a.length+1))}return out};
var __done=function(cb,val){if(typeof cb==='function'){setTimeout(function(){cb(val)},0);return undefined}return Promise.resolve(val)};
var __ev=function(){var l=[];return{addListener:function(f){l.push(f)},removeListener:function(f){l=l.filter(function(x){return x!==f})},hasListener:function(f){return l.indexOf(f)>-1},dispatch:function(){var a=arguments;l.forEach(function(f){try{f.apply(null,a)}catch(e){console.error(e)}})}}};
var __area=function(a){return{
get:function(keys,cb){if(typeof keys==='function'){cb=keys;keys=null}var out={};
 if(keys==null){__keys(a).forEach(function(k){out[k]=__read(a,k)})}
 else if(typeof keys==='string'){var v=__read(a,keys);if(v!==undefined)out[keys]=v}
 else if(Array.isArray(keys)){keys.forEach(function(k){var v=__read(a,k);if(v!==undefined)out[k]=v})}
 else{Object.keys(keys).forEach(function(k){var v=__read(a,k);out[k]=v===undefined?keys[k]:v})}
 return __done(cb,out)},
set:function(items,cb){var changes={};Object.keys(items||{}).forEach(function(k){changes[k]={oldValue:__read(a,k),newValue:items[k]};__write(a,k,items[k])});try{chrome.storage.onChanged.dispatch(changes,a)}catch(e){}return __done(cb)},
remove:function(keys,cb){[].concat(keys).forEach(function(k){__del(a,k)});return __done(cb)},
clear:function(cb){__keys(a).forEach(function(k){__del(a,k)});return __done(cb)},
getBytesInUse:function(k,cb){return __done(typeof k==='function'?k:cb,0)}}};
var __port=function(){return{name:'',postMessage:function(){},disconnect:function(){},onMessage:__ev(),onDisconnect:__ev()}};
var chrome={
 runtime:{id:__id,lastError:undefined,
  getURL:function(p){return __origin+'/ext/'+__id+'/'+String(p||'').replace(/^\/+/,'')},
  getManifest:function(){return __manifest},
  sendMessage:function(){var cb=arguments[arguments.length-1];return __done(typeof cb==='function'?cb:null,undefined)},
  connect:__port,
  onMessage:__ev(),onConnect:__ev(),onInstalled:__ev(),onStartup:__ev()},
 storage:{local:__area('local'),sync:__area('sync'),session:__area('session'),managed:__area('managed'),onChanged:__ev()},
 i18n:{getMessage:function(k){return ''},getUILanguage:function(){return navigator.language||'en'}},
 extension:{getURL:function(p){return chrome.runtime.getURL(p)},inIncognitoContext:false},
 tabs:{query:function(q,cb){return __done(cb,[])},sendMessage:function(){var cb=arguments[arguments.length-1];return __done(typeof cb==='function'?cb:null,undefined)},onUpdated:__ev(),onActivated:__ev()}
};
var browser=chrome;"#;

fn js_string(s: &str) -> String {
    // JSON string, safe inside an inline <script>.
    serde_json::to_string(s)
        .unwrap_or_else(|_| "\"\"".to_string())
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// `<style>` and `<script>` blocks for one injection.
/// Returns (head part, end-of-body part).
pub fn render_injection(inj: &Injection, origin: &str) -> (String, String) {
    let mut head = String::new();
    let mut tail = String::new();
    if !inj.script.css.is_empty() {
        let css = inj.script.css.replace("</style", "<\\/style");
        head.push_str(&format!("<style data-vespera-ext=\"{}\">{}</style>", escape_attr(&inj.ext_id), css));
    }
    if !inj.script.js.is_empty() {
        let shim = SHIM
            .replace("__EXT_ID__", &js_string(&inj.ext_id))
            .replace("__ORIGIN__", &js_string(origin))
            .replace("__MANIFEST__", &inj.manifest_json.replace('<', "\\u003c"));
        let body = inj.script.js.replace("</script", "<\\/script").replace("<!--", "<\\!--");
        let block = format!(
            "<script data-vespera-ext=\"{id}\">(function(){{{shim}\ntry{{\n{body}\n}}catch(e){{console.error('[Vespera extension {name}]',e)}}\n}})();</script>",
            id = escape_attr(&inj.ext_id),
            shim = shim,
            body = body,
            name = escape_attr(&inj.ext_id).replace('\'', ""),
        );
        if inj.script.run_at == "document_start" {
            head.push_str(&block);
        } else {
            // document_end / document_idle: after the page has been parsed.
            tail.push_str(&block);
        }
    }
    (head, tail)
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

// ---------------------------------------------------------------------------
// Files, archives and helpers
// ---------------------------------------------------------------------------

fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim_start_matches('/').trim_start_matches('\\');
    if rel.is_empty() {
        return None;
    }
    let mut out = base.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    let out: String = out.chars().take(32).collect();
    if out.is_empty() {
        "extension".to_string()
    } else {
        out
    }
}

fn fnv_hex(text: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for b in text.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

/// A `.crx` is a header followed by a zip. Plain zips pass through.
fn strip_crx_header(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() < 4 {
        return Err("That file is empty or not an extension package.".to_string());
    }
    if &bytes[0..4] != b"Cr24" {
        return Ok(bytes);
    }
    let u32_at = |i: usize| -> Option<usize> {
        bytes.get(i..i + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    let version = u32_at(4).ok_or("The CRX header is truncated.")?;
    let start = match version {
        3 => 12 + u32_at(8).ok_or("The CRX header is truncated.")?,
        2 => 16 + u32_at(8).ok_or("The CRX header is truncated.")? + u32_at(12).ok_or("The CRX header is truncated.")?,
        _ => return Err("This CRX version is not supported.".to_string()),
    };
    bytes.get(start..).ok_or_else(|| "The CRX file is truncated.".to_string())
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "That file is not a valid .zip or .crx package.".to_string())?;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Could not read the package. ({e})"))?;
        let Some(rel) = file.enclosed_name() else { continue };
        let out = dest.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        total += file.size();
        if total > 200 * 1024 * 1024 {
            return Err("The package is too large to install.".to_string());
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(|e| format!("Could not unpack the package. ({e})"))?;
        fs::write(&out, data).map_err(|e| format!("Could not write the extension files. ({e})"))?;
    }
    Ok(())
}

/// The folder holding manifest.json: the root, or its only/first sub-folder.
fn find_manifest_root(base: &Path) -> Result<PathBuf, String> {
    if base.join("manifest.json").is_file() {
        return Ok(base.to_path_buf());
    }
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() && p.join("manifest.json").is_file() {
                return Ok(p);
            }
        }
    }
    Err("This package has no manifest.json, so it is not a Chrome extension.".to_string())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Could not create the extension folder. ({e})"))?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            if entry.file_name() == "node_modules" || entry.file_name() == ".git" {
                continue;
            }
            copy_dir(&src, &dst)?;
        } else if ty.is_file() {
            fs::copy(&src, &dst).map_err(|e| format!("Could not copy {}. ({e})", src.display()))?;
        }
    }
    Ok(())
}

pub fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Chrome Web Store extension id (32 letters a-p) in a URL, if any.
pub fn store_extension_id(url: &str) -> Option<String> {
    let re = Regex::new(r"(?i)\b([a-p]{32})\b").ok()?;
    re.captures(url).map(|c| c[1].to_lowercase())
}

pub fn store_download_url(id: &str) -> String {
    format!(
        "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3D{id}%26installsource%3Dondemand%26uc"
    )
}

/// Bundled catalog mirror (src/shared/extensions.mjs) â€” available for tools.
pub fn bundled_catalog() -> Value {
    include_str!("../assets/extensions.json")
        .parse::<Value>()
        .unwrap_or_else(|_| json!({ "builtins": [], "catalog": [] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    #[test]
    fn match_patterns() {
        assert!(url_matches("<all_urls>", &u("https://a.com/x")));
        assert!(url_matches("*://*/*", &u("http://a.com/x?y=1")));
        assert!(url_matches("https://*.example.com/*", &u("https://www.example.com/a")));
        assert!(url_matches("https://*.example.com/*", &u("https://example.com/")));
        assert!(!url_matches("https://*.example.com/*", &u("https://badexample.com/")));
        assert!(!url_matches("https://example.com/*", &u("http://example.com/")));
        assert!(url_matches("https://example.com/watch*", &u("https://example.com/watch?v=1")));
        assert!(!url_matches("https://example.com/watch*", &u("https://example.com/other")));
        assert!(!url_matches("<all_urls>", &u("file:///etc/passwd")));
    }

    #[test]
    fn crx_header_is_stripped() {
        let mut crx = b"Cr24".to_vec();
        crx.extend_from_slice(&3u32.to_le_bytes());
        crx.extend_from_slice(&2u32.to_le_bytes());
        crx.extend_from_slice(&[9, 9]);
        crx.extend_from_slice(b"PK-body");
        assert_eq!(strip_crx_header(&crx).unwrap(), b"PK-body");
        assert_eq!(strip_crx_header(b"PKplain").unwrap(), b"PKplain");
    }

    #[test]
    fn base64_roundtrip_shape() {
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"M"), "TQ==");
    }

    #[test]
    fn store_id_is_found() {
        let id = "cjpalhdlnbpafiamejdnhcphjbkeiagm";
        assert_eq!(store_extension_id(&format!("https://chromewebstore.google.com/detail/ublock-origin/{id}")), Some(id.to_string()));
        assert_eq!(store_extension_id("https://example.com"), None);
    }

    #[test]
    fn safe_join_blocks_escape() {
        let base = Path::new("/x");
        assert!(safe_join(base, "../etc").is_none());
        assert!(safe_join(base, "a/b.js").is_some());
    }
}
