/**
 * Browser updates: check GitHub Releases for a newer Vespera build, download
 * the installer for the current platform and hand it to the OS to install.
 * No auto-updater dependency — the app stays in control of every step.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, net, shell } = require('electron');

const RELEASES_API = 'https://api.github.com/repos/Makerxm800/Vespera/releases/latest';
const REQUEST_TIMEOUT = 12000;

/** Semver-ish compare: 0.1.9 > 0.1.8, 1.2.0 > 1.1.9. */
function compareVersions(a, b) {
  const parts = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Pick the downloadable installer asset for this OS/arch from a release. */
function pickAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const name = (asset) => String(asset?.name || '');
  const find = (re) => assets.find((asset) => re.test(name(asset)) && asset?.browser_download_url);
  if (process.platform === 'win32') return find(/^Vespera-Setup-.*\.exe$/i) || find(/^Vespera-.*\.exe$/i) || null;
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return find(new RegExp(`Vespera-.*-mac-${arch}\\.dmg$`, 'i')) || find(/Vespera-.*\.dmg$/i) || null;
  }
  return find(/Vespera-.*-linux-x64\.AppImage$/i) || find(/Vespera-.*\.deb$/i) || null;
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow' });
    request.setHeader('User-Agent', 'Vespera-Updater');
    request.setHeader('Accept', 'application/vnd.github+json');
    const timer = setTimeout(() => { try { request.abort(); } catch { /* already gone */ } reject(new Error('The update service timed out.')); }, REQUEST_TIMEOUT);
    let body = '';
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        clearTimeout(timer);
        const detail = response.statusCode === 404 ? 'No published release was found.' : `The update service answered with HTTP ${response.statusCode}.`;
        response.resume();
        return reject(new Error(detail));
      }
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); } catch { reject(new Error('The update service returned an invalid response.')); }
      });
    });
    request.on('error', (err) => { clearTimeout(timer); reject(err); });
    request.end();
  });
}

/** Download an asset to a temp file. Returns the resolved file path. */
async function downloadAsset(asset, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(asset.name));
  return new Promise((resolve, reject) => {
    const request = net.request({ url: asset.browser_download_url, redirect: 'follow' });
    request.setHeader('User-Agent', 'Vespera-Updater');
    const timer = setTimeout(() => { try { request.abort(); } catch { /* already gone */ } reject(new Error('The update download timed out.')); }, 300000);
    const file = fs.createWriteStream(dest);
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        clearTimeout(timer);
        response.resume();
        file.close(() => fs.rmSync(dest, { force: true }));
        return reject(new Error(`The update download failed (HTTP ${response.statusCode}).`));
      }
      response.pipe(file);
    });
    file.on('finish', () => file.close(() => { clearTimeout(timer); resolve(dest); }));
    file.on('error', (err) => { clearTimeout(timer); reject(err); });
    request.on('error', (err) => { clearTimeout(timer); reject(err); });
    request.end();
  });
}

/** Launch the downloaded installer for this platform. */
function launchInstaller(file) {
  try {
    if (process.platform === 'win32') {
      // The NSIS wizard installs and launches Vespera after it finishes.
      spawn('cmd.exe', ['/d', '/c', 'start', '""', file], { detached: true, stdio: 'ignore' }).unref();
      return 'The Vespera installer is opening. Follow the wizard to finish the update.';
    }
    if (process.platform === 'darwin') {
      spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
      return 'The Vespera disk image is opening. Drag Vespera over your current copy to update.';
    }
    fs.chmodSync(file, 0o755);
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    return 'The Vespera AppImage is downloading and will run once the download finishes.';
  } catch (err) {
    return `The installer could not be started: ${err.message}`;
  }
}

function createUpdateManager(log) {
  return {
    async check() {
      const current = app.getVersion();
      try {
        const release = await fetchJson(RELEASES_API);
        const latest = String(release?.tag_name || '').replace(/^v/i, '');
        return {
          ok: true, current, latest,
          hasUpdate: compareVersions(latest, current) > 0,
          url: release?.html_url || `https://github.com/Makerxm800/Vespera/releases`,
          publishedAt: release?.published_at || '',
          notes: String(release?.body || '').slice(0, 4000),
        };
      } catch (err) {
        log.error('Update check failed', err);
        return { ok: false, current, latest: '', hasUpdate: false, message: err.message || 'Could not reach the update service.' };
      }
    },
    async install(releaseInfo) {
      const current = app.getVersion();
      const latest = String(releaseInfo?.latest || '').replace(/^v/i, '');
      if (compareVersions(latest, current) <= 0) return { ok: false, message: 'This is already the latest version of Vespera.' };
      try {
        const release = await fetchJson(RELEASES_API);
        const asset = pickAsset(release);
        if (!asset) return { ok: false, message: 'No installer for your platform was published with this release.' };
        const dir = path.join(os.tmpdir(), `vespera-update-${Date.now()}`);
        const file = await downloadAsset(asset, dir);
        const message = launchInstaller(file);
        log.info(`Vespera update ${latest} downloaded to ${file}`);
        return { ok: true, latest, message, file };
      } catch (err) {
        log.error('Update install failed', err);
        return { ok: false, message: err.message || 'The update could not be downloaded.' };
      }
    },
    /** Let the user pick the file manually if an automated install is impossible. */
    async openReleases() {
      const error = await shell.openExternal('https://github.com/Makerxm800/Vespera/releases');
      return { ok: !error, message: error ? 'Could not open the releases page.' : '' };
    },
  };
}

module.exports = { createUpdateManager, compareVersions, pickAsset };
