import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml } from '../toasts.js';
import { downloadText } from '../downloads.js';
import { buildSearchUrl } from '../../../shared/privacy-utils.mjs';

export function renderReader(container, ctx) {
  const article = ctx.getActiveTab().reader;
  if (!article) { container.innerHTML = '<div class="page"><h1>Reader View</h1><p>Open an article, then choose Reader View from the Extensions page or command palette.</p></div>'; return; }
  const size = state.settings.readerFontSize || 18;
  container.innerHTML = `<div class="reader-page"><div class="reader-toolbar"><button class="btn btn-ghost" id="reader-back">← Back to page</button><span class="chip">Reader View</span><span class="grow"></span><button class="icon-btn" id="reader-smaller" title="Smaller text">A−</button><output id="reader-size">${size}</output><button class="icon-btn" id="reader-larger" title="Larger text">A+</button><button class="btn btn-ghost" id="reader-font">Serif</button><button class="icon-btn" id="reader-save" title="Save article as text">${icon('download')}</button></div><article class="reader-article"><span class="eyebrow">${escapeHtml(new URL(article.url).hostname)}</span><h1>${escapeHtml(article.title)}</h1><div class="reader-meta">About ${Math.max(1, Math.ceil(article.text.split(/\s+/).length / 220))} min read · Extracted locally${window.vespera ? '' : ' by the preview service'}</div><div id="reader-text"></div></article></div>`;
  const text = container.querySelector('#reader-text'); text.textContent = article.text;
  const apply = () => { text.style.fontSize = (state.settings.readerFontSize || 18) + 'px'; text.style.fontFamily = state.settings.readerSerif ? 'Georgia, serif' : 'var(--font)'; container.querySelector('#reader-size').textContent = state.settings.readerFontSize || 18; container.querySelector('#reader-font').textContent = state.settings.readerSerif ? 'Sans serif' : 'Serif'; };
  apply();
  container.querySelector('#reader-back').onclick = () => ctx.back();
  container.querySelector('#reader-smaller').onclick = () => { state.set('readerFontSize', Math.max(14, (state.settings.readerFontSize || 18) - 2)); apply(); };
  container.querySelector('#reader-larger').onclick = () => { state.set('readerFontSize', Math.min(30, (state.settings.readerFontSize || 18) + 2)); apply(); };
  container.querySelector('#reader-font').onclick = () => { state.set('readerSerif', !state.settings.readerSerif); apply(); };
  container.querySelector('#reader-save').onclick = () => downloadText(article.title + '\n\n' + article.url + '\n\n' + article.text, 'vespera-article.txt');
}

export function renderSearch(container, ctx) {
  const query = new URL(ctx.getActiveTab().url, 'http://vespera.internal').searchParams.get('q') || '';
  const fullWeb = buildSearchUrl(query, state.settings.searchEngine);
  container.innerHTML = `<div class="page search-page"><span class="eyebrow">HOSTED WEB PREVIEW</span><h1 class="page-title">Explore something new.</h1><p class="page-sub">This live preview searches public GitHub repositories. For general web results, use the full-web link below.</p>
    <form class="row" id="preview-search-form"><input class="input grow" id="preview-search-input" value="${escapeHtml(query)}" placeholder="Search projects, tools, and ideas…" aria-label="Search GitHub repositories"><button class="btn btn-primary" type="submit">${icon('search')} Search</button></form>
    <div class="row" style="margin:16px 0;flex-wrap:wrap"><span class="chip chip-accent">GitHub repositories</span><span class="grow"></span><a class="text-btn" href="${escapeHtml(fullWeb)}" target="_blank" rel="noopener noreferrer">Search the full web ↗</a></div><div id="preview-results"><div class="empty">Enter a topic to start exploring.</div></div></div>`;
  container.querySelector('#preview-search-form').onsubmit = (e) => { e.preventDefault(); const q = container.querySelector('#preview-search-input').value.trim(); if (q) ctx.navigate('vespera://search?q=' + encodeURIComponent(q)); };
  const controller = new AbortController();
  if (query) {
    const results = container.querySelector('#preview-results'); results.innerHTML = '<div class="empty"><div class="spinner"></div>Searching GitHub…</div>';
    fetch('/proxy?vp=0&url=' + encodeURIComponent('https://api.github.com/search/repositories?q=' + encodeURIComponent(query) + '&per_page=10'), { signal: controller.signal }).then(async (r) => {
      const data = await r.json(); if (!r.ok) throw new Error(r.status === 403 ? 'GitHub’s preview search limit was reached. Try again shortly or use the full-web link.' : data.message || 'Search is temporarily unavailable.'); return data;
    }).then((data) => {
      results.innerHTML = `<p class="small muted" style="margin-bottom:16px">${Number(data.total_count || 0).toLocaleString()} repositories found · showing ${data.items?.length || 0}</p>` + (data.items?.length ? data.items.map((repo) => `<article class="search-result"><div class="small muted">${escapeHtml(repo.full_name)}</div><button class="search-result-title" data-result-url="${escapeHtml(repo.html_url)}">${escapeHtml(repo.name)} ${icon('external')}</button><p>${escapeHtml(repo.description || 'Explore this project on GitHub.')}</p><div class="row"><span class="chip">★ ${Number(repo.stargazers_count || 0).toLocaleString()}</span>${repo.language ? `<span class="chip">${escapeHtml(repo.language)}</span>` : ''}<span class="small faint">Updated ${new Date(repo.updated_at).toLocaleDateString()}</span></div></article>`).join('') : '<div class="empty">No repositories found. Try a broader topic.</div>');
      results.querySelectorAll('[data-result-url]').forEach((btn) => btn.onclick = () => ctx.navigate(btn.dataset.resultUrl));
    }).catch((err) => { if (err.name !== 'AbortError') results.innerHTML = `<div class="empty">${icon('warning')}<p>${escapeHtml(err.message)}</p><a class="btn" href="${escapeHtml(fullWeb)}" target="_blank" rel="noopener noreferrer">Open full-web search</a></div>`; });
  }
  return () => controller.abort();
}
export function renderNotFound(container, ctx) {
  container.innerHTML = `<div class="page"><div class="empty">${icon('globe')}<h1>That Vespera page doesn’t exist.</h1><p>Try Home, Settings, History, Downloads, or Extensions.</p><button class="btn btn-primary" id="notfound-home">Take me home</button></div></div>`;
  container.querySelector('#notfound-home').onclick = () => ctx.navigate('vespera://newtab');
}
