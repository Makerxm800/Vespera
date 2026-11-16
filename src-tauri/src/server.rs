//! Vespera local server — Rust port of server/server.js.
//!
//! Serves the browser UI (embedded at build time), the guarded `/proxy`
//! endpoint that renders websites in the sandboxed preview, and the small
//! `/api/*` surface the UI uses. Binds to 127.0.0.1 only.

use crate::proxy::{ProxyEngine, STRIP_HEADERS};
use include_dir::{include_dir, Dir};
use serde_json::json;
use std::io::Read;
use std::sync::Arc;
use tiny_http::{Header, Response, Server, StatusCode};

static RENDERER: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../src/renderer");

const BASE_PORT: u16 = 4600;
const PORT_SPAN: u16 = 10;

pub struct ServerHandle {
    pub port: u16,
    pub origin: String,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl ServerHandle {
    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.origin, path)
    }
}

pub fn content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "jsx" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "map" => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn sanitize_path(raw: &str) -> Option<String> {
    let mut path = raw.split('?').next().unwrap_or("").trim_matches('/').to_string();
    if path.is_empty() {
        path = "index.html".to_string();
    }
    if path.contains("..") || path.contains('\\') {
        return None;
    }
    Some(path)
}

fn serve_static(path: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let Some(rel) = sanitize_path(path) else {
        return Response::from_string("Not found.").with_status_code(StatusCode(404));
    };
    match RENDERER.get_file(&rel) {
        Some(file) => Response::from_data(file.contents().to_vec())
            .with_header(Header::from_bytes(&b"content-type"[..], content_type(&rel).as_bytes()).unwrap())
            .with_header(Header::from_bytes(&b"cache-control"[..], b"no-cache").unwrap())
            .with_status_code(StatusCode(200)),
        None => Response::from_string("Not found.").with_status_code(StatusCode(404)),
    }
}

fn json_response(status: u16, value: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string());
    Response::from_string(body)
        .with_header(Header::from_bytes(&b"content-type"[..], b"application/json; charset=utf-8").unwrap())
        .with_header(Header::from_bytes(&b"cache-control"[..], b"no-store").unwrap())
        .with_status_code(StatusCode(status))
}

fn handle_proxy(
    request: &tiny_http::Request,
    engine: &ProxyEngine,
    origin: &str,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let url = request.url();
    let params = url::Url::parse(&format!("http://local{url}"))
        .ok()
        .map(|u| u.query_pairs().collect::<Vec<_>>())
        .unwrap_or_default();
    let get = |key: &str| -> String {
        params.iter().find(|(k, _)| k == key).map(|(_, v)| v.to_string()).unwrap_or_default()
    };

    let target = get("url");
    let dark = get("vespera_dark") == "1";
    let raw_mask = get("vp");
    let mask: u32 = if !raw_mask.is_empty() && raw_mask.chars().all(|c| c.is_ascii_digit()) {
        raw_mask.parse::<u32>().unwrap_or(23) & 63
    } else {
        23
    };
    let rtype = get("vt");
    let rtype = if rtype.is_empty() { "document".to_string() } else { rtype };
    let doc = get("doc");
    let doc = if doc.is_empty() { target.clone() } else { doc };
    let blocked = get("vespera_blocked");
    let blocked = if blocked.is_empty() {
        engine.block_kind(&target, &rtype, &doc, mask)
    } else {
        blocked
    };

    if !blocked.is_empty() {
        let (ctype, body) = match rtype.as_str() {
            "script" => ("text/javascript; charset=utf-8", "/* blocked by Vespera Shields */".to_string()),
            "stylesheet" => ("text/css; charset=utf-8", "/* blocked by Vespera Shields */".to_string()),
            "image" => (
                "image/gif",
                "R0lGODlhAQABAIAAAAAAAP///yW5BAEAAAAALAAAAAABAAEAAAIBRAA7".to_string(),
            ),
            _ => ("text/plain; charset=utf-8", "blocked by Vespera Shields".to_string()),
        };
        let is_gif = rtype == "image";
        let body_bytes = if is_gif {
            base64_decode(body.as_bytes()).unwrap_or_default()
        } else {
            body.into_bytes()
        };
        let response = Response::from_data(body_bytes)
            .with_header(Header::from_bytes(&b"content-type"[..], ctype.as_bytes()).unwrap())
            .with_header(Header::from_bytes(&b"cache-control"[..], b"no-store").unwrap())
            .with_header(Header::from_bytes(&b"access-control-allow-origin"[..], b"*").unwrap())
            .with_header(
                Header::from_bytes(&b"content-security-policy"[..], b"sandbox allow-scripts").unwrap(),
            )
            .with_status_code(StatusCode(200));
        return response;
    }

    let sec_gpc = if mask & 1 != 0 && mask & 16 != 0 { "1" } else { "0" };
    let dnt = sec_gpc.to_string();
    let result = engine.fetch_remote(&target, sec_gpc, &dnt);
    match result {
        Ok(result) => {
            let mut headers_out: Vec<(String, String)> = Vec::new();
            for (k, v) in result.headers.iter() {
                let name = k.as_str().to_lowercase();
                if STRIP_HEADERS.contains(&name.as_str()) {
                    continue;
                }
                if let Ok(value) = v.to_str() {
                    headers_out.push((name, value.to_string()));
                }
            }
            headers_out.push(("cache-control".to_string(), "no-store".to_string()));
            headers_out.push(("access-control-allow-origin".to_string(), "*".to_string()));
            headers_out.push(("cross-origin-resource-policy".to_string(), "cross-origin".to_string()));
            headers_out.push((
                "content-security-policy".to_string(),
                "sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals".to_string(),
            ));
            headers_out.push(("referrer-policy".to_string(), "no-referrer".to_string()));

            let content_type = headers_out
                .iter()
                .find(|(k, _)| k == "content-type")
                .map(|(_, v)| v.clone())
                .unwrap_or_default();
            let base_type = content_type.split(';').next().unwrap_or("").trim().to_lowercase();

            let download = params.iter().any(|(k, v)| k == "download" && v == "1")
                || headers_out
                    .iter()
                    .any(|(k, v)| k == "content-disposition" && v.to_lowercase().contains("attachment"));
            if download {
                let name = url::Url::parse(&result.final_url)
                    .ok()
                    .map(|u| u.path().rsplit('/').next().unwrap_or("download").to_string())
                    .unwrap_or_else(|| "download".to_string());
                let cleaned: String = name
                    .chars()
                    .map(|c| if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
                    .collect();
                let name: String = if cleaned.is_empty() { "download".to_string() } else { cleaned };
                let name = name.chars().take(150).collect::<String>();
                headers_out.push(("content-disposition".to_string(), format!("attachment; filename=\"{name}\"")));
            } else {
                headers_out.retain(|(k, _)| k != "content-disposition");
            }

            let body_bytes = if base_type == "text/html" || base_type == "application/xhtml+xml" || base_type.is_empty() {
                headers_out.retain(|(k, _)| k != "content-type");
                headers_out.push(("content-type".to_string(), "text/html; charset=utf-8".to_string()));
                engine
                    .rewrite_html(&String::from_utf8_lossy(&result.body), &result.final_url, dark, mask, origin)
                    .into_bytes()
            } else if base_type == "text/css" {
                headers_out.retain(|(k, _)| k != "content-type");
                headers_out.push(("content-type".to_string(), "text/css; charset=utf-8".to_string()));
                engine
                    .rewrite_css_document(
                        &String::from_utf8_lossy(&result.body),
                        &result.final_url,
                        dark,
                        mask,
                        origin,
                    )
                    .into_bytes()
            } else {
                result.body.clone()
            };

            let mut response = Response::from_data(body_bytes);
            for (k, v) in headers_out {
                if let Ok(header) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
                    response = response.with_header(header);
                }
            }
            response.with_status_code(StatusCode(result.status))
        }
        Err(err) => {
            let status = if err.contains("not reachable") { 403u16 } else { 502 };
            let body = engine.error_document(&err, &target);
            Response::from_string(body)
                .with_header(Header::from_bytes(&b"content-type"[..], b"text/html; charset=utf-8").unwrap())
                .with_header(Header::from_bytes(&b"cache-control"[..], b"no-store").unwrap())
                .with_header(
                    Header::from_bytes(&b"content-security-policy"[..], b"sandbox allow-scripts allow-forms").unwrap(),
                )
                .with_status_code(StatusCode(status))
        }
    }
}

fn base64_decode(input: &[u8]) -> Option<Vec<u8>> {
    let table: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for &c in input {
        let value = match c {
            b'=' => break,
            b'\n' | b'\r' => continue,
            _ => table.iter().position(|&t| t == c)? as u32,
        };
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

/// Start the server on 127.0.0.1, trying the base port upward.
pub fn start(engine: Arc<ProxyEngine>, rules_snapshot: serde_json::Value, version: String) -> Result<ServerHandle, String> {
    let mut port = BASE_PORT;
    let server = loop {
        match Server::http(format!("127.0.0.1:{port}")) {
            Ok(server) => break server,
            Err(e) if port < BASE_PORT + PORT_SPAN => {
                port += 1;
                continue;
            }
            Err(e) => return Err(format!("Could not start the Vespera server: {e}")),
        }
    };
    let origin = format!("http://127.0.0.1:{port}");
    eprintln!("  Vespera server running → {origin}");

    let engine = Arc::clone(&engine);
    let rules_snapshot = Arc::new(rules_snapshot);
    let version = Arc::new(version);
    let thread = std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let engine = Arc::clone(&engine);
            let origin = origin.clone();
            let rules_snapshot = Arc::clone(&rules_snapshot);
            let version = Arc::clone(&version);
            let response = (|| -> Response<std::io::Cursor<Vec<u8>>> {
                let method = request.method().clone();
                if method != tiny_http::Method::Get {
                    return Response::from_string("Method not allowed.").with_status_code(StatusCode(405));
                }
                let path = request.url().split('?').next().unwrap_or("/").to_string();
                if path == "/proxy" {
                    return handle_proxy(&request, &engine, &origin);
                }
                if path == "/api/health" {
                    let allowed = std::env::var("VESPERA_PROXY_ALLOWED_HOSTS")
                        .unwrap_or_default()
                        .split(',')
                        .filter(|s| !s.trim().is_empty())
                        .map(|s| s.trim().to_string())
                        .collect::<Vec<_>>();
                    return json_response(200, json!({
                        "ok": true,
                        "app": "vespera",
                        "version": *version,
                        "previewRestricted": !allowed.is_empty(),
                        "allowedHosts": allowed,
                    }));
                }
                if path == "/api/filters" {
                    return json_response(200, (*rules_snapshot).clone());
                }
                if path == "/api/reader" {
                    let target = request
                        .url()
                        .split("url=")
                        .nth(1)
                        .map(|s| s.split('&').next().unwrap_or("").to_string())
                        .unwrap_or_default();
                    let target = url::Url::parse(&format!("http://local{target}"))
                        .ok()
                        .and_then(|u| u.query_pairs().find(|(k, _)| k == "url").map(|(_, v)| v.to_string()))
                        .unwrap_or_default();
                    if target.is_empty() {
                        return json_response(400, json!({ "error": "missing_url", "message": "Reader View needs a page address." }));
                    }
                    let sec_gpc = "1".to_string();
                    let result = engine.fetch_remote(&target, &sec_gpc, "1");
                    return match result {
                        Ok(result) => {
                            let ctype = result
                                .headers
                                .get("content-type")
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                                .to_lowercase();
                            if !ctype.contains("html") {
                                return json_response(415, json!({ "error": "not_html", "message": "Reader View needs an article page." }));
                            }
                            let (title, text, final_url) = engine.extract_article(&String::from_utf8_lossy(&result.body), &result.final_url);
                            json_response(200, json!({ "title": title, "text": text, "url": final_url }))
                        }
                        Err(err) => json_response(502, json!({ "error": "reader_failed", "message": err })),
                    };
                }
                serve_static(&path)
            })();
            let _ = request.respond(response);
        }
    });

    Ok(ServerHandle {
        port,
        origin,
        thread: Some(thread),
    })
}

#[allow(dead_code)]
fn read_request_body(request: &tiny_http::Request) -> String {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    body
}
