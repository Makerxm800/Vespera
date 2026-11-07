/** Community page — the Vespera feature-request voting board (roadmap item 4). */
import { icon } from '../icons.js';
import { state } from '../state.js';
import * as api from '../../js/api.js';
import { escapeHtml, toast } from '../toasts.js';

const STATUS_CHIP = {
  open: '<span class="chip">Open</span>',
  planned: '<span class="chip chip-info">Planned</span>',
  'in-progress': '<span class="chip chip-warn">In progress</span>',
  shipped: '<span class="chip chip-ok">Shipped</span>',
};
const CATEGORY_ICON = {
  idea: 'sparkle', privacy: 'shield', performance: 'bolt',
  design: 'palette', sync: 'refresh', dev: 'code',
};
const STATUSES = ['open', 'planned', 'in-progress', 'shipped'];

export function renderCommunity(container, ctx) {
  let sort = 'votes';
  let expanded = null;

  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">Community</h1>
      <p class="page-sub">Vespera's roadmap is decided here. Propose features, vote on ideas, and watch
        what's planned, in progress and shipped. The most-voted ideas win.</p>

      <div class="cm-newform" id="cm-form">
        <div class="row" style="gap:10px">
          <input class="input grow" id="cm-title" placeholder="Your feature idea — e.g. 'Tab groups with colors'" maxlength="120">
          <select class="select" id="cm-cat" style="width:160px">
            <option value="idea">💡 Idea</option>
            <option value="privacy">🛡️ Privacy</option>
            <option value="performance">⚡ Performance</option>
            <option value="design">🎨 Design</option>
            <option value="sync">🔄 Sync</option>
            <option value="dev">🧑‍💻 Developer</option>
          </select>
        </div>
        <textarea class="textarea" id="cm-body" placeholder="Describe the problem it solves and how you'd like it to work…" maxlength="2000"></textarea>
        <div class="row" style="justify-content:space-between">
          <span class="small faint">Posting as ${state.user ? escapeHtml(state.user.displayName) : 'guest — sign in required'}</span>
          <button class="btn btn-primary" id="cm-post">${icon('send')} Post idea</button>
        </div>
      </div>

      <div class="cm-toolbar">
        <div class="segmented" id="cm-sort">
          <button data-v="votes" class="active">Top</button>
          <button data-v="new">New</button>
          <button data-v="status">By status</button>
        </div>
        <div class="grow"></div>
        <span class="chip chip-accent" id="cm-count">…</span>
      </div>

      <div class="cm-list" id="cm-list">
        <div class="empty">${icon('users')}<div>Loading community ideas…</div></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);

  async function load() {
    const r = await api.community.list(sort);
    const list = $('#cm-list');
    if (!r.ok) {
      list.innerHTML = `<div class="empty">${icon('warning')}<div>Could not load ideas — is the Vespera service running?</div></div>`;
      return;
    }
    const reqs = r.requests || [];
    $('#cm-count').textContent = `${reqs.length} ideas`;
    if (!reqs.length) {
      list.innerHTML = `<div class="empty">${icon('sparkle')}<div>No ideas yet — be the first to post one!</div></div>`;
      return;
    }
    list.innerHTML = reqs.map((q) => cardHtml(q)).join('');
    wireCards(reqs);
  }

  function cardHtml(q) {
    const isOpen = expanded === q.id;
    return `
      <div class="cm-card" data-id="${q.id}">
        <div class="cm-votes">
          <button class="vote-btn ${q.myVote === 1 ? 'voted' : ''}" data-vote="1" data-id="${q.id}" title="Upvote">
            ${icon('arrowUp')}
          </button>
          <div class="cm-score" data-score="${q.id}">${q.score}</div>
          <button class="vote-btn ${q.myVote === -1 ? 'voted' : ''}" data-vote="-1" data-id="${q.id}" title="Downvote">
            ${icon('arrowDown')}
          </button>
        </div>
        <div class="cm-main">
          <h3>${escapeHtml(q.title)}</h3>
          <div class="cm-body">${escapeHtml(q.body || '')}</div>
          <div class="cm-meta">
            ${STATUS_CHIP[q.status] || ''}
            <span class="chip">${icon(CATEGORY_ICON[q.category] || 'sparkle')} ${escapeHtml(q.category)}</span>
            <span class="small faint">by ${escapeHtml(q.authorName)} · ${timeAgo(q.createdAt)} · ${q.commentCount || 0} comments</span>
            ${state.user?.isAdmin ? `
              <select class="select" data-status-for="${q.id}" style="width:130px;padding:4px 8px;font-size:12px">
                ${STATUSES.map((s) => `<option value="${s}" ${q.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>` : ''}
          </div>
          ${isOpen ? `<div class="cm-comments" data-comments="${q.id}"><div class="small faint">Loading comments…</div></div>` : ''}
        </div>
      </div>`;
  }

  function wireCards(reqs) {
    const list = $('#cm-list');
    list.querySelectorAll('[data-vote]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!state.user) { toast('Sign in to vote', 'error'); return; }
        const id = btn.dataset.id;
        const value = Number(btn.dataset.vote);
        const current = reqs.find((q) => q.id === id)?.myVote;
        const r = await api.community.vote(id, current === value ? 0 : value);
        if (!r.ok) return toast('Vote failed', 'error');
        const q = reqs.find((x) => x.id === id);
        if (q) { q.score = r.score; q.myVote = r.myVote; }
        const scoreEl = list.querySelector(`[data-score="${id}"]`);
        if (scoreEl) scoreEl.textContent = r.score;
        list.querySelectorAll(`[data-vote][data-id="${id}"]`).forEach((b) => {
          b.classList.toggle('voted', Number(b.dataset.vote) === r.myVote);
        });
      });
    });

    list.querySelectorAll('.cm-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const id = card.dataset.id;
        expanded = expanded === id ? null : id;
        if (!expanded) { load(); return; }
        const host = card.querySelector(`[data-comments="${id}"]`);
        if (!host) { load(); return; }
        const r = await api.community.comments(id);
        host.innerHTML = (r.comments || []).map((c) => `
          <div class="cm-comment">
            <div class="avatar" style="--hue:${(c.authorName || '').length * 37 % 360}">${escapeHtml((c.authorName || '?')[0].toUpperCase())}</div>
            <div>
              <div><span class="cm-c-name">${escapeHtml(c.authorName)}</span><span class="cm-c-time">${timeAgo(c.createdAt)}</span></div>
              <div class="cm-c-body">${escapeHtml(c.body)}</div>
            </div>
          </div>`).join('') + `
          ${state.user ? `
            <div class="row" style="margin-top:6px">
              <input class="input grow" placeholder="Add a comment…" data-new-comment="${id}">
              <button class="btn" data-send-comment="${id}">${icon('send')}</button>
            </div>` : `<div class="small faint" style="margin-top:6px">Sign in to join the discussion.</div>`}`;

        host.querySelector(`[data-send-comment]`)?.addEventListener('click', async () => {
          const input = host.querySelector(`[data-new-comment]`);
          const body = input.value.trim();
          if (!body) return;
          const res = await api.community.comment(id, body);
          if (res.ok) { toast('Comment posted', 'ok'); expanded = null; load(); expanded = id; setTimeout(load, 0); }
          else toast(res.message || 'Comment failed', 'error');
        });
      });
    });

    list.querySelectorAll('[data-status-for]').forEach((sel) => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', async () => {
        const r = await api.community.setStatus(sel.dataset.statusFor, sel.value);
        if (r.ok) { toast('Status updated', 'ok'); load(); }
      });
    });
  }

  $('#cm-sort').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-v]');
    if (!btn) return;
    $('#cm-sort').querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    sort = btn.dataset.v;
    expanded = null;
    load();
  });

  $('#cm-post').addEventListener('click', async () => {
    if (!state.user) {
      toast('Sign in to post ideas', 'error');
      ctx.navigate('vespera://account');
      return;
    }
    const title = $('#cm-title').value.trim();
    const body = $('#cm-body').value.trim();
    const category = $('#cm-cat').value;
    if (title.length < 4) return toast('Give your idea a title (4+ chars)', 'error');
    const r = await api.community.create(title, body, category);
    if (r.ok) {
      toast('Idea posted — let the votes begin!', 'ok');
      $('#cm-title').value = '';
      $('#cm-body').value = '';
      load();
    } else {
      toast(r.message || 'Could not post', 'error');
    }
  });

  load();
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
