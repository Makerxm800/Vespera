/** Clamp wallpaper settings to safe, finite values before applying them to styles. */
export function clampAdjust(value = {}) {
  const settings = value && typeof value === 'object' ? value : {};
  const finite = (entry, fallback) => {
    const number = typeof entry === 'number'
      ? entry
      : (typeof entry === 'string' && entry.trim() ? Number(entry) : Number.NaN);
    return Number.isFinite(number) ? number : fallback;
  };
  return {
    zoom: Math.max(1, Math.min(4, finite(settings.zoom, 1))),
    x: Math.max(0, Math.min(100, finite(settings.x, 50))),
    y: Math.max(0, Math.min(100, finite(settings.y, 50))),
    blur: Math.max(0, Math.min(40, finite(settings.blur, 0))),
    brightness: Math.max(25, Math.min(175, finite(settings.brightness, 100))),
    saturation: Math.max(0, Math.min(200, finite(settings.saturation, 100))),
  };
}
