/**
 * Best-effort website preview proxy. This is NOT a replacement for Chromium.
 * It rewrites document links/assets, isolates cookies, and blocks private-network
 * targets. Complex apps, sign-in, POST forms and streaming sites need desktop mode.
 */
'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { FilterEngine } = require('../../src/shared/filter-engine');
const { BASE_TRACKERS, AD_RULES, ANNOYANCES } = require('../../src/shared/blocklists');
const trackerEngine = new FilterEngine(BASE_TRACKERS), adEngine = new FilterEngine(AD_RULES), annoyanceEngine = new FilterEngine(ANNOYANCES);
const DEFAULT_PREFS = 23;
const MAX_BYTES = 20 * 1024 * 1024;
const STRIP_HEADERS = new Set([
  'x-frame-options', 'content-security-policy', 'content-security-policy-report-only',
  'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'cross-origin-resource-policy', 'content-encoding', 'content-length', 'transfer-encoding',
  'set-cookie', 'cookie', 'authorization', 'proxy-authorization', 'location',
]);

function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) ||
      (a === 203 && b === 0) || (a === 192 && b === 88));
  }
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return publicAddress(a.slice(7));
    return !(a === '::' || a === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(a) || a.startsWith('2001:db8:'));
  }
  return false;
}
async function validateTarget(target) {
  let u;
  try { u = new URL(target); } catch { throw new Error('Invalid website address.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS websites can be previewed.');
  if (u.username || u.password) throw new Error('URLs containing credentials are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = (process.env.VESPERA_PROXY_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.some((h) => host === h || host.endsWith('.' + h))) {
    const err = new Error(`${u.hostname} is not reachable from this hosted preview. Open the original site in your browser, or use the desktop app for unrestricted browsing.`);
    err.code = 'PREVIEW_HOST_LIMIT'; throw err;
  }
  if (process.env.VESPERA_PROXY_ALLOW_PRIVATE !== '1') {
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error('Private and local network addresses are blocked by the preview proxy.');
  }
  return u;
}
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (process.env.VESPERA_PROXY_ALLOW_PRIVATE !== '1' && addresses.some((a) => !publicAddress(a.address))) {
      return callback(new Error('Private network address blocked.'));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

async function fetchRemote(targetUrl, method = 'GET', headers = {}, body = null, redirects = 5) {
  const url = await validateTarget(targetUrl);
  if (method !== 'GET') throw new Error('The preview supports GET requests only. Use desktop mode for this form.');
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET', lookup: safeLookup,
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        accept: headers.accept || 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9', 'accept-encoding': 'identity',
        'sec-gpc': headers['sec-gpc'] ?? '1', dnt: headers.dnt ?? '1',
      },
      timeout: 18000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects.'));
        return resolve(fetchRemote(new URL(res.headers.location, url).href, method, headers, null, redirects - 1));
      }
      const chunks = []; let size = 0; let failed = false;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { failed = true; req.destroy(new Error('This resource is too large for the web preview (20 MB limit).')); }
        else chunks.push(c);
      });
      res.on('end', () => {
        if (failed || res.aborted) return;
        let body = Buffer.concat(chunks);
        try {
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
          if (encoding === 'gzip') body = zlib.gunzipSync(body, { maxOutputLength: MAX_BYTES });
          else if (encoding === 'deflate') body = zlib.inflateSync(body, { maxOutputLength: MAX_BYTES });
          else if (encoding === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength: MAX_BYTES });
        } catch { return reject(new Error('Could not decode the website response.')); }
        resolve({ status: res.statusCode, headers: res.headers, body, finalUrl: url.href });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The site took too long to respond.')));
    req.on('error', reject);
    req.end();
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function absoluteUrl(value, base) {
  try {
    const u = new URL(String(value).trim(), base);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}
function blockKind(abs, type, doc, mask) {
  if (!(mask & 1) || (mask & 32) || type === 'document') return '';
  let host = ''; try { host = new URL(doc).hostname; } catch {}
  let third = true; try { third = new URL(abs).hostname !== host; } catch {}
  const ctx = { thirdParty: third, documentHost: host };
  if ((mask & 2) && trackerEngine.match(abs, type, ctx).blocked) return 'tracker';
  if ((mask & 4) && adEngine.match(abs, type, ctx).blocked) return 'ad';
  return '';
}
function hostAllowed(host) {
  const allowed = (process.env.VESPERA_PROXY_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.some((h) => host === h || host.endsWith('.' + h));
}
function proxied(value, base, extra = '', type = 'other', doc = base, mask = DEFAULT_PREFS, origin = '') {
  const abs = absoluteUrl(value, base);
  if (!abs) return value;
  const blocked = blockKind(abs, type, doc, mask);
  // Static assets may load directly in the user's browser even when the sandbox
  // cannot fetch their CDN. Document navigations still use the guarded proxy.
  if (!blocked && type !== 'document' && !hostAllowed(new URL(abs).hostname)) return abs;
  return origin + '/proxy?url=' + encodeURIComponent(abs) + extra + '&vt=' + type + '&doc=' + encodeURIComponent(doc) + (blocked ? '&vespera_blocked=' + blocked : '');
}
function rewriteCss(css, base, extra = '', doc = base, mask = DEFAULT_PREFS, origin = '') {
  return String(css).replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (all, quote, value) => {
    if (/^(data:|blob:|#)/i.test(value)) return all;
    return `url("${proxied(value, base, extra, 'other', doc, mask, origin)}")`;
  }).replace(/@import\s+(["'])(.*?)\1/gi, (all, q, value) => `@import "${proxied(value, base, extra, 'stylesheet', doc, mask, origin)}"`);
}
function bridgeScript(pageUrl, error = '', extra = '', parentOrigin = '') {
  const config = JSON.stringify({ url: pageUrl, error, extra, parentOrigin }).replace(/</g, '\\u003c');
  return `<script data-vespera-bridge>(()=>{
    const cfg=${config};
    const report=()=>parent.postMessage({type:'vespera:page',title:document.title||new URL(cfg.url).hostname,url:cfg.url,error:cfg.error},'*');
    report();document.addEventListener('DOMContentLoaded',report);
    const original=(v)=>{try{const parsed=new URL(v,cfg.url);if(parsed.origin===location.origin&&parsed.pathname==='/proxy'){const target=parsed.searchParams.get('url');return target&&/^https?:/.test(target)?target:null}const u=parsed;return /^https?:$/.test(u.protocol)?u.href:null}catch{return null}};
    const proxify=(v)=>{const u=original(v);return u?location.origin+'/proxy?url='+encodeURIComponent(u)+cfg.extra+'&vt=xmlhttprequest&doc='+encodeURIComponent(cfg.url):v};
    document.addEventListener('click',e=>{
      const a=e.target.closest?.('a[href]');if(!a)return;
      const url=original(a.getAttribute('href'));if(!url)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(a.hasAttribute('download'))parent.postMessage({type:'vespera:download',url,name:a.getAttribute('download')||''},'*');
      else {
        const modified=e.ctrlKey||e.metaKey;
        const targetBlank=(a.getAttribute('target')||'').toLowerCase()==='_blank';
        const newTab=targetBlank||modified;
        parent.postMessage({type:'vespera:navigate',url,newTab,foreground:!modified||e.shiftKey,gesture:modified?'modifier':''},'*');
      }
    },true);
    document.addEventListener('auxclick',e=>{
      if(e.button!==1)return;
      const a=e.target.closest?.('a[href]');if(!a)return;
      const url=original(a.getAttribute('href'));if(!url)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(a.hasAttribute('download'))parent.postMessage({type:'vespera:download',url,name:a.getAttribute('download')||''},'*');
      else parent.postMessage({type:'vespera:navigate',url,newTab:true,foreground:false,gesture:'middle'},'*');
    },true);
    document.addEventListener('contextmenu',e=>{
      const editable=e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
      if(editable)return;
      e.preventDefault();
      const a=e.target.closest?.('a[href]'),img=e.target.closest?.('img');
      parent.postMessage({type:'vespera:context',x:e.clientX,y:e.clientY,link:a?original(a.getAttribute('href')):null,image:img?original(img.getAttribute('src')):null,selection:String(window.getSelection()||'').slice(0,2000)},'*');
    },true);
    document.addEventListener('submit',e=>{
      const f=e.target;if(!(f instanceof HTMLFormElement))return;
      e.preventDefault();
      if((f.method||'get').toLowerCase()!=='get'){alert('This form needs the desktop app. The web preview does not submit account or payment forms.');return;}
      const url=new URL(original(f.getAttribute('action'))||cfg.url);
      for(const [k,v] of new FormData(f))if(typeof v==='string')url.searchParams.append(k,v);
      parent.postMessage({type:'vespera:navigate',url:url.href,newTab:false},'*');
    },true);
    let reported=0;
    const countBlocks=()=>{for(const entry of performance.getEntriesByType('resource').slice(reported)){reported++;let u;try{u=new URL(entry.name)}catch{continue}const kind=u.searchParams.get('vespera_blocked');if(kind)parent.postMessage({type:'vespera:shield',kind,count:1},'*')}};
    document.addEventListener('DOMContentLoaded',()=>setTimeout(countBlocks,100));setTimeout(countBlocks,1500);setTimeout(countBlocks,4000);
    const fetchOriginal=window.fetch;
    window.fetch=function(input,init){
      try{if(typeof input==='string'||input instanceof URL)input=proxify(String(input));}catch{}
      return fetchOriginal.call(window,input,{...init,credentials:'omit'});
    };
    const openOriginal=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url,...rest){return openOriginal.call(this,method,proxify(String(url)),...rest)};
    window.open=(url)=>{const u=original(url);if(u)parent.postMessage({type:'vespera:navigate',url:u,newTab:true,foreground:true},'*');return null};
    let tabMuted=false,audioQueued=false;
    const originalMuted=new WeakMap(),watchedMedia=new WeakSet();
    const reportAudio=()=>{audioQueued=false;const audible=[...document.querySelectorAll('audio,video')].some(m=>!m.paused&&!m.ended&&!m.muted&&m.volume>0);parent.postMessage({type:'vespera:audio',audible},'*')};
    const queueAudioReport=()=>{if(audioQueued)return;audioQueued=true;setTimeout(reportAudio,40)};
    const watchMedia=(media)=>{if(!(media instanceof HTMLMediaElement))return;if(!originalMuted.has(media))originalMuted.set(media,Boolean(media.muted));if(tabMuted)media.muted=true;if(watchedMedia.has(media))return;watchedMedia.add(media);for(const name of ['play','playing','pause','ended','volumechange','emptied'])media.addEventListener(name,queueAudioReport)};
    const scanMedia=(root=document)=>{if(root instanceof HTMLMediaElement)watchMedia(root);root.querySelectorAll?.('audio,video').forEach(watchMedia);queueAudioReport()};
    window.addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.type!=='vespera:mute')return;tabMuted=Boolean(e.data.muted);for(const media of document.querySelectorAll('audio,video')){watchMedia(media);media.muted=tabMuted||originalMuted.get(media)}queueAudioReport()});
    if(document.documentElement)new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scanMedia(node)}).observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('DOMContentLoaded',()=>scanMedia(),{once:true});scanMedia();
  })();</script>`;
}
function rewriteHtml(html, pageUrl, { dark = false, error = '', mask = DEFAULT_PREFS, origin = '' } = {}) {
  const extra = '&vp=' + mask + (dark ? '&vespera_dark=1' : '');
  let out = String(html).replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|refresh)["']?[^>]*>/gi, '');
  out = out.replace(/<([a-z][\w:-]*)\b([^>]*)>/gi, (tag, name, attrs) => {
    attrs = attrs.replace(/\sintegrity\s*=\s*(["']).*?\1/gi, '');
    attrs = attrs.replace(/\s(src|href|poster|action)\s*=\s*(["'])(.*?)\2/gi, (a, key, q, value) => {
      if (name.toLowerCase() === 'a' && /^#/.test(value)) return a;
      const tag = name.toLowerCase();
      const type = key === 'src' ? ({ script: 'script', img: 'image', iframe: 'subdocument', source: 'media', video: 'media', audio: 'media' }[tag] || 'other') : key === 'href' && tag === 'link' ? 'stylesheet' : 'document';
      return ` ${key}=${q}${esc(proxied(value, pageUrl, type === 'document' ? '' : extra, type, pageUrl, mask, origin))}${q}`;
    });
    attrs = attrs.replace(/\ssrcset\s*=\s*(["'])(.*?)\1/gi, (a, q, value) => ` srcset="${esc(value.split(',').map((part) => {
      const pieces = part.trim().split(/\s+/); pieces[0] = proxied(pieces[0], pageUrl, extra, 'image', pageUrl, mask, origin); return pieces.join(' ');
    }).join(', '))}"`);
    return `<${name}${attrs}>`;
  });
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (a, open, css, close) => open + rewriteCss(css, pageUrl, extra, pageUrl, mask, origin) + close);
  out = out.replace(/\sstyle\s*=\s*(["'])(.*?)\1/gi, (a, q, css) => ` style="${esc(rewriteCss(css, pageUrl))}"`);
  const darkStyle = dark ? '<style data-vespera-dark>html{filter:invert(1) hue-rotate(180deg)!important;background:#111!important}img,video,canvas,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}</style>' : '';
  if ((mask & 1) && !(mask & 32)) {
    let host = ''; try { host = new URL(pageUrl).hostname; } catch {}
    const selectors = [...((mask & 4) ? adEngine.cosmeticFor(host).hide : []), ...((mask & 8) ? annoyanceEngine.cosmeticFor(host).hide : [])];
    if (selectors.length) out += '<style data-vespera-shields>' + selectors.map((s) => s + '{display:none!important}').join('') + '</style>';
  }
  const head = `<base href="${esc(pageUrl)}">${bridgeScript(pageUrl, error, extra, origin)}${darkStyle}`;
  if (/<head[^>]*>/i.test(out)) return out.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  if (/<html[^>]*>/i.test(out)) return out.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${out}</body></html>`;
}
function errorDocument(message, target) {
  return `<!doctype html><html><head><title>Site unavailable</title>${bridgeScript(target, message)}</head><body style="font-family:system-ui;background:#0e1428;color:#e9edfb;padding:48px"><h1>Site unavailable</h1><p>${esc(message)}</p></body></html>`;
}
async function handleProxy(req, res, url) {
  const target = url.searchParams.get('url') || '';
  const dark = url.searchParams.get('vespera_dark') === '1';
  const rawMask = url.searchParams.get('vp');
  const mask = rawMask !== null && /^\d+$/.test(rawMask) ? Number(rawMask) & 63 : DEFAULT_PREFS;
  const type = url.searchParams.get('vt') || 'document';
  const doc = url.searchParams.get('doc') || target;
  const blocked = url.searchParams.get('vespera_blocked') || blockKind(target, type, doc, mask);
  if (blocked) {
    const types = { script: 'text/javascript', stylesheet: 'text/css', image: 'image/gif' };
    res.writeHead(200, { 'content-type': types[type] || 'text/plain', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'content-security-policy': "sandbox allow-scripts" });
    return res.end(type === 'image' ? Buffer.from('R0lGODlhAQABAIAAAAAAAP///yW5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') : '/* blocked by Vespera Shields */');
  }
  let finalUrl = target;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const origin = /^[a-z0-9.\-:\[\]]+$/i.test(req.headers.host || '') ? proto + '://' + req.headers.host : '';
  try {
    const result = await fetchRemote(target, 'GET', { 'sec-gpc': (mask & 1) && (mask & 16) ? '1' : '0', dnt: (mask & 1) && (mask & 16) ? '1' : '0' });
    if (res.destroyed) return;
    finalUrl = result.finalUrl;
    const headers = {};
    for (const [k, v] of Object.entries(result.headers)) if (!STRIP_HEADERS.has(k.toLowerCase())) headers[k] = v;
    const type = String(result.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    headers['cache-control'] = 'no-store';
    headers['access-control-allow-origin'] = '*';
    headers['cross-origin-resource-policy'] = 'cross-origin';
    headers['content-security-policy'] = "sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals";
    headers['referrer-policy'] = 'no-referrer';
    if (url.searchParams.get('download') === '1' || /attachment\s*;/i.test(String(result.headers['content-disposition'] || ''))) {
      const name = (new URL(finalUrl).pathname.split('/').pop() || 'download').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150);
      headers['content-disposition'] = `attachment; filename="${name}"`;
    } else delete headers['content-disposition'];
    let body = result.body;
    if (type === 'text/html' || type === 'application/xhtml+xml' || type === '') {
      headers['content-type'] = 'text/html; charset=utf-8';
      body = rewriteHtml(body.toString('utf8'), finalUrl, { dark, mask, origin });
    } else if (type === 'text/css') {
      headers['content-type'] = 'text/css; charset=utf-8'; body = rewriteCss(body.toString('utf8'), finalUrl, '&vp=' + mask + (dark ? '&vespera_dark=1' : ''), finalUrl, mask, origin);
    }
    res.writeHead(result.status, headers); res.end(body);
  } catch (err) {
    if (res.destroyed || res.headersSent) return;
    res.writeHead(err.code === 'PREVIEW_HOST_LIMIT' ? 403 : 502, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "sandbox allow-scripts allow-forms",
    });
    res.end(errorDocument(err.message || 'Could not reach this site.', target));
  }
}
module.exports = { handleProxy, fetchRemote, rewriteHtml, rewriteCss, validateTarget, publicAddress, bridgeScript };
