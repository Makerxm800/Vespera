/**
 * Vespera icon generator — renders the Vespera app icon set with zero
 * external tools (pure Node: pixel math + zlib PNG encoding).
 *
 * Outputs (build/):
 *   icon.png            1024×1024 master (also used by Linux)
 *   icon.ico            Windows icon (16–256, PNG-embedded entries)
 *   icon.icns           macOS icon (128–1024@2x, PNG-embedded entries)
 *   icons/256x256.png   Linux (deb/AppImage convention)
 *   icons/512x512.png
 *
 * The design matches the in-app logo: a gold four-pointed "evening star"
 * sparkle on a deep twilight rounded square with a warm glow.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BUILD = path.resolve(__dirname, '..', 'build');

/* ============================== PNG encoder ============================== */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA pixel buffer as a PNG file. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ============================ Icon rasterizer ============================ */

// Four-pointed star ("evening star" sparkle), from the Vespera logo path
// M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z  (24×24 grid)
const STAR = [
  [12, 2], [14.4, 9.2], [22, 12], [14.4, 14.8],
  [12, 22], [9.6, 14.8], [2, 12], [9.6, 9.2],
];

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roundedRectContains(x, y, size, radius) {
  const min = radius;
  const max = size - radius;
  const cx = x < min ? min : x > max ? max : x;
  const cy = y < min ? min : y > max ? max : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function mix(a, b, t) { return a + (b - a) * t; }

/** Render the icon at `size`×`size` RGBA. */
function render(size) {
  const SS = 2;                       // supersampling factor
  const W = size * SS;
  const rgba = Buffer.alloc(W * W * 4);

  const radius = W * 0.222;
  const cx = W * 0.5;
  const cy = W * 0.47;
  const starR = W * 0.335;            // star half-span in px

  // Scale star polygon from 24-grid to pixel space (centered at cx,cy).
  const star = STAR.map(([sx, sy]) => [
    cx + (sx - 12) * (starR / 10),
    cy + (sy - 12) * (starR / 10),
  ]);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBg = roundedRectContains(x + 0.5, y + 0.5, W, radius);
      if (!inBg) { rgba[i + 3] = 0; continue; }

      // Background: deep twilight vertical gradient
      const t = y / W;
      let r = mix(0x12, 0x27, t);
      let g = mix(0x18, 0x33, t);
      let b = mix(0x36, 0x66, t);

      // Warm glow behind the star
      const dx = (x + 0.5 - cx) / W;
      const dy = (y + 0.5 - cy) / W;
      const d = Math.sqrt(dx * dx + dy * dy);
      const glow = Math.max(0, 1 - d / 0.42) ** 2 * 0.32;
      r = mix(r, 0xf6, glow * 0.75);
      g = mix(g, 0xb9, glow * 0.75);
      b = mix(b, 0x3b, glow * 0.6);

      // Star fill (gold vertical gradient)
      if (inPolygon(x + 0.5, y + 0.5, star)) {
        const st = Math.min(1, Math.max(0, (y - (cy - starR)) / (2 * starR)));
        r = mix(0xff, 0xef, st);
        g = mix(0xd1, 0xa2, st);
        b = mix(0x7c, 0x28, st);
      }

      rgba[i] = r | 0;
      rgba[i + 1] = g | 0;
      rgba[i + 2] = b | 0;
      rgba[i + 3] = 255;
    }
  }

  // Downsample SS→1 (box filter) for free anti-aliasing.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + x * SS + sx) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      // Average premultiplied to avoid dark fringes on the alpha edge.
      out[o] = a ? Math.round(r / n) : 0;
      out[o + 1] = a ? Math.round(g / n) : 0;
      out[o + 2] = a ? Math.round(b / n) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ============================ ICO / ICNS writers ========================= */

function buildIco(master) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => encodePng(s, s, render(s)));
  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  pngs.forEach((png, i) => {
    const e = Buffer.alloc(16);
    e[0] = sizes[i] >= 256 ? 0 : sizes[i]; // 0 = 256
    e[1] = sizes[i] >= 256 ? 0 : sizes[i];
    e.writeUInt16LE(1, 4);                 // planes
    e.writeUInt16LE(32, 6);                // bit depth
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

function buildIcns(master) {
  // type -> pixel size (PNG-embedded entries, macOS 10.7+)
  const types = [
    ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ];
  const chunks = types.map(([type, s]) => {
    const png = encodePng(s, s, render(s));
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

/* ================================= Main ================================= */

function main() {
  fs.mkdirSync(path.join(BUILD, 'icons'), { recursive: true });
  console.log('Rendering Vespera icon set…');

  const master = render(1024);
  fs.writeFileSync(path.join(BUILD, 'icon.png'), encodePng(1024, 1024, master));
  console.log('  build/icon.png            1024×1024');

  fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(master));
  console.log('  build/icon.ico            16–256 (Windows)');

  fs.writeFileSync(path.join(BUILD, 'icon.icns'), buildIcns(master));
  console.log('  build/icon.icns           128–1024@2x (macOS)');

  for (const s of [256, 512]) {
    fs.writeFileSync(path.join(BUILD, 'icons', `${s}x${s}.png`), encodePng(s, s, render(s)));
  }
  console.log('  build/icons/256x256.png   512x512.png (Linux)');
  console.log('Done.');
}

main();
