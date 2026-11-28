//! Vespera preview proxy — Rust port of server/lib/proxy.js.
//!
//! Fetches remote pages, rewrites documents/CSS through the guarded `/proxy`
//! endpoint, blocks trackers/ads/annoyances via the filter engine, and injects
//! the guest bridge script (src/shared/guest-bridge.js — embedded verbatim by
//! build.rs) so proxied pages report navigation, audio and blocked resources.

use crate::filters::FilterEngine;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde_json::{json, Value};
use std::net::ToSocketAddrs;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

/// The bridge script template with the `${config}` placeholder replaced by
/// `__VESPERA_CONFIG__` at build time (see build.rs).
pub static BRIDGE_TEMPLATE: &str = include_str!(concat!(env!("OUT_DIR"), "/bridge_script.txt"));

const MAX_BYTES: usize = 20 * 1024 * 1024;
const DEFAULT_PREFS: u32 = 23;

pub(crate) const STRIP_HEADERS: [&str; 15] = [
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "strict-transport-security",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "set-cookie",
    "cookie",
    "authorization",
    "proxy-authorization",
    "location",
];

pub struct ProxyEngine {
    trackers: FilterEngine,
    ads: FilterEngine,
    annoyances: FilterEngine,
    client: reqwest::blocking::Client,
    injections: RwLock<Vec<crate::extensions::Injection>>,
}

impl ProxyEngine {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(18000))
            .connect_timeout(Duration::from_millis(6000))
            .tcp_nodelay(true)
            .pool_max_idle_per_host(8)
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            )
            .build()
            .expect("failed to build HTTP client");
        ProxyEngine {
            trackers: FilterEngine::from_bundled_rules(),
            ads: FilterEngine::from_bundled_rules(),
            annoyances: FilterEngine::from_bundled_rules(),
            client,
            injections: RwLock::new(Vec::new()),
        }
    }

    /// Replace the extension content scripts injected into pages.
    pub fn set_injections(&self, injections: Vec<crate::extensions::Injection>) {
        if let Ok(mut guard) = self.injections.write() {
            *guard = injections;
        }
    }

    /// (head markup, end-of-body markup) for extensions matching a page.
    fn extension_markup(&self, page_url: &str, origin: &str) -> (String, String) {
        let mut head = String::new();
        let mut tail = String::new();
        if let Ok(guard) = self.injections.read() {
            for inj in guard.iter().filter(|i| i.applies_to(page_url)) {
                let (h, t) = crate::extensions::render_injection(inj, origin);
                head.push_str(&h);
                tail.push_str(&t);
            }
        }
        (head, tail)
    }

    /// Public-address check mirroring publicAddress() in the JS proxy.
    fn is_public_ip(addr: &str) -> bool {
        if let Ok(ip) = addr.parse::<std::net::Ipv4Addr>() {
            let [a, b, _c, _d] = ip.octets();
            return !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0))
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51)
                || (a == 203 && b == 0)
                || (a == 192 && b == 88));
        }
        if let Ok(ip) = addr.parse::<std::net::Ipv6Addr>() {
            if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() || ip.is_unicast_link_local() {
                return false;
            }
            if ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8 {
                return false;
            }
            if (0xfc00..=0xfdff).contains(&ip.segments()[0]) {
                return false;
            }
            if let Some(v4) = ip.to_ipv4_mapped() {
                return Self::is_public_ip(&v4.to_string());
            }
            return true;
        }
        false
    }

    fn allowed_hosts() -> Vec<String> {
        std::env::var("VESPERA_PROXY_ALLOWED_HOSTS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    }

    fn host_allowed(host: &str) -> bool {
        let allowed = Self::allowed_hosts();
        if allowed.is_empty() {
            return true;
        }
        allowed.iter().any(|h| host == h.as_str() || host.ends_with(&format!(".{h}")))
    }

    fn validate_target(target: &str) -> Result<url::Url, String> {
        let u = url::Url::parse(target).map_err(|_| "Invalid website address.".to_string())?;
        if u.scheme() != "http" && u.scheme() != "https" {
            return Err("Only HTTP and HTTPS websites can be previewed.".to_string());
        }
        if !u.username().is_empty() || u.password().is_some() {
            return Err("URLs containing credentials are not allowed.".to_string());
        }
        let host = u.host_str().unwrap_or("").to_lowercase();
        let allowed = Self::allowed_hosts();
        if !allowed.is_empty() && !allowed.iter().any(|h| host == h.as_str() || host.ends_with(&format!(".{h}"))) {
            return Err(format!(
                "{host} is not reachable from this hosted preview. Open the original site in your browser, or use the desktop app for unrestricted browsing."
            ));
        }
        if std::env::var("VESPERA_PROXY_ALLOW_PRIVATE").as_deref() != Ok("1") {
            let addrs: Vec<std::net::IpAddr> = if host.parse::<std::net::IpAddr>().is_ok() {
                vec![host.parse().unwrap()]
            } else {
                (host.as_str(), 0)
                    .to_socket_addrs()
                    .map(|it| it.map(|a| a.ip()).collect())
                    .unwrap_or_default()
            };
            if addrs.is_empty() || !addrs.iter().any(|a| Self::is_public_ip(&a.to_string())) {
                return Err("Private and local network addresses are blocked by the preview proxy.".to_string());
            }
        }
        Ok(u)
    }

    pub fn fetch_remote(&self, target_url: &str, sec_gpc: &str, dnt: &str) -> Result<FetchResult, String> {
        let url = Self::validate_target(target_url)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            ),
        );
        headers.insert(
            "accept",
            HeaderValue::from_static("text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8"),
        );
        headers.insert("accept-language", HeaderValue::from_static("en-US,en;q=0.9"));
        if !sec_gpc.is_empty() {
            headers.insert("sec-gpc", HeaderValue::from_str(sec_gpc).unwrap_or(HeaderValue::from_static("1")));
        }
        if !dnt.is_empty() {
            headers.insert("dnt", HeaderValue::from_str(dnt).unwrap_or(HeaderValue::from_static("1")));
        }

        let resp = self
            .client
            .get(url.clone())
            .headers(headers)
            .send()
            .map_err(|e| format!("Could not reach this site. ({e})"))?;

        let status = resp.status().as_u16();
        let final_url = resp.url().to_string();
        if resp.content_length().unwrap_or(0) > MAX_BYTES as u64 {
            return Err("This resource is too large for the web preview (20 MB limit).".to_string());
        }
        let header_map = resp.headers().clone();
        let body = resp
            .bytes()
            .map_err(|e| format!("Could not read the website response. ({e})"))?;
        if body.len() > MAX_BYTES {
            return Err("This resource is too large for the web preview (20 MB limit).".to_string());
        }
        Ok(FetchResult {
            status,
            headers: header_map,
            body: body.to_vec(),
            final_url,
        })
    }

    /// Which shield kind blocks this URL: "tracker", "ad" or "".
    pub(crate) fn block_kind(&self, abs: &str, rtype: &str, doc: &str, mask: u32) -> String {
        if mask & 1 == 0 || mask & 32 != 0 || rtype == "document" {
            return String::new();
        }
        let doc_host = host_of(doc);
        let target_host = host_of(abs);
        if target_host.is_empty() {
            return String::new();
        }
        let third_party = target_host != doc_host;
        let doc_host = doc_host.as_str();
        if mask & 2 != 0 && self.trackers.match_req(abs, rtype, third_party, doc_host).blocked {
            return "tracker".to_string();
        }
        if mask & 4 != 0 && self.ads.match_req(abs, rtype, third_party, doc_host).blocked {
            return "ad".to_string();
        }
        String::new()
    }

    /// Build a proxy URL for `value`, or the direct URL when allowed.
    fn proxied(&self, value: &str, base: &str, extra: &str, rtype: &str, doc: &str, mask: u32, origin: &str) -> String {
        let Some(abs) = absolute_url(value, base) else {
            return value.to_string();
        };
        let blocked = self.block_kind(&abs, rtype, doc, mask);
        if blocked.is_empty() && rtype != "document" && !Self::host_allowed(&host_of(&abs)) {
            return abs;
        }
        let mut url = format!("{}/proxy?url={}", origin, encode_uri_component(&abs));
        if !extra.is_empty() {
            url.push_str(extra);
        }
        url.push_str(&format!("&vt={rtype}&doc={}", encode_uri_component(doc)));
        if !blocked.is_empty() {
            url.push_str(&format!("&vespera_blocked={blocked}"));
        }
        url
    }

    fn rewrite_css(&self, css: &str, base: &str, extra: &str, doc: &str, mask: u32, origin: &str) -> String {
        let rewritten = css_url_re()
            .replace_all(css, |caps: &regex::Captures| {
                let value = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                if value.starts_with("data:") || value.starts_with("blob:") || value.starts_with('#') {
                    return caps.get(0).unwrap().as_str().to_string();
                }
                format!("url(\"{}\")", self.proxied(value, base, extra, "other", doc, mask, origin))
            })
            .to_string();
        css_import_re()
            .replace_all(&rewritten, |caps: &regex::Captures| {
                let value = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                format!("@import \"{}\"", self.proxied(value, base, extra, "stylesheet", doc, mask, origin))
            })
            .to_string()
    }

    /// Full document rewrite (port of rewriteHtml).
    pub fn rewrite_html(&self, html: &str, page_url: &str, dark: bool, mask: u32, origin: &str) -> String {
        let extra = format!("&vp={mask}{}", if dark { "&vespera_dark=1" } else { "" });
        let without_base = base_tag_re().replace_all(html, "");
        let mut out = meta_refresh_re().replace_all(&without_base, "").to_string();

        out = tag_re()
            .replace_all(&out, |caps: &regex::Captures| {
                let name = caps.get(1).unwrap().as_str();
                let attrs = caps.get(2).unwrap().as_str();
                let attrs = integrity_re().replace_all(attrs, "");
                let attrs = attr_re().replace_all(attrs.as_ref(), |c: &regex::Captures| {
                    let key = c.get(1).unwrap().as_str();
                    let quote = c.get(2).unwrap().as_str();
                    let value = c.get(3).unwrap().as_str();
                    if name.eq_ignore_ascii_case("a") && value.starts_with('#') {
                        return c.get(0).unwrap().as_str().to_string();
                    }
                    let tag = name.to_lowercase();
                    let rtype = if key == "src" {
                        match tag.as_str() {
                            "script" => "script",
                            "img" => "image",
                            "iframe" => "subdocument",
                            "source" | "video" | "audio" => "media",
                            _ => "other",
                        }
                    } else if key == "href" && tag == "link" {
                        "stylesheet"
                    } else {
                        "document"
                    };
                    let proxied_extra = if rtype == "document" { "" } else { extra.as_str() };
                    format!(
                        " {key}={quote}{}{quote}",
                        esc(&self.proxied(value, page_url, proxied_extra, rtype, page_url, mask, origin))
                    )
                });
                let attrs = srcset_re().replace_all(attrs.as_ref(), |c: &regex::Captures| {
                    let quote = c.get(1).unwrap().as_str();
                    let value = c.get(2).unwrap().as_str();
                    let rewritten = value
                        .split(',')
                        .map(|part| {
                            let mut pieces: Vec<String> =
                                part.trim().split_whitespace().map(|p| p.to_string()).collect();
                            if let Some(first) = pieces.first() {
                                let proxied =
                                    self.proxied(first.as_str(), page_url, &extra, "image", page_url, mask, origin);
                                if let Some(slot) = pieces.first_mut() {
                                    *slot = proxied;
                                }
                            }
                            pieces.join(" ")
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    format!(" srcset=\"{quote}{rewritten}{quote}\"")
                });
                format!("<{name}{attrs}>")
            })
            .to_string();

        out = style_block_re()
            .replace_all(&out, |caps: &regex::Captures| {
                let css = caps.get(2).unwrap().as_str();
                format!(
                    "{}{}{}",
                    caps.get(1).unwrap().as_str(),
                    self.rewrite_css(css, page_url, &extra, page_url, mask, origin),
                    caps.get(3).unwrap().as_str()
                )
            })
            .to_string();

        out = inline_style_re()
            .replace_all(&out, |caps: &regex::Captures| {
                let quote = caps.get(1).unwrap().as_str();
                let css = caps.get(2).unwrap().as_str();
                format!(
                    " style=\"{quote}{}{quote}\"",
                    esc(&self.rewrite_css(css, page_url, "", page_url, mask, origin))
                )
            })
            .to_string();

        let dark_style = if dark {
            "<style data-vespera-dark>html{filter:invert(1) hue-rotate(180deg)!important;background:#111!important}img,video,canvas,[style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)}</style>"
        } else {
            ""
        };
        if mask & 1 != 0 && mask & 32 == 0 {
            let doc_host = host_of(page_url);
            let mut selectors: Vec<String> = Vec::new();
            if mask & 4 != 0 {
                selectors.extend(self.ads.cosmetic_for(&doc_host).0);
            }
            if mask & 8 != 0 {
                selectors.extend(self.annoyances.cosmetic_for(&doc_host).0);
            }
            if !selectors.is_empty() {
                let style = selectors
                    .iter()
                    .map(|s| format!("{s}{{display:none!important}}"))
                    .collect::<Vec<_>>()
                    .join("");
                out.push_str(&format!("<style data-vespera-shields>{style}</style>"));
            }
        }

        let (ext_head, ext_tail) = self.extension_markup(page_url, origin);
        let head = format!(
            "<base href=\"{}\">{}{}{}",
            esc(page_url),
            self.bridge_script(page_url, "", &extra, origin),
            dark_style,
            ext_head
        );
        if let Some(m) = head_tag_re().find(&out) {
            let matched = &out[m.start()..m.end()];
            out = out.replacen(matched, &format!("{matched}{head}"), 1);
        } else if let Some(m) = html_tag_re().find(&out) {
            let matched = &out[m.start()..m.end()];
            out = out.replacen(matched, &format!("{matched}<head>{head}</head>"), 1);
        } else {
            out = format!("<!doctype html><html><head>{head}</head><body>{out}</body></html>");
        }
        out.push_str(&ext_tail);
        out
    }

    pub fn rewrite_css_document(&self, css: &str, page_url: &str, dark: bool, mask: u32, origin: &str) -> String {
        let extra = format!("&vp={mask}{}", if dark { "&vespera_dark=1" } else { "" });
        self.rewrite_css(css, page_url, &extra, page_url, mask, origin)
    }

    /// The injected guest bridge script for a page.
    pub fn bridge_script(&self, page_url: &str, error: &str, extra: &str, parent_origin: &str) -> String {
        let config = json!({
            "url": page_url,
            "error": error,
            "extra": extra,
            "parentOrigin": parent_origin,
        })
        .to_string()
        .replace('<', "\\u003c");
        BRIDGE_TEMPLATE.replace("__VESPERA_CONFIG__", &config)
    }

    pub fn error_document(&self, message: &str, target: &str) -> String {
        format!(
            "<!doctype html><html><head><title>Site unavailable</title>{}</head><body style=\"font-family:system-ui;background:#0e1428;color:#e9edfb;padding:48px\"><h1>Site unavailable</h1><p>{}</p></body></html>",
            self.bridge_script(target, message, "", ""),
            esc(message)
        )
    }

    /// Reader View article extraction (port of server/lib/reader.js).
    pub fn extract_article(&self, html: &str, url: &str) -> (String, String, String) {
        let text: String = html.chars().take(4 * 1024 * 1024).collect();
        let title_raw = first_group(&h1_re(), &text)
            .or_else(|| first_group(&title_tag_re(), &text))
            .unwrap_or("Article");
        let title = decode_entities(&strip_tags(title_raw)).trim().to_string();
        let body = first_group(&article_re(), &text)
            .or_else(|| first_group(&main_re(), &text))
            .or_else(|| first_group(&body_re(), &text))
            .unwrap_or(&text);
        let mut cleaned = remove_block_elements(body);
        cleaned = block_close_re().replace_all(&cleaned, "\n\n").to_string();
        cleaned = tag_any_re().replace_all(&cleaned, "").to_string();
        cleaned = decode_entities(&cleaned);
        cleaned = collapse_ws(&cleaned);
        let cleaned = cleaned.trim().to_string();
        let cleaned: String = cleaned.chars().take(120_000).collect();
        (
            title.chars().take(500).collect(),
            cleaned,
            url.to_string(),
        )
    }
}

impl Default for ProxyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ProxyEngine {
    /// Rules summary for /api/filters so shield counts match the proxy.
    pub fn rules_snapshot(&self) -> Value {
        serde_json::json!({
            "rules": self.trackers.stats,
            "generatedAt": crate::state::now_stamp(),
        })
    }
}

#[derive(Debug)]
pub struct FetchResult {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
    pub final_url: String,
}

pub fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
        .unwrap_or_default()
}

fn absolute_url(value: &str, base: &str) -> Option<String> {
    let trimmed = value.trim();
    if let Ok(u) = url::Url::parse(trimmed) {
        if u.scheme() == "http" || u.scheme() == "https" {
            return Some(u.to_string());
        }
        return None;
    }
    let base_url = url::Url::parse(base).ok()?;
    let joined = base_url.join(trimmed).ok()?;
    if joined.scheme() == "http" || joined.scheme() == "https" {
        Some(joined.to_string())
    } else {
        None
    }
}

pub fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')' => {
                out.push(c)
            }
            _ => {
                out.push_str(&c.to_string().bytes().map(|b| format!("%{b:02X}")).collect::<String>());
            }
        }
    }
    out
}

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn decode_entities(text: &str) -> String {
    let named: [(&str, &str); 12] = [
        ("amp", "&"),
        ("lt", "<"),
        ("gt", ">"),
        ("quot", "\""),
        ("apos", "'"),
        ("nbsp", " "),
        ("mdash", "—"),
        ("ndash", "–"),
        ("hellip", "…"),
        ("rsquo", "’"),
        ("lsquo", "‘"),
        ("rdquo", "”"),
    ];
    entity_re()
        .replace_all(text, |caps: &regex::Captures| {
            let entity = caps.get(1).unwrap().as_str();
            if let Some(rest) = entity.strip_prefix('#') {
                let (radix, digits) = if rest.starts_with(['x', 'X']) {
                    (16, &rest[1..])
                } else {
                    (10, rest)
                };
                if let Ok(n) = u32::from_str_radix(digits, radix) {
                    if n > 0 && n <= 0x10FFFF {
                        return char::from_u32(n).unwrap_or('\u{FFFD}').to_string();
                    }
                }
                return caps.get(0).unwrap().as_str().to_string();
            }
            named
                .iter()
                .find(|(k, _)| *k == entity)
                .map(|(_, v)| v.to_string())
                .unwrap_or_else(|| caps.get(0).unwrap().as_str().to_string())
        })
        .to_string()
}

fn strip_tags(s: &str) -> String {
    tag_any_re().replace_all(s, "").to_string()
}

fn remove_block_elements(s: &str) -> String {
    block_remove_re()
        .replace_all(s, "")
        .to_string()
}

fn collapse_ws(s: &str) -> String {
    let mut collapsed = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.chars() {
        if c == ' ' || c == '\t' || c == '\r' {
            if !prev_space {
                collapsed.push(' ');
                prev_space = true;
            }
        } else {
            collapsed.push(c);
            prev_space = false;
        }
    }
    let mut out = String::with_capacity(collapsed.len());
    let mut newline_run = 0;
    for c in collapsed.chars() {
        if c == '\n' {
            newline_run += 1;
            if newline_run <= 2 {
                out.push(c);
            }
        } else {
            newline_run = 0;
            out.push(c);
        }
    }
    out
}

fn first_group<'a>(re: &Regex, text: &'a str) -> Option<&'a str> {
    let caps = re.captures(text)?;
    Some(caps.get(1).unwrap().as_str())
}

// ---- regexes (compiled once) ----

fn base_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)<base\b[^>]*>"#).unwrap())
}
fn meta_refresh_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|refresh)["']?[^>]*>"#)
            .unwrap()
    })
}
fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)<([a-z][\w:-]*)\b([^>]*)>"#).unwrap())
}
fn integrity_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"\sintegrity\s*=\s*(["']).*?\1"#).unwrap())
}
fn attr_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"\s(src|href|poster|action)\s*=\s*(["'])(.*?)\2"#).unwrap())
}
fn srcset_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"\ssrcset\s*=\s*(["'])(.*?)\1"#).unwrap())
}
fn style_block_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)(<style\b[^>]*>)(.*?)(</style>)").unwrap())
}
fn inline_style_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"\sstyle\s*=\s*(["'])(.*?)\1"#).unwrap())
}
fn head_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)<head[^>]*>").unwrap())
}
fn html_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)<html[^>]*>").unwrap())
}
fn css_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"url\(\s*(["']?)(.*?)\1\s*\)"#).unwrap())
}
fn css_import_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"@import\s+(["'])(.*?)\1"#).unwrap())
}
fn entity_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").unwrap())
}
fn tag_any_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]*>").unwrap())
}
fn block_close_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)<(br|/p|/div|/h[1-6]|/li|/blockquote|/section)[^>]*>").unwrap())
}
fn block_remove_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?is)<(script|style|nav|header|footer|aside|form|noscript|svg|iframe|button)\b[^>]*>.*?</\1>")
            .unwrap()
    })
}
fn h1_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<h1\b[^>]*>(.*?)</h1>").unwrap())
}
fn title_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").unwrap())
}
fn article_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<article\b[^>]*>(.*?)</article>").unwrap())
}
fn main_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<main\b[^>]*>(.*?)</main>").unwrap())
}
fn body_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<body\b[^>]*>(.*?)</body>").unwrap())
}

// Keep DEFAULT_PREFS referenced even when the proxy defaults change.
#[allow(dead_code)]
const _DEFAULT_PREFS_UNUSED: u32 = DEFAULT_PREFS;
