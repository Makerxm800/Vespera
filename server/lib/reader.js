'use strict';
/** Conservative text extraction for the preview's Reader View; never executes site code. */
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity[0] === '#') {
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return named[entity.toLowerCase()] ?? all;
  });
}
function extractArticle(html, url) {
  let text = String(html).slice(0, 4 * 1024 * 1024);
  const title = decodeEntities(text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Article').replace(/<[^>]*>/g, '').trim();
  text = text.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || text;
  text = text.replace(/<(script|style|nav|header|footer|aside|form|noscript|svg|iframe|button)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/blockquote|\/section)[^>]*>/gi, '\n\n').replace(/<[^>]*>/g, '');
  text = decodeEntities(text).replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, 120000);
  return { title: title.slice(0, 500), text, url };
}
module.exports = { extractArticle };
