//! Vespera Filter Engine — Rust port of src/shared/filter-engine.js.
//!
//! Implements the same Adblock Plus / EasyList subset the JS engine uses:
//! network rules (`||domain^`, anchors, wildcards, `^` separators, `@@`
//! exceptions, `$script,image` type options, `$third-party`, `$domain=`,
//! `$important`, `$badfilter`) and cosmetic rules (`host##.ad`, `##.generic`,
//! `host#@#.ad`). Domain-anchored rules are bucketed per hostname so a match
//! is a lookup plus a few regex tests.

use regex::Regex;
use std::collections::{HashMap, HashSet, HashSet as Set};
use std::sync::Mutex;

const RESOURCE_TYPES: [&str; 14] = [
    "script", "image", "stylesheet", "font", "media", "object", "subdocument",
    "xmlhttprequest", "websocket", "ping", "other", "document", "doc", "subframe",
];

fn is_resource_type(t: &str) -> bool {
    RESOURCE_TYPES.contains(&t)
}

#[derive(Debug, Clone)]
struct RuleOpts {
    types: Option<Set<String>>,
    excluded_types: Set<String>,
    third_party: Option<bool>,
    domains: Option<Vec<(String, bool)>>, // (host, negate)
    important: bool,
    badfilter: bool,
}

impl RuleOpts {
    fn new() -> Self {
        RuleOpts {
            types: None,
            excluded_types: Set::new(),
            third_party: None,
            domains: None,
            important: false,
            badfilter: false,
        }
    }
}

#[derive(Debug, Clone)]
struct Rule {
    raw: String,
    is_exception: bool,
    opts: RuleOpts,
    host: Option<String>,
    regex: Regex,
}

impl Rule {
    fn matches(&self, url: &str, rtype: &str, third_party: bool, document_host: &str) -> bool {
        let o = &self.opts;
        if let Some(types) = &o.types {
            if !types.contains(rtype) {
                return false;
            }
        }
        if o.excluded_types.contains(rtype) {
            return false;
        }
        if let Some(tp) = o.third_party {
            if tp != third_party {
                return false;
            }
        }
        if let Some(domains) = &o.domains {
            let mut has_positive = false;
            let mut ok = false;
            for (host, negate) in domains {
                let hit = document_host == host.as_str() || document_host.ends_with(&format!(".{host}"));
                if *negate {
                    if hit {
                        return false;
                    }
                } else {
                    has_positive = true;
                    if hit {
                        ok = true;
                    }
                }
            }
            if has_positive && !ok {
                return false;
            }
        }
        self.regex.is_match(url)
    }
}

#[derive(Debug, Clone)]
struct CosmeticRule {
    host: Option<String>, // None = generic
    selector: String,
    is_exception: bool,
}

impl CosmeticRule {
    fn applies_to(&self, document_host: &str) -> bool {
        match &self.host {
            None => true,
            Some(h) => document_host == h || document_host.ends_with(&format!(".{h}")),
        }
    }
}

/// Convert one Adblock pattern into a Regex source string (port of
/// patternToRegExpSource).
fn pattern_to_regex_source(pattern: &str) -> (String, bool) {
    let mut src = String::new();
    let mut anchored_start = false;
    let mut anchored_end = false;
    let mut domain_anchored = false;

    let mut pat = pattern;
    if let Some(rest) = pat.strip_prefix("||") {
        domain_anchored = true;
        pat = rest;
        src.push_str("^[a-z][a-z0-9+.\\-]*://(?:[^/?#]*\\.)?");
    } else if let Some(rest) = pat.strip_prefix('|') {
        anchored_start = true;
        pat = rest;
        src.push('^');
    }
    if let Some(rest) = pat.strip_suffix('|') {
        anchored_end = true;
        pat = rest;
    }

    for ch in pat.chars() {
        match ch {
            '*' => src.push_str(".*"),
            '^' => src.push_str("(?:[^a-zA-Z0-9_.%\\-]|$)"),
            '|' => src.push_str("\\|"),
            '\\' | '.' | '$' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' => {
                src.push('\\');
                src.push(ch);
            }
            c => src.push(c),
        }
    }
    if anchored_end {
        src.push('$');
    }
    (src, domain_anchored)
}

/// Parse an option string like `script,image,third-party,domain=a.com|~b.com`.
fn parse_options(option_str: &str) -> RuleOpts {
    let mut opts = RuleOpts::new();
    if option_str.is_empty() {
        return opts;
    }
    for raw in option_str.split(',') {
        let opt = raw.trim().to_lowercase();
        if opt.is_empty() {
            continue;
        }
        let (name_part, value) = match opt.find('=') {
            Some(eq) => (opt[..eq].to_string(), opt[eq + 1..].to_string()),
            None => (opt.clone(), String::new()),
        };
        let negate = name_part.starts_with('~');
        let name = if negate { &name_part[1..] } else { &name_part[..] };

        if is_resource_type(name) {
            if negate {
                opts.excluded_types.insert(name.to_string());
            } else {
                opts.types.get_or_insert_with(Set::new).insert(name.to_string());
            }
        } else if name == "third-party" || name == "3p" {
            opts.third_party = Some(!negate);
        } else if name == "first-party" || name == "1p" {
            opts.third_party = Some(if negate { true } else { false });
        } else if name == "domain" || name == "from" {
            let hosts: Vec<&str> = if value.is_empty() {
                Vec::new()
            } else {
                value.split('|').collect()
            };
            let domains = opts.domains.get_or_insert_with(Vec::new);
            for h in hosts {
                let hv = h.trim().to_lowercase();
                if hv.is_empty() {
                    continue;
                }
                if hv.starts_with('~') {
                    domains.push((hv[1..].to_string(), true));
                } else {
                    domains.push((hv, false));
                }
            }
        } else if name == "important" {
            opts.important = !negate;
        } else if name == "badfilter" {
            opts.badfilter = !negate;
        }
        // Unknown options (e.g. popup, csp) are accepted but ignored.
    }
    opts
}

/// Extract the hostname a `||host...` rule is anchored to (for bucketing).
fn extract_rule_host(pattern: &str) -> Option<String> {
    let rest = pattern.strip_prefix("||")?;
    let mut end = 0;
    for (i, c) in rest.char_indices() {
        if matches!(c, '*' | '^' | '|' | '/' | '$') {
            break;
        }
        end = i + c.len_utf8();
    }
    let head = &rest[..end];
    let host = head.to_lowercase();
    if !host.contains('.') && host != "localhost" {
        return None;
    }
    let cleaned: String = host.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Normalize a rule line into a signature ignoring the badfilter flag.
fn rule_signature(line: &str) -> String {
    let is_exception = line.starts_with("@@");
    let body = if is_exception { &line[2..] } else { line };
    let (body, option_str) = split_options(body);
    let mut opts: Vec<String> = option_str
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty() && s != "badfilter" && s != "~badfilter")
        .collect();
    opts.sort();
    let mut sig = String::new();
    if is_exception {
        sig.push_str("@@");
    }
    sig.push_str(&body);
    if !opts.is_empty() {
        sig.push('$');
        sig.push_str(&opts.join(","));
    }
    sig
}

/// Split `body$options` — `$` is treated as options only when the tail looks
/// like options (no `/`, only option-ish characters).
fn split_options(body: &str) -> (String, String) {
    if let Some(dollar) = body.rfind('$') {
        let tail = &body[dollar + 1..];
        if !tail.contains('/')
            && tail
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ',' | '~' | '=' | '.' | '|' | '+' | '-'))
        {
            return (body[..dollar].to_string(), tail.to_string());
        }
    }
    (body.to_string(), String::new())
}

/// Fast hostname extraction with a bounded cache (port of fastHost).
fn fast_host(url: &str, cache: &Mutex<HashMap<String, String>>) -> String {
    {
        if let Ok(guard) = cache.lock() {
            if let Some(h) = guard.get(url) {
                return h.clone();
            }
        }
    }
    let host = extract_host_raw(url);
    {
        let mut guard = cache.lock().unwrap();
        if guard.len() >= 8192 {
            guard.clear();
        }
        guard.insert(url.to_string(), host.clone());
    }
    host
}

fn extract_host_raw(url: &str) -> String {
    match url.find("://") {
        None => {
            if let Ok(u) = url::Url::parse(url) {
                return u.host_str().unwrap_or("").to_lowercase();
            }
            String::new()
        }
        Some(scheme) => {
            let start = scheme + 3;
            let bytes = url.as_bytes();
            let mut end = url.len();
            for (i, &c) in bytes.iter().enumerate().skip(start) {
                if c == b'/' || c == b'?' || c == b'#' {
                    end = i;
                    break;
                }
            }
            let mut seg = &url[start..end];
            if let Some(at) = seg.rfind('@') {
                seg = &seg[at + 1..];
            }
            if seg.starts_with('[') {
                if let Some(close) = seg.find(']') {
                    return seg[1..close].to_lowercase();
                }
                return String::new();
            }
            if let Some(colon) = seg.find(':') {
                seg = &seg[..colon];
            }
            seg.to_lowercase()
        }
    }
}

pub struct FilterEngine {
    host_buckets: HashMap<String, Vec<Rule>>,
    generic_rules: Vec<Rule>,
    exception_rules: Vec<Rule>,
    cosmetic_hide: Vec<CosmeticRule>,
    cosmetic_show: Vec<CosmeticRule>,
    badfilter_signatures: Set<String>,
    host_cache: Mutex<HashMap<String, String>>,
    pub stats: FilterStats,
}

#[derive(Debug, Default, Clone)]
pub struct FilterStats {
    pub total: usize,
    pub network: usize,
    pub cosmetic: usize,
    pub exceptions: usize,
    pub badfiltered: usize,
    pub invalid: usize,
}

impl FilterEngine {
    pub fn new(raw_rules: &[String]) -> Self {
        let mut engine = FilterEngine {
            host_buckets: HashMap::new(),
            generic_rules: Vec::new(),
            exception_rules: Vec::new(),
            cosmetic_hide: Vec::new(),
            cosmetic_show: Vec::new(),
            badfilter_signatures: Set::new(),
            host_cache: Mutex::new(HashMap::new()),
            stats: FilterStats::default(),
        };
        engine.compile(raw_rules);
        engine
    }

    /// Load the bundled rules text (one rule per line, `!`/`[` comments).
    pub fn from_bundled_rules() -> Self {
        let text = include_str!("../assets/rules.txt");
        let rules: Vec<String> = text.lines().map(|l| l.to_string()).collect();
        FilterEngine::new(&rules)
    }

    fn compile(&mut self, raw_rules: &[String]) {
        // First pass: collect badfilter signatures.
        for raw in raw_rules {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('!') || line.starts_with('[') {
                continue;
            }
            let opt_tail = match line.rfind('$') {
                Some(i) => &line[i + 1..],
                None => "",
            };
            if has_badfilter_option(opt_tail) {
                self.badfilter_signatures.insert(rule_signature(line));
            }
        }

        for raw in raw_rules {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('!') || line.starts_with('[') {
                continue;
            }
            self.stats.total += 1;

            // Cosmetic rules
            if !line.contains('$') && !line.starts_with("@@") {
                if let Some((host, marker, selector)) = split_cosmetic(line) {
                    let selector = selector.trim();
                    if selector.is_empty() {
                        self.stats.invalid += 1;
                        continue;
                    }
                    let rule = CosmeticRule {
                        host: if host.is_empty() || host == "*" { None } else { Some(host.to_lowercase()) },
                        selector: selector.to_string(),
                        is_exception: marker == "#@#",
                    };
                    if rule.is_exception {
                        self.cosmetic_show.push(rule);
                    } else {
                        self.cosmetic_hide.push(rule);
                    }
                    self.stats.cosmetic += 1;
                    continue;
                }
            }

            // Network rules
            let is_exception = line.starts_with("@@");
            let body = if is_exception { &line[2..] } else { line };
            let (body, option_str) = split_options(body);

            if self.badfilter_signatures.contains(&rule_signature(line)) {
                self.stats.badfiltered += 1;
                continue;
            }
            if body.is_empty() {
                self.stats.invalid += 1;
                continue;
            }

            let opts = parse_options(&option_str);
            let host = extract_rule_host(&body);
            let (source, _) = pattern_to_regex_source(&body);
            let regex = match Regex::new(&source) {
                Ok(r) => r,
                Err(_) => {
                    self.stats.invalid += 1;
                    continue;
                }
            };
            let rule = Rule {
                raw: line.to_string(),
                is_exception,
                opts,
                host,
                regex,
            };

            if is_exception {
                self.exception_rules.push(rule);
                self.stats.exceptions += 1;
            } else {
                if let Some(bucket_host) = rule.host.clone() {
                    self.host_buckets.entry(bucket_host).or_default().push(rule);
                } else {
                    self.generic_rules.push(rule);
                }
                self.stats.network += 1;
            }
        }
    }

    /// Decide whether a request should be blocked.
    pub fn match_req(&self, url: &str, rtype: &str, third_party: bool, document_host: &str) -> MatchResult {
        let lower = url.to_lowercase();
        let rtype = if is_resource_type(rtype) { rtype } else { "other" };
        let doc_host = document_host.to_lowercase();

        let mut hit: Option<&Rule> = None;

        // 1) host-bucketed rules: try each parent domain of the request host.
        let host = fast_host(&lower, &self.host_cache);
        if !host.is_empty() {
            let mut node = host.as_str();
            loop {
                if let Some(bucket) = self.host_buckets.get(node) {
                    for r in bucket {
                        if r.matches(&lower, rtype, third_party, &doc_host) {
                            hit = Some(r);
                            break;
                        }
                    }
                }
                if hit.is_some() {
                    break;
                }
                match node.find('.') {
                    Some(dot) => node = &node[dot + 1..],
                    None => break,
                }
            }
        }

        // 2) generic rules
        if hit.is_none() {
            for r in &self.generic_rules {
                if r.matches(&lower, rtype, third_party, &doc_host) {
                    hit = Some(r);
                    break;
                }
            }
        }
        let hit = match hit {
            Some(r) => r,
            None => return MatchResult { blocked: false, rule: None, exception: None },
        };

        // 3) exceptions (unless the rule is $important)
        if !hit.opts.important {
            for e in &self.exception_rules {
                if e.matches(&lower, rtype, third_party, &doc_host) {
                    return MatchResult {
                        blocked: false,
                        rule: Some(hit.raw.clone()),
                        exception: Some(e.raw.clone()),
                    };
                }
            }
        }
        MatchResult {
            blocked: true,
            rule: Some(hit.raw.clone()),
            exception: None,
        }
    }

    /// Cosmetic filtering for a page: selectors to hide and rules to un-hide.
    pub fn cosmetic_for(&self, document_host: &str) -> (Vec<String>, Vec<String>) {
        let host = document_host.to_lowercase();
        let mut hide = Vec::new();
        let mut show = Vec::new();
        for r in &self.cosmetic_hide {
            if r.applies_to(&host) {
                hide.push(r.selector.clone());
            }
        }
        for r in &self.cosmetic_show {
            if r.applies_to(&host) {
                show.push(r.selector.clone());
            }
        }
        let show_set: Set<String> = show.iter().cloned().collect();
        let hide: Vec<String> = hide.into_iter().filter(|s| !show_set.contains(s)).collect();
        (hide, show)
    }
}

#[derive(Debug, Clone)]
pub struct MatchResult {
    pub blocked: bool,
    pub rule: Option<String>,
    pub exception: Option<String>,
}

fn has_badfilter_option(opt_tail: &str) -> bool {
    opt_tail
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .any(|s| s == "badfilter" || s == "~badfilter")
}

/// Split `host##selector` / `##selector` / `host#@#selector`.
fn split_cosmetic(line: &str) -> Option<(String, &'static str, String)> {
    for marker in ["#@#", "##"] {
        if let Some(pos) = line.find(marker) {
            let host = line[..pos].trim().to_string();
            let selector = line[pos + marker.len()..].to_string();
            if !selector.trim().is_empty() {
                return Some((host, marker, selector));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> FilterEngine {
        FilterEngine::new(&[
            "||doubleclick.net^$third-party".to_string(),
            "||google-analytics.com^".to_string(),
            "@@||google-analytics.com^$domain=example.com".to_string(),
            "||ads.example.com^$script,image".to_string(),
            "||tracker.test^$third-party".to_string(),
            "example.com##.ad-banner".to_string(),
            "##.generic-ad".to_string(),
            "@@||analytics.test^$important".to_string(),
        ])
    }

    #[test]
    fn blocks_domain_anchored_third_party() {
        let e = engine();
        assert!(e.match_req("https://doubleclick.net/a.js", "script", true, "example.com").blocked);
        assert!(!e.match_req("https://doubleclick.net/a.js", "script", false, "doubleclick.net").blocked);
    }

    #[test]
    fn exception_rules_unblock() {
        let e = engine();
        let r = e.match_req("https://www.google-analytics.com/ga.js", "script", true, "example.com");
        assert!(!r.blocked);
        assert!(r.exception.is_some());
    }

    #[test]
    fn resource_types_and_important() {
        let e = engine();
        // ads.example.com only matches script/image
        assert!(e.match_req("https://ads.example.com/x.js", "script", true, "example.com").blocked);
        assert!(!e.match_req("https://ads.example.com/x.css", "stylesheet", true, "example.com").blocked);
        // $important exception beats regular exceptions
        assert!(!e.match_req("https://analytics.test/x.js", "script", true, "example.com").blocked);
    }

    #[test]
    fn cosmetic_selectors() {
        let e = engine();
        let (hide, _show) = e.cosmetic_for("www.example.com");
        assert!(hide.contains(&".ad-banner".to_string()));
        assert!(hide.contains(&".generic-ad".to_string()));
        let (hide_other, _) = e.cosmetic_for("other.test");
        assert!(!hide_other.contains(&".ad-banner".to_string()));
        assert!(hide_other.contains(&".generic-ad".to_string()));
    }

    #[test]
    fn bundled_rules_compile() {
        let e = FilterEngine::from_bundled_rules();
        assert!(e.stats.network > 50, "bundled lists should compile to many rules");
        assert!(e.match_req("https://doubleclick.net/ad", "script", true, "example.com").blocked);
    }
}
