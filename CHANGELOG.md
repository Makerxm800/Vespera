# Changelog

## Unreleased

- Fixed: video fullscreen on YouTube and other sites (the F key and the player's fullscreen button) was blocked by Vespera's permission handler. Fullscreen and page "Copy" buttons now work, and leaving video fullscreen no longer drops you out of F11 fullscreen.
- Fixed: camera, microphone, location and notification permissions are matched per site, ask once per site (no stacked prompts), and can be remembered ("Remember my choice for this site"). New Settings row to reset remembered choices.
- Fixed: right-clicking empty tab-strip space no longer errors; it now offers New tab, Reopen closed tab, and tab layout / bookmarks bar toggles.
- New tab right-click menu at the cursor: New tab to the right, Reload, Duplicate, Pin, Copy address, add to a new or existing group, Reopen closed tab, Close, Close other tabs, Close tabs to the right (pinned tabs are kept).
- Improved tab moving: a visible drop marker while dragging, pinned tabs always stay first, plain drags only reorder (hold Alt to group by dropping onto a tab), Shift+Arrow and Ctrl+Shift+PageUp/PageDown move a tab, mouse wheel scrolls a crowded tab strip, double-click empty space opens a new tab.
- Improved: closed tabs reopen in their old position and group; duplicating a tab keeps its group; closing tabs to the right keeps pinned tabs.
- Improved: keyboard focus moves to the page after you pick a tab or navigate, so page shortcuts work without an extra click. Ctrl+1–9, Ctrl+PageUp/PageDown, Ctrl+H, Ctrl+Shift+B and F6 / Alt+D also work while a page has focus.

## 0.1.3

- Smooth keyed tab animations for opening, closing, switching and reordering; softer rounded close controls.
- Rebuilt Privacy Hub with compact controls, live counters, per-site exceptions and accurate privacy copy.
- Compact personal account page with tested email/password registration, sign-in, profile updates, sync and session revocation.
- Added in-app release notes and Chromium UI checks to the multi-platform release workflow.
- Includes the live-preview browser repairs: usable chrome, Home clock, wallpapers/themes, right-click menus, animated search, downloads, built-in extensions and PWA shell.

Release: https://github.com/Makerxm800/Vespera-beta/releases/tag/v0.1.3

## 0.1.2

Published desktop release: https://github.com/Makerxm800/Vespera-beta/releases/tag/v0.1.2

## 0.1.1

Published desktop release: https://github.com/Makerxm800/Vespera-beta/releases/tag/v0.1.1

## 0.1.0

Published desktop release: https://github.com/Makerxm800/Vespera-beta/releases/tag/v0.1.0
