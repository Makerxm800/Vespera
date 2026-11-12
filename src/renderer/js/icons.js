/** Vespera icons — inline SVG set (stroke-based, 24px grid). */

const S = (paths, fill = 'none') =>
  `<svg viewBox="0 0 24 24" fill="${fill}" stroke="${fill === 'none' ? 'currentColor' : 'none'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  sparkle: S('<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>'),
  shield: S('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
  shieldOff: S('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M4 4l16 16"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.08a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55h.08a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.08a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'),
  users: S('<circle cx="9" cy="8" r="3.6"/><path d="M2 21c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8"/><path d="M16.5 4.6a3.6 3.6 0 010 6.8"/><path d="M18.5 14.7c2 .8 3.5 2.5 3.5 5"/>'),
  clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  bookmark: S('<path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>'),
  bookmarkFill: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`,
  download: S('<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  globe: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14.5 14.5 0 010 18 14.5 14.5 0 010-18z"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  arrowLeft: S('<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>'),
  arrowRight: S('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
  copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),
  image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>'),
  arrowUp: S('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>'),
  arrowDown: S('<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>'),
  check: S('<path d="M4 12.5l5 5L20 6.5"/>'),
  warning: S('<path d="M12 3l10 18H2z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".5" fill="currentColor"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r=".5" fill="currentColor"/>'),
  heart: S('<path d="M12 21s-8-4.9-8-11a4.6 4.6 0 018-3 4.6 4.6 0 018 3c0 6.1-8 11-8 11z"/>'),
  bolt: S('<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>'),
  eye: S('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: S('<path d="M4 4l16 16"/><path d="M9.9 5.2A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17.5 17.5 0 01-3.2 4.2"/><path d="M6.3 6.5A16.9 16.9 0 002 12s3.5 7 10 7a9.8 9.8 0 004.2-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'),
  volume: S('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M19 5a10 10 0 010 14"/>'),
  volumeOff: S('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/>'),
  trash: S('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>'),
  refresh: S('<path d="M21 12a9 9 0 11-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  external: S('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6"/>'),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 118 0v4"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: S('<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'),
  code: S('<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M13 5l-2 14"/>'),
  flask: S('<path d="M9 3h6"/><path d="M10 3v6L4.5 19a1.5 1.5 0 001.4 2h12.2a1.5 1.5 0 001.4-2L14 9V3"/><path d="M7.5 15h9"/>'),
  palette: S('<path d="M12 21a9 9 0 110-18c5 0 9 3.6 9 8 0 2.8-2.2 4-4 4h-1.6a1.9 1.9 0 00-1.3 3.3c.6.7.2 2.7-2.1 2.7z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor"/><circle cx="15" cy="8" r="1" fill="currentColor"/>'),
  history: S('<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3.5 2"/>'),
  star: S('<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>'),
  keyboard: S('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>'),
  logout: S('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  split: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  panel: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M5.5 8h1M5.5 12h1"/>'),
  link: S('<path d="M10 14a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 10a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1"/>'),
  send: S('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  move: S('<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'),
  puzzle: S('<path d="M9 3v3a2 2 0 01-2 2H4v4h3a2 2 0 012 2v3h4v-3a2 2 0 012-2h3V8h-3a2 2 0 01-2-2V3z"/><path d="M9 21h6v-3a2 2 0 012-2h3"/>'),
  pin: S('<path d="M16 3l5 5-4 1-3 5-3-3-5 3-1-1 3-5-3-3 5-3 1-4z"/><path d="M4 20l6-6"/>'),
};

export function icon(name, cls = '') {
  const svg = icons[name] || icons.sparkle;
  return cls ? svg.replace('<svg ', `<svg class="${cls}" `) : svg;
}
