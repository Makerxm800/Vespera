import { clampAdjust } from '../../shared/wallpaper-adjust.mjs';
export { clampAdjust };

/** Wallpapers stay on this device. Large uploads use IndexedDB, not account sync. */
export const WALLPAPERS = [
  { id: 'twilight', name: 'Twilight lake', image: 'assets/twilight.jpg', color: '#101b36' },
  { id: 'aurora', name: 'Northern lights', color: '#102c35', css: 'radial-gradient(ellipse at 20% 0%, #287c7955, transparent 65%), radial-gradient(ellipse at 85% 30%, #7662ba66, transparent 60%), linear-gradient(160deg, #102c35, #10172e)' },
  { id: 'dawn', name: 'First light', color: '#513b51', css: 'radial-gradient(ellipse at 70% 100%, #ecac8266, transparent 65%), linear-gradient(155deg, #513b51, #242a49 70%, #142333)' },
  { id: 'none', name: 'Quiet solid', color: '#101626', css: 'none' },
];

const LEGACY_CUSTOM_ID = 'custom';
let customUrl = null;
let customUrlId = null;
let generation = 0;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vespera-wallpapers', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('images')) req.result.createObjectStore('images');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getRecord(id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const req = tx.objectStore('images').get(id);
    let result;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}
function writeRecord(id, value) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(value, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}
function storedBlob(record) {
  if (record instanceof Blob) return record; // v0.1.6/v0.1.7 legacy entry
  return record && typeof record === 'object' && record.blob instanceof Blob ? record.blob : null;
}
const safeName = (name) => String(name || 'Custom wallpaper').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'Custom wallpaper';

/** List custom images and their previews; the old single `custom` blob is migrated lazily. */
export async function listCustomWallpapers() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    let keys, values;
    keysRequest.onsuccess = () => { keys = keysRequest.result; };
    valuesRequest.onsuccess = () => { values = valuesRequest.result; };
    tx.oncomplete = () => {
      db.close();
      const wallpapers = (keys || []).map((id, index) => {
        const record = values?.[index];
        const blob = storedBlob(record);
        if (!blob || typeof id !== 'string') return null;
        const metadata = record instanceof Blob ? {} : record;
        return {
          id,
          name: safeName(metadata?.name || (id === LEGACY_CUSTOM_ID ? 'Custom wallpaper' : 'Custom wallpaper')),
          createdAt: Number.isFinite(Number(metadata?.createdAt)) ? Number(metadata.createdAt) : 0,
          blob,
        };
      }).filter(Boolean);
      wallpapers.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
      resolve(wallpapers);
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

/** Downscale each upload before storing it; multiple independent images are supported. */
export async function saveWallpaper(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > 12 * 1024 * 1024) throw new Error('Please choose an image smaller than 12 MB.');
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = sourceUrl;
    await img.decode();
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This image could not be processed. Try another file.');
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob) blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type));
    if (!blob) throw new Error('This image could not be read. Try another file.');
    const id = globalThis.crypto?.randomUUID?.()
      || `wp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await writeRecord(id, { blob, name: safeName(file.name), createdAt: Date.now() });
    return id;
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export async function removeCustomWallpaper(id) {
  if (typeof id !== 'string' || !id) throw new Error('Invalid wallpaper selection.');
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
  if (customUrlId === id && customUrl) {
    URL.revokeObjectURL(customUrl);
    customUrl = null;
    customUrlId = null;
  }
}

/** Build the CSS background properties for the active custom image. */
export function wallpaperStyle(adjust = {}) {
  const a = clampAdjust(adjust);
  return {
    backgroundImage: customUrl ? `url(\"${customUrl}\")` : 'none',
    backgroundSize: `${Math.round(a.zoom * 100)}% auto`,
    backgroundPosition: `${a.x}% ${a.y}%`,
    filter: `blur(${a.blur / 8}px) brightness(${a.brightness / 100}) saturate(${a.saturation / 100})`,
  };
}
function applyPreset(root, preset, adjust) {
  const image = preset.image ? `url(\"${new URL(preset.image, location.href).href}\")` : (preset.css || 'none');
  root.style.setProperty('--wallpaper-image', image);
  root.style.setProperty('--wp-size', 'cover');
  root.style.setProperty('--wp-pos', 'center');
  root.style.setProperty('--wp-filter', `brightness(${adjust.brightness / 100}) saturate(${adjust.saturation / 100}) blur(${adjust.blur / 8}px)`);
}

/** Apply wallpaper + adjustments to the document. Cached object URLs avoid re-reading IndexedDB for every setting change. */
export async function applyWallpaper(settings) {
  const current = ++generation;
  const choice = settings.wallpaper || { type: 'builtin', id: 'twilight' };
  const adjust = clampAdjust(settings.wallpaperAdjust || {});
  const root = document.documentElement;
  if (choice.type === 'custom') {
    const id = typeof choice.id === 'string' && choice.id ? choice.id : LEGACY_CUSTOM_ID;
    if (customUrlId !== id || !customUrl) {
      try {
        const record = await getRecord(id);
        if (current !== generation) return;
        const blob = storedBlob(record);
        if (blob) {
          const nextUrl = URL.createObjectURL(blob);
          if (customUrl) URL.revokeObjectURL(customUrl);
          customUrl = nextUrl;
          customUrlId = id;
        } else if (customUrl) {
          URL.revokeObjectURL(customUrl);
          customUrl = null;
          customUrlId = null;
        }
      } catch { /* Missing/corrupt local images fall back to a bundled wallpaper. */ }
    }
    if (current !== generation) return;
    if (customUrl && customUrlId === id) {
      const style = wallpaperStyle(adjust);
      root.style.setProperty('--wallpaper-image', style.backgroundImage);
      root.style.setProperty('--wp-size', style.backgroundSize);
      root.style.setProperty('--wp-pos', style.backgroundPosition);
      root.style.setProperty('--wp-filter', style.filter);
    } else {
      applyPreset(root, WALLPAPERS[0], adjust);
    }
  } else {
    const preset = WALLPAPERS.find((wallpaper) => wallpaper.id === choice.id) || WALLPAPERS[0];
    applyPreset(root, preset, adjust);
  }
  root.style.setProperty('--wallpaper-dim', String(Math.max(0, Math.min(85, Number(settings.wallpaperDim ?? 40)) / 100)));
  root.dataset.wallpaper = settings.showWallpaper === false ? 'off' : 'on';
}

/** Re-apply just the adjustment variables after an editor tweak (no blob reload). */
export function retuneWallpaper(settings) {
  const choice = settings.wallpaper || { type: 'builtin', id: 'twilight' };
  const adjust = clampAdjust(settings.wallpaperAdjust || {});
  const root = document.documentElement;
  const id = typeof choice.id === 'string' && choice.id ? choice.id : LEGACY_CUSTOM_ID;
  if (choice.type === 'custom' && customUrl && customUrlId === id) {
    const style = wallpaperStyle(adjust);
    root.style.setProperty('--wp-size', style.backgroundSize);
    root.style.setProperty('--wp-pos', style.backgroundPosition);
    root.style.setProperty('--wp-filter', style.filter);
  } else {
    root.style.setProperty('--wp-filter', `brightness(${adjust.brightness / 100}) saturate(${adjust.saturation / 100}) blur(${adjust.blur / 8}px)`);
  }
}
