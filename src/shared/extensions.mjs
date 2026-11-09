/** Small, auditable extensions shipped with Vespera. No third-party code is installed silently. */
export const BUILTIN_EXTENSIONS = [
  { id: 'shields', name: 'Vespera Shields', version: '1.0', icon: 'shield', category: 'Privacy',
    description: 'Network-level tracker and ad blocking, cleaner links, and per-site controls.',
    detail: 'Included in Vespera. Uses the bundled filter lists; no remote filter-list downloads or analytics.', setting: 'shields.enabled' },
  { id: 'darkPages', name: 'Dark Pages', version: '1.0', icon: 'moon', category: 'Appearance',
    description: 'Give bright websites a dark reading surface. Images keep their original colors.',
    detail: 'A local stylesheet applied to websites. Some complex sites may need this switched off. Your browser theme is controlled separately.', setting: 'extensions.darkPages' },
  { id: 'reader', name: 'Reader View', version: '1.0', icon: 'eye', category: 'Reading',
    description: 'Extract an article into a quiet, readable page, with adjustable text size.',
    detail: 'Articles are extracted only when you choose Reader View. Preview extraction is limited to reachable sites; the desktop app can read pages loaded in Chromium.', action: 'reader' },
  { id: 'focusMode', name: 'Focus Mode', version: '1.0', icon: 'split', category: 'Productivity',
    description: 'Hide the side rail and bookmarks bar for a little more room to think.',
    detail: 'Changes only the Vespera interface. All your tabs stay open, and you can leave Focus Mode from the menu at any time.', setting: 'extensions.focusMode' },
];
export const CHROME_WEB_STORE = 'https://chromewebstore.google.com/';
