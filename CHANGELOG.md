# Changelog

## 0.1.6

### Settings is a panel now
- Settings opens as a floating drawer over whatever you are doing instead of navigating away to a page. `Ctrl+,` toggles it, `Escape` closes it, and the section pills (Appearance, Search & home, Privacy, Extensions, Downloads, Account, About) jump between sections as you scroll.
- Every switch, segmented control and accent dot gives feedback when you change it: the row pulses, the dot pops, the segment settles.

### Wallpapers fixed
- Fixed: clicking a wallpaper tile could throw `Cannot read properties of undefined (reading 'name')` and write a corrupt `{type:'builtin', id:'custom'}` value that silently fell back to the Twilight image.
- The **Custom** tile now stays in the grid once you have uploaded an image, so switching back to your own picture is one click and never requires re-uploading.
- "Edit wallpaper" is enabled whenever a custom image exists, not only while it is selected.

### Tabs and groups
- Drag a tab onto the **middle** of another tab to group it (Chrome behaviour); the leading and trailing thirds of a tab reorder instead. Holding `Alt` makes the whole row a group target.
- The drop target is highlighted while dragging, and grouped tabs are tinted with their group colour.
- Pinned tabs are 62px wide and show a **⋮** that opens the full tab menu (pin, unpin, group, rename, close) — a pinned tab has no room for a title or close button.
- Fixed: a plain drag only reorders; grouping no longer needs `Alt` to be detected.

### Layout
- New: hide the icon rail so the home screen and pages get the full width, with a tab on the left edge to bring it back. The browser menu has a matching "Hide sidebar" toggle.
- Home screen tightened up: less empty space, a staggered entrance for the shortcut cards, full-width layout once the sidebar is hidden.
- Extensions page reorganised into **General**, **Built-in**, **Installed** and **Catalog**, with buttons that open the Chrome Web Store, GitHub and each extension's download page in a new tab.

### Fixes
- Google sign-in works again: client hints are rewritten for every request and the webview identity is patched (`--user-agent-metadata` does not work in this Electron build).
- Video fullscreen on YouTube and other sites (the `F` key and the player's fullscreen button) was blocked by the permission handler. Fullscreen and page "Copy" buttons work now, and leaving video fullscreen no longer drops you out of F11 fullscreen.
- Camera, microphone, location and notification permissions are matched per site, ask once per site, and can be remembered ("Remember my choice for this site"), with a Settings row to reset them.
- Right-clicking empty tab-strip space no longer errors; it offers New tab, Reopen closed tab, and the tab layout / bookmarks bar toggles.
- Tab right-click menu at the cursor: New tab to the right, Reload, Duplicate, Pin, Copy address, add to a new or existing group, Reopen closed tab, Close, Close other tabs, Close tabs to the right (pinned tabs are kept).
- Closed tabs reopen in their old position and group; duplicating a tab keeps its group; closing tabs to the right keeps pinned tabs.
- Keyboard focus moves to the page after you pick a tab or navigate. `Ctrl+1–9`, `Ctrl+PageUp/PageDown`, `Ctrl+H`, `Ctrl+Shift+B` and `F6` / `Alt+D` work while a page has focus.

Release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.6

## 0.1.5

- Browser UX and interaction fixes across the tab strip, toolbar and page chrome.

Release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.5

## 0.1.4

- Extension manager and toolbar improvements: installed-extension menu, safer unpacked loading, clearer store compatibility notes.

Release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.4

## 0.1.3

- Smooth keyed tab animations for opening, closing, switching and reordering; softer rounded close controls.
- Rebuilt Privacy Hub with compact controls, live counters, per-site exceptions and accurate privacy copy.
- Compact personal account page with tested email/password registration, sign-in, profile updates, sync and session revocation.
- Added in-app release notes and Chromium UI checks to the multi-platform release workflow.
- Includes the live-preview browser repairs: usable chrome, Home clock, wallpapers/themes, right-click menus, animated search, downloads, built-in extensions and PWA shell.

Release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.3

## 0.1.2

Published desktop release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.2

## 0.1.1

Published desktop release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.1

## 0.1.0

Published desktop release: https://github.com/Makerxm800/Vespera/releases/tag/v0.1.0
