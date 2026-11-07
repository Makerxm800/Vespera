/** Vespera Logs page — see exactly what the app is doing (and what failed). */
import { icon } from '../icons.js';
import { escapeHtml, toast } from '../toasts.js';

export function renderLogs(container, ctx) {
  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">Logs</h1>
      <p class="page-sub">Everything Vespera does — startup steps, service status, errors with
        full stack traces. If something ever goes wrong, the answer is in here.</p>

      <div class="row" style="margin-bottom:18px;flex-wrap:wrap">
        <button class="btn btn-primary" id="log-refresh">${icon('refresh')} Refresh</button>
        <button class="btn" id="log-open">${icon('external')} Open log folder</button>
        <span class="chip" id="log-path-chip">${icon('download')} log file</span>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <pre id="log-body" style="margin:0;padding:18px;max-height:65vh;overflow:auto;
          font-family:var(--font-mono);font-size:11.5px;line-height:1.75;
          user-select:text;white-space:pre-wrap;word-break:break-word">Loading log…</pre>
      </div>
    </div>`;

  const body = container.querySelector('#log-body');

  async function refresh() {
    if (!window.vespera) {
      body.textContent =
        'Log viewing is available in the Vespera desktop app (npm start).\n' +
        'In this web preview, server logs are printed to the terminal that runs `npm run preview`.';
      return;
    }
    const [text, p] = await Promise.all([
      window.vespera.app.readLog(),
      window.vespera.app.logPath(),
    ]);
    body.textContent = text || '(log is empty)';
    const chip = container.querySelector('#log-path-chip');
    if (chip && p) {
      chip.textContent = p;
      chip.title = p;
    }
    body.scrollTop = body.scrollHeight;
  }

  container.querySelector('#log-refresh').addEventListener('click', () => refresh());
  container.querySelector('#log-open').addEventListener('click', async () => {
    if (!window.vespera) return toast('Available in the desktop app', 'info');
    const dir = await window.vespera.app.openLogs();
    toast('Opened ' + dir, 'ok');
  });

  refresh();
}
