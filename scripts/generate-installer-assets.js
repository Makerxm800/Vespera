'use strict';

// Small, deterministic 24-bit BMP artwork for the Tauri NSIS wizard.
// Modern UI 2 expects 150×57 header and 164×314 sidebar bitmaps.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '..', 'src-tauri', 'icons');
const GOLD = [246, 190, 86];

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function starPoints(cx, cy, radius) {
  const inner = radius * 0.28;
  return [
    [cx, cy - radius], [cx + inner, cy - inner], [cx + radius, cy],
    [cx + inner, cy + inner], [cx, cy + radius], [cx - inner, cy + inner],
    [cx - radius, cy], [cx - inner, cy - inner],
  ];
}

function makeBmp(width, height, { sidebar = false } = {}) {
  const rowBytes = Math.ceil(width * 3 / 4) * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  const cx = sidebar ? width / 2 : 30;
  const cy = sidebar ? 82 : height / 2;
  const radius = sidebar ? 33 : 17;
  const star = starPoints(cx, cy, radius);
  const glowRadius = sidebar ? 86 : 43;

  // BMP rows are stored bottom-up, in BGR order, padded to a 4-byte boundary.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y / Math.max(1, height - 1);
      let r = 17 + (Math.min(1, t * 1.12) * 16);
      let g = 21 + (Math.min(1, t * 1.12) * 12);
      let b = 41 + (Math.min(1, t * 1.12) * 31);
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const glow = Math.max(0, 1 - dist / glowRadius) ** 2 * (sidebar ? 0.21 : 0.17);
      r += (GOLD[0] - r) * glow;
      g += (GOLD[1] - g) * glow;
      b += (GOLD[2] - b) * glow;
      if (pointInPolygon(x + 0.5, y + 0.5, star)) {
        const shade = Math.min(1, Math.max(0, (y - (cy - radius)) / (radius * 2)));
        r = GOLD[0] - shade * 8;
        g = GOLD[1] - shade * 35;
        b = GOLD[2] - shade * 72;
      }
      const offset = (height - 1 - y) * rowBytes + x * 3;
      pixels[offset] = Math.round(b);
      pixels[offset + 1] = Math.round(g);
      pixels[offset + 2] = Math.round(r);
    }
  }

  const headerSize = 14 + 40;
  const fileSize = headerSize + pixels.length;
  const file = Buffer.alloc(headerSize);
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(fileSize, 2);
  file.writeUInt32LE(headerSize, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(0, 30);
  file.writeUInt32LE(pixels.length, 34);
  file.writeInt32LE(2835, 38);
  file.writeInt32LE(2835, 42);
  return Buffer.concat([file, pixels]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'installer-header.bmp'), makeBmp(150, 57));
fs.writeFileSync(path.join(OUT, 'installer-sidebar.bmp'), makeBmp(164, 314, { sidebar: true }));
console.log('Generated NSIS header and sidebar artwork.');
