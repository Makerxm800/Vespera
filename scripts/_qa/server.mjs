/** Spawns the Vespera preview server for a QA run and tears it down afterwards. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer(port = 4617) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  const url = `http://localhost:${port}/`;
  const stop = () => { try { child.kill(); } catch { /* already gone */ } };
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return { child, url, stop };
    } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  stop();
  throw new Error('preview server did not start on ' + port);
}
