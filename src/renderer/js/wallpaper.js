/** Wallpapers stay on this device. Large uploads use IndexedDB, not account sync.
 *  Supports zoom, position, blur and brightness tuning for the custom image. */
export const WALLPAPERS = [
  { id: 'twilight', name: 'Twilight lake', image: 'assets/twilight.jpg', color: '#101b36' },
  { id: 'aurora', name: 'Northern lights', color: '#102c35', css: 'radial-gradient(ellipse at 20% 0%, #287c7955, transparent 65%), radial-gradient(ellipse at 85% 30%, #7662ba66, transparent 60%), linear-gradient(160deg, #102c35, #10172e)' },
  { id: 'dawn', name: 'First light', color: '#513b51', css: 'radial-gradient(ellipse at 70% 100%, #ecac8266, transparent 65%), linear-gradient(155deg, #513b51, #242a49 70%, #142333)' },
  { id: 'none', name: 'Quiet solid', color: '#101626', css: 'none' },
];

const ADJUST_DEFAULTS = { zoom: 1, x: 50, y: 50, blur: 0, brightness: 100, saturation: 100 };
let customUrl = null;
let generation = 0;
/** Whether a custom image is stored — lets Settings keep the "Custom" tile
 *  around so switching back to it is always possible. */
let customAvailable = false;

export const hasCustomWallpaper = () => customAvailable;
export async function probeCustomWallpaper() {
  try { customAvailable = Boolean(await imageBlob()); }
  catch { customAvailable = false; }
  return customAvailable;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vespera-wallpapers', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function imageBlob(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', value ? 'readwrite' : 'readonly');
    const store = tx.objectStore('images');
    const req = value ? store.put(value, 'custom') : store.get('custom');
    let blob;
    req.onsuccess = () => { blob = req.result; };
    tx.oncomplete = () => { db.close(); resolve(blob); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

/** Downscale to a sane size, then store the adjusted geometry with it. */
export async function saveWallpaper(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > 12 * 1024 * 1024) throw new Error('Please choose an image smaller than 12 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob) throw new Error('This image could not be read. Try another file.');
    await imageBlob(blob);
    customAvailable = true;
  } finally { URL.revokeObjectURL(url); }
}

export function clampAdjust(a = {}) {
  return {
    zoom: Math.max(1, Math.min(4, Number(a.zoom) || 1)),
    x: Math.max(0, Math.min(100, Number(a.x) ?? 50)),
    y: Math.max(0, Math.min(100, Number(a.y) ?? 50)),
    blur: Math.max(0, Math.min(40, Number(a.blur) || 0)),
    brightness: Math.max(25, Math.min(175, Number(a.brightness) ?? 100)),
    saturation: Math.max(0, Math.min(200, Number(a.saturation) ?? 100)),
  };
}

/** Build the CSS background properties for the custom wallpaper. */
export function wallpaperStyle(adjust = {}) {
  const a = clampAdjust(adjust);
  const position = `${a.x}% ${a.y}%`;
  return {
    backgroundImage: customUrl ? `url("${customUrl}")` : 'none',
    backgroundSize: `${Math.round(a.zoom * 100)}% auto`,
    backgroundPosition: position,
    filter: `blur(${a.blur / 8}px) brightness(${a.brightness / 100}) saturate(${a.saturation / 100})`,
  };
}

/** Apply wallpaper + adjustments to the document. */
export async function applyWallpaper(settings) {
  const current = ++generation;
  const choice = settings.wallpaper || { type: 'builtin', id: 'twilight' };
  const adjust = clampAdjust(settings.wallpaperAdjust || {});
  const root = document.documentElement;
  let image = 'none';
  if (choice.type === 'custom') {
    try {
      const blob = await imageBlob();
      if (current !== generation) return;
      if (blob) {
        const next = URL.createObjectURL(blob);
        if (customUrl) URL.revokeObjectURL(customUrl);
        customUrl = next;
        image = `url("${next}")`;
      }
    } catch { /* Fall back to the bundled wallpaper if storage is unavailable. */ }
    if (current !== generation) return;
    const st = wallpaperStyle({ ...adjust, zoom: adjust.zoom });
    root.style.setProperty('--wallpaper-image', st.backgroundImage);
    root.style.setProperty('--wp-size', st.backgroundSize);
    root.style.setProperty('--wp-pos', st.backgroundPosition);
    root.style.setProperty('--wp-filter', st.filter);
  } else {
    if (customUrl) { URL.revokeObjectURL(customUrl); customUrl = null; }
    const preset = WALLPAPERS.find((w) => w.id === choice.id) || WALLPAPERS[0];
    image = preset.image ? `url("${new URL(preset.image, location.href).href}")` : (preset.css || 'none');
    root.style.setProperty('--wallpaper-image', image);
    root.style.setProperty('--wp-size', 'cover');
    root.style.setProperty('--wp-pos', 'center');
    root.style.setProperty('--wp-filter', `brightness(${adjust.brightness / 100}) saturate(${adjust.saturation / 100}) blur(${adjust.blur / 8}px)`);
  }
  root.style.setProperty('--wallpaper-dim', String(Math.max(0, Math.min(85, Number(settings.wallpaperDim ?? 40)) / 100)));
  root.dataset.wallpaper = settings.showWallpaper === false ? 'off' : 'on';
}

/** Re-apply just the adjustment variables after an editor tweak (no blob reload). */
export function retuneWallpaper(settings) {
  const choice = settings.wallpaper || { type: 'builtin', id: 'twilight' };
  const adjust = clampAdjust(settings.wallpaperAdjust || {});
  const root = document.documentElement;
  if (choice.type === 'custom' && customUrl) {
    const st = wallpaperStyle(adjust);
    root.style.setProperty('--wp-size', st.backgroundSize);
    root.style.setProperty('--wp-pos', st.backgroundPosition);
    root.style.setProperty('--wp-filter', st.filter);
  } else {
    root.style.setProperty('--wp-filter', `brightness(${adjust.brightness / 100}) saturate(${adjust.saturation / 100}) blur(${adjust.blur / 8}px)`);
  }
}
