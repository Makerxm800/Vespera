/** Dependency-free ZIP / CRX extraction — pure Node, no Electron.
 *  Kept in src/shared so both the tooling and tests can use it; the Tauri
 *  build carries its own Rust implementation of the same safety checks. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/*
 * Dependency-free ZIP extraction (store + deflate). CRX files are ZIPs with a
 * signature header prepended, so we locate the End-of-Central-Directory and
 * parse central directory entries, then inflate local file data.
 */

function zipEntryPath(root, entryName) {
  const name = String(entryName || '').replace(/\\/g, '/');
  const parts = name.split('/');
  if (parts.at(-1) === '') parts.pop(); // ZIP directory entries end in a slash.
  if (!name || name.includes('\0') || name.startsWith('/') || !parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('This extension package contains an unsafe file path.');
  }
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, ...parts);
  const relative = path.relative(rootPath, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('This extension package contains an unsafe file path.');
  }
  return target;
}

function extractZip(zipPath, destDir) {
  return fs.promises.readFile(zipPath).then((buf) => {
    // CRX: "Cr24" magic + version + header length before the ZIP data.
    let offset = 0;
    if (buf.slice(0, 4).toString('ascii') === 'Cr24') {
      if (buf.readUInt32LE(4) > 3) throw new Error('This CRX version is not supported.');
      offset = 12 + buf.readUInt32LE(8);
    }
    // Find End Of Central Directory (signature 0x06054b50) from the tail.
    let eocd = -1;
    for (let i = buf.length - 22; i >= offset && i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('This file is not a valid extension package (ZIP/Crx).');
    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16) + offset;
    fs.mkdirSync(destDir, { recursive: true });
    const jobs = [];
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Corrupt extension package.');
      const method = buf.readUInt16LE(ptr + 10);
      const compSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localOff = buf.readUInt32LE(ptr + 42) + offset;
      const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
      ptr += 46 + nameLen + extraLen + commentLen;
      const outPath = zipEntryPath(destDir, name);
      if (name.endsWith('/')) { fs.mkdirSync(outPath, { recursive: true }); continue; }
      // Locate local header to find its own extra-field length.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Corrupt extension package.');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataStart, dataStart + compSize);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (method === 0) {
        jobs.push(fs.promises.writeFile(outPath, data));
      } else if (method === 8) {
        jobs.push(new Promise((res, rej) => zlib.inflateRaw(data, (e, out) => e ? rej(new Error('Corrupt extension package.')) : res(fs.promises.writeFile(outPath, out)))));
      } else {
        throw new Error('Unsupported compression in extension package.');
      }
    }
    return Promise.all(jobs).then(() => destDir);
  });
}

function findManifestDir(dir) {
  // Some zips nest the manifest one level down (repo-style zips).
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'manifest.json'))) {
      return path.join(dir, e.name, '');
    }
    if (e.isDirectory()) {
      const nested = findManifestDir(path.join(dir, e.name));
      if (nested) return nested;
    }
  }
  return null;
}

/** Copy a folder tree recursively (used to snapshot unpacked-folder installs into userData). */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
module.exports = { zipEntryPath, extractZip, findManifestDir, copyDir };
