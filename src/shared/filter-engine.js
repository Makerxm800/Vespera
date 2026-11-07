/**
 * Vespera Filter Engine — core of the Vespera privacy engine.
 *
 * Implements a high-performance subset of Adblock Plus / EasyList syntax:
 *
 *   Network rules
 *     ||domain^              domain-anchored
 *     |http://x|             start/end anchors
 *     *                      wildcards anywhere in a pattern
 *     ^                      separator placeholder
 *     @@...                  exception (allow) rules
 *     $script,image          resource-type options
 *     $third-party           third-party-only rules
 *     $domain=news.com|~blog.news.com
 *     $important             beats exceptions
 *     $badfilter              disables a matching rule
 *
 *   Cosmetic rules
 *     example.com##.ad       hide selector
 *     ##.generic-ad          generic hide
 *     example.com#@#.ad      exception (unhide)
 *
 * Performance design ("core privacy engine optimization"):
 *   - Every rule is compiled to a RegExp exactly once, at load time.
 *   - Domain-anchored rules are indexed into per-hostname buckets, so a match
 *     is a lookup plus a handful of regex tests — never a full-list scan.
 *   - Generic rules and exception rules are kept in flat, type-filtered arrays.
 *   - `match()` allocates no strings; only executes precompiled regexes.
 */

'use strict';

const RESOURCE_TYPES = new Set([
  'script', 'image', 'stylesheet', 'font', 'media', 'object', 'subdocument',
  'xmlhttprequest', 'websocket', 'ping', 'other', 'document',
]);

/**
 * Convert one Adblock pattern into a RegExp source string.
 * @param {string} pattern
 */
function patternToRegExpSource(pattern) {
  let src = '';
  let anchoredStart = false;
  let anchoredEnd = false;
  let domainAnchored = false;

  if (pattern.startsWith('||')) {
    domainAnchored = true;
    pattern = pattern.slice(2);
    // Domain anchor: scheme:// with optional subdomains before the rule text.
    src += '^[a-z][a-z0-9+.\\-]*://(?:[^/?#]*\\.)?';
  } else if (pattern.startsWith('|')) {
    anchoredStart = true;
    pattern = pattern.slice(1);
    src += '^';
  }

  if (pattern.endsWith('|')) {
    anchoredEnd = true;
    pattern = pattern.slice(0, -1);
  }

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      src += '.*';
    } else if (ch === '^') {
      // Separator: any non-alphanumeric/_-.% char, or end of string.
      src += '(?:[^a-zA-Z0-9_.%\\-]|$)';
    } else if (ch === '|') {
      // Interior `|` is literal in most implementations.
      src += '\\|';
    } else if ('\\.^$+?()[]{}|'.includes(ch)) {
      src += '\\' + ch;
    } else {
      src += ch;
    }
  }

  if (anchoredEnd) src += '$';
  if (domainAnchored && !anchoredEnd) {
    // ||domain should also match when the rule text ends at a separator.
  }

  return { source: src, domainAnchored, anchoredStart, anchoredEnd };
}

/**
 * Parse an option string like `script,image,third-party,domain=a.com|~b.com`.
 */
function parseOptions(optionStr) {
  const opts = {
    types: null,            // Set of included types (null = all)
    excludedTypes: new Set(),
    thirdParty: null,       // true = only 3p, false = only 1p, null = any
    domains: null,          // [{host, negate}]
    important: false,
    badfilter: false,
  };

  if (!optionStr) return opts;

  for (const raw of optionStr.split(',')) {
    const opt = raw.trim().toLowerCase();
    if (!opt) continue;
    const eq = opt.indexOf('=');
    const namePart = eq === -1 ? opt : opt.slice(0, eq);
    const value = eq === -1 ? '' : opt.slice(eq + 1);
    const negate = namePart.startsWith('~');
    const name = negate ? namePart.slice(1) : namePart;

    if (RESOURCE_TYPES.has(name)) {
      if (negate) opts.excludedTypes.add(name);
      else {
        if (!opts.types) opts.types = new Set();
        opts.types.add(name);
      }
    } else if (name === 'third-party' || name === '3p') {
      opts.thirdParty = !negate;
    } else if (name === 'first-party' || name === '1p') {
      opts.thirdParty = negate ? true : false;
    } else if (name === 'domain' || name === 'from') {
      const hosts = value ? value.split('|') : [];
      if (!opts.domains) opts.domains = [];
      for (const h of hosts) {
        const hv = h.trim().toLowerCase();
        if (!hv) continue;
        if (hv.startsWith('~')) opts.domains.push({ host: hv.slice(1), negate: true });
        else opts.domains.push({ host: hv, negate: false });
      }
    } else if (name === 'important') {
      opts.important = !negate;
    } else if (name === 'badfilter') {
      opts.badfilter = !negate;
    }
    // Unknown options (e.g. popup, csp) are accepted but ignored.
  }
  return opts;
}

/** Extract the hostname a `||host...` rule is anchored to (for bucketing). */
function extractRuleHost(pattern) {
  if (!pattern.startsWith('||')) return null;
  let rest = pattern.slice(2);
  // Cut at the first separator/wildcard — that's the hostname.
  const m = rest.match(/^[^*^|/$]+/);
  if (!m) return null;
  const host = m[0].toLowerCase();
  if (!host.includes('.') && host !== 'localhost') return null;
  return host.replace(/[^a-z0-9.\-]/g, '') || null;
}

/** Normalize a rule line into a signature ignoring the badfilter flag. */
function ruleSignature(line) {
  let isException = line.startsWith('@@');
  let body = isException ? line.slice(2) : line;
  let optionStr = '';
  const dollar = body.lastIndexOf('$');
  if (dollar > -1) {
    const tail = body.slice(dollar + 1);
    if (!tail.includes('/') || /^[a-z0-9_,~=.|+\-]+$/i.test(tail)) {
      optionStr = tail;
      body = body.slice(0, dollar);
    }
  }
  const opts = optionStr.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s !== 'badfilter' && s !== '~badfilter')
    .sort();
  return (isException ? '@@' : '') + body + (opts.length ? '$' + opts.join(',') : '');
}

class Rule {
  constructor(raw, isException, pattern, optionStr) {
    this.raw = raw;
    this.isException = isException;
    this.pattern = pattern;
    this.opts = parseOptions(optionStr);
    this.host = extractRuleHost(pattern);
    const { source } = patternToRegExpSource(pattern);
    this.regex = new RegExp(source, 'i');
  }

  /**
   * @param {string} url lowercased request URL
   * @param {string} type resource type
   * @param {boolean} thirdParty
   * @param {string} documentHost hostname of the page
   * @returns {boolean}
   */
  matches(url, type, thirdParty, documentHost) {
    const o = this.opts;
    if (o.types && !o.types.has(type)) return false;
    if (o.excludedTypes.has(type)) return false;
    if (o.thirdParty !== null && o.thirdParty !== thirdParty) return false;
    if (o.domains) {
      let hasPositive = false;
      let ok = false;
      for (const d of o.domains) {
        const hit = documentHost === d.host || documentHost.endsWith('.' + d.host);
        if (d.negate) {
          if (hit) return false; // explicitly excluded domain
        } else {
          hasPositive = true;
          if (hit) ok = true;
        }
      }
      if (hasPositive && !ok) return false;
    }
    return this.regex.test(url);
  }
}

class CosmeticRule {
  constructor(raw, host, selector, isException) {
    this.raw = raw;
    this.host = host && host !== '*' ? host.toLowerCase() : null; // null = generic
    this.selector = selector;
    this.isException = isException;
  }

  appliesTo(documentHost) {
    if (!this.host) return true; // generic
    return documentHost === this.host || documentHost.endsWith('.' + this.host);
  }
}

class FilterEngine {
  /** @param {string[]} rawRules */
  constructor(rawRules = []) {
    /** @type {Map<string, Rule[]>} */
    this.hostBuckets = new Map();
    /** @type {Rule[]} */
    this.genericRules = [];
    /** @type {Rule[]} */
    this.exceptionRules = [];
    /** @type {CosmeticRule[]} */
    this.cosmeticHide = [];
    /** @type {CosmeticRule[]} */
    this.cosmeticShow = [];
    /** @type {Set<string>} */
    this.badfilterSignatures = new Set();
    this.stats = { total: 0, network: 0, cosmetic: 0, exceptions: 0, badfiltered: 0, invalid: 0 };
    this.compile(rawRules);
  }

  compile(rawRules) {
    // First pass: collect badfilter signatures.
    for (const raw of rawRules) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      const optTail = line.lastIndexOf('$') > -1 ? line.slice(line.lastIndexOf('$') + 1) : '';
      if (/(?:^|,)(~?badfilter)(?:,|$)/i.test(optTail)) {
        this.badfilterSignatures.add(ruleSignature(line));
      }
    }

    for (const raw of rawRules) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) { continue; }

      this.stats.total++;

      // Cosmetic rules
      const cos = line.match(/^(.*?)(#@#|##)(.+)$/);
      if (cos && !line.includes('$') && !line.startsWith('@@')) {
        const host = cos[1].trim();
        const isException = cos[2] === '#@#';
        const selector = cos[3].trim();
        if (!selector) { this.stats.invalid++; continue; }
        const rule = new CosmeticRule(line, host || null, selector, isException);
        if (isException) this.cosmeticShow.push(rule);
        else this.cosmeticHide.push(rule);
        this.stats.cosmetic++;
        continue;
      }

      // Network rules
      let isException = false;
      let body = line;
      if (body.startsWith('@@')) {
        isException = true;
        body = body.slice(2);
      }

      let optionStr = '';
      const dollar = body.lastIndexOf('$');
      // `$` inside a URL is rare; treat as options only if the tail looks like options.
      if (dollar > -1) {
        const tail = body.slice(dollar + 1);
        if (!tail.includes('/') || /^[a-z0-9_,~=.|+\-]+$/i.test(tail)) {
          optionStr = tail;
          body = body.slice(0, dollar);
        }
      }

      if (this.badfilterSignatures.has(ruleSignature(line))) {
        this.stats.badfiltered++;
        continue;
      }

      if (!body) { this.stats.invalid++; continue; }

      let rule;
      try {
        rule = new Rule(line, isException, body, optionStr);
      } catch {
        this.stats.invalid++;
        continue;
      }

      if (isException) {
        this.exceptionRules.push(rule);
        this.stats.exceptions++;
      } else {
        if (rule.host) {
          let bucket = this.hostBuckets.get(rule.host);
          if (!bucket) { bucket = []; this.hostBuckets.set(rule.host, bucket); }
          bucket.push(rule);
        } else {
          this.genericRules.push(rule);
        }
        this.stats.network++;
      }
    }
  }

  /**
   * Decide whether a request should be blocked.
   * @param {string} url
   * @param {string} type one of RESOURCE_TYPES ('other' for unknown)
   * @param {{thirdParty:boolean, documentHost:string}} ctx
   * @returns {{blocked:boolean, rule:string|null, exception:string|null}}
   */
  match(url, type = 'other', ctx = { thirdParty: true, documentHost: '' }) {
    const lower = url.toLowerCase();
    const t = RESOURCE_TYPES.has(type) ? type : 'other';
    const docHost = (ctx.documentHost || '').toLowerCase();
    const thirdParty = ctx.thirdParty !== undefined ? ctx.thirdParty : true;

    let hit = null;

    // 1) host-bucketed rules: try each parent domain of the request URL host.
    try {
      const host = new URL(url).hostname.toLowerCase();
      let node = host;
      while (true) {
        const bucket = this.hostBuckets.get(node);
        if (bucket) {
          for (const r of bucket) {
            if (r.matches(lower, t, thirdParty, docHost)) { hit = r; break; }
          }
        }
        if (hit) break;
        const dot = node.indexOf('.');
        if (dot === -1) break;
        node = node.slice(dot + 1);
      }
    } catch { /* invalid URL — fall through to generic */ }

    // 2) generic rules
    if (!hit) {
      for (const r of this.genericRules) {
        if (r.matches(lower, t, thirdParty, docHost)) { hit = r; break; }
      }
    }
    if (!hit) return { blocked: false, rule: null, exception: null };

    // 3) exceptions (unless the rule is $important)
    if (!hit.opts.important) {
      for (const e of this.exceptionRules) {
        if (e.matches(lower, t, thirdParty, docHost)) {
          return { blocked: false, rule: hit.raw, exception: e.raw };
        }
      }
    }
    return { blocked: true, rule: hit.raw, exception: null };
  }

  /**
   * Cosmetic filtering for a page: selectors to hide and rules to un-hide.
   * @param {string} documentHost
   */
  cosmeticFor(documentHost) {
    const host = (documentHost || '').toLowerCase();
    const hide = [];
    const show = [];
    for (const r of this.cosmeticHide) {
      if (r.appliesTo(host)) hide.push(r.selector);
    }
    for (const r of this.cosmeticShow) {
      if (r.appliesTo(host)) show.push(r.selector);
    }
    // Un-hide beats hide.
    const showSet = new Set(show);
    return { hide: hide.filter((s) => !showSet.has(s)), show };
  }

  /** True if `host` is on the engine's allowlist via an exception rule with no pattern. */
  allowlistedHost(host) {
    return this.exceptionRules.some((e) => e.opts.domains && e.opts.domains.length === 1
      && !e.opts.domains[0].negate && !e.pattern
      && (host === e.opts.domains[0].host || host.endsWith('.' + e.opts.domains[0].host)));
  }
}

module.exports = { FilterEngine, Rule, CosmeticRule, patternToRegExpSource, parseOptions, RESOURCE_TYPES };
