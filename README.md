# Vespera Browser 🚀

> **A community-first Chromium browser built for privacy, speed and a calm interface.**
> Real Chromium core · Twilight UI · zero telemetry · local-first accounts + sync · community-voted roadmap.

Im very sorry, i don't like using AI on my serious projects — i built Vespera by hand to see where the whole vibe-code experiment is actually going. It turned into a browser i use every day, so here it is. :P

**Current release: [v0.1.7](https://github.com/Makerxm800/Vespera/releases)** — Windows, macOS and Linux installers are published automatically from every `v*` tag.

---

## ✨ What's new in 0.1.7

* **Tabs & groups settings** — choose layout, tab placement, scroll-or-compress behavior, close buttons, middle-click actions, group visibility, audio controls, hover details and inactive-tab styling.
* **Tabs where you expect them** — new tabs can open beside the current tab or at the end of the strip; existing groups stay intact when their headers are hidden.
* **Richer tab controls** — mute tabs, pick hover cards or tooltips, and see previews or memory estimates where the desktop runtime supports them.
* **Sessions that remember more** — tab order, active tab, group collapse state, pinning and mute state are restored together.

Full details in [CHANGELOG.md](CHANGELOG.md) and in-app at **`vespera://updates`**.

---

## ✨ Why Vespera

* **🔒 Privacy by default** — no telemetry, no data harvesting, no usage profiles. Your browsing belongs to you.
* **⚡ Fast and light** — no background tracking pipelines; your CPU goes to the page you are reading.
* **🎨 Built the way you want** — dark/light/system themes, four accent colors (or your own), wallpapers with zoom/position/blur tuning, horizontal or vertical tabs, collapsible sidebar.
* **🌐 Open source** — inspect it, verify it, contribute to it.

### How it compares

| | Vespera | Chrome / mainstream |
|---|---|---|
| Telemetry | **Zero, permanently (no switch to turn on)** | Constant usage & crash reporting |
| Trackers & ads | **Blocked out of the box** | Allowed (it's the business model) |
| Tracking links (`utm_*`, `fbclid`, `gclid`) | **Stripped automatically** | Kept and profiled |
| Vertical tabs, tab groups, command palette | **Built in** | Extensions or nothing |
| Feature roadmap | **Voted in-app by the community** | Decided in a boardroom |
| Sync accounts | **Your own server, scrypt-hashed passwords** | Corporate identity lock-in |
| Global Privacy Control + DNT | **Sent on every request** | Off by default |
| Per-site Shields | **One click, live counters** | Buried settings |

---

## 📥 Download & install — no commands needed

Grab the installer for your machine from the
**[Releases page](https://github.com/Makerxm800/Vespera/releases)** and
double-click it — exactly like any other browser:

| Platform | File to download | How to install |
|---|---|---|
| 🪟 Windows 10/11 | `Vespera-Setup-<v>.exe` | Double-click → install → open from Start Menu |
| 🪟 Windows (portable) | `Vespera-Portable-<v>.exe` | Double-click and browse — no install |
| 🍎 macOS (Apple Silicon) | `Vespera-<v>-mac-arm64.dmg` | Open → drag Vespera to Applications |
| 🍎 macOS (Intel) | `Vespera-<v>-mac-x64.dmg` | Open → drag Vespera to Applications |
| 🐧 Linux | `Vespera-<v>-linux-x86_64.AppImage` | Double-click (allow "execute" on first run) |
| 🐧 Debian/Ubuntu | `Vespera-<v>-linux-amd64.deb` | Double-click the package |

<details>
<summary><b>First-run notes</b> (one-time, unsigned builds)</summary>

- **Windows SmartScreen** may show "Windows protected your PC" → click
  **More info → Run anyway**. This appears for every app without a paid
  code-signing certificate.
- **macOS Gatekeeper** may say the app is from an unidentified developer →
  **right-click the app → Open → Open**. (Signing + notarization is planned —
  see [RELEASING.md](RELEASING.md).)
</details>

The Windows installer is a **classic step-by-step wizard**: Welcome →
choose folder → Install → **Finish with a "Run Vespera" checkbox** — tick it
and the browser launches right away.

### Everyday shortcuts

| Action | Shortcut |
|---|---|
| Settings panel | `Ctrl+,` |
| Command palette | `Ctrl+K` |
| New tab / close tab / reopen closed | `Ctrl+T` / `Ctrl+W` / `Ctrl+Shift+T` |
| Switch to tab 1–9 | `Ctrl+1` … `Ctrl+9` |
| Move the current tab | `Ctrl+Shift+PageUp` / `PageDown`, or `Shift+←/→` |
| Find in page | `Ctrl+F` |
| Bookmarks bar / History | `Ctrl+Shift+B` / `Ctrl+H` |
| Hide the sidebar | browser menu → **Hide sidebar** |
| Toggle the Shields panel | click the shield in the toolbar |

### 🩺 If something goes wrong — read the logs

Vespera keeps a full log of everything it does (startup steps, service
status, errors with stack traces):

- **Inside the app:** menu (⋮) → **View logs**, or type `vespera://logs`
  in the address bar.
- **On disk:** `%APPDATA%\vespera-browser\logs\vespera.log` on Windows,
  `~/Library/Application Support/vespera-browser/logs/vespera.log` on macOS,
  `~/.config/vespera-browser/logs/vespera.log` on Linux.
- If the app can't start at all, it shows a dialog that includes the exact
  log path — attach that file when reporting a problem.

### 🗑️ Uninstalling — leaves nothing behind

- **Windows:** Settings → Apps → Installed apps → **Vespera → Uninstall**
  (or Start Menu → Vespera → Uninstall). The uninstaller removes the program,
  its Start Menu/Desktop shortcuts, **all registry entries**, and — since
  v0.1.1 — all local Vespera data too (accounts, history, settings).
- **macOS:** drag Vespera from Applications to the Trash.
- **Linux:** delete the `.AppImage` file, or `sudo apt remove vespera` for the `.deb`.

---

## 🛠️ Build from source (for developers)

```bash
# 1. Install (pulls Electron + the Chromium core)
npm install

# 2. Run the desktop browser  (real Chromium webviews)
npm start

# …or run the web preview of the same UI (browser-in-browser demo)
npm run preview   # then open http://localhost:4600

# Run the unit/service test suite
npm test

# Run real Chromium UI checks (after npx playwright install chromium)
npm run test:ui

# Build installers for your current platform (output in dist/)
npm run dist
```

**Requirements:** Node.js 20+ and npm. That's it.
**Current release: 0.1.7** — desktop installers are published by CI whenever a `v*` tag is pushed (see [RELEASING.md](RELEASING.md)).

### Live web preview / installable app

`npm run preview` serves the same browser UI at `http://localhost:4600`. In a hosted preview, Vespera runs directly in the browser: tabs, Home, right-click menus, the Settings panel, downloads, extensions and customization work without installing the desktop shell. The web app includes a manifest and app-shell cache, so supported browsers can offer **Install Vespera as an app** from the Vespera menu. Open **What's new** (`vespera://updates`) for build notes and the published Releases link.

The preview proxy is intentionally limited: some sites block embedding or are unreachable from the host environment. Use **Open original** for those sites. The Electron desktop app remains the full Chromium runtime.

---

## 🗺️ Roadmap — shipped in this build

- [x] **Core privacy engine** — EasyList-subset filter engine with precompiled regexes and domain-bucketed matching (50k matches in milliseconds), tracking-parameter stripping, HTTPS upgrades, strict referrer policy, GPC/DNT headers.
- [x] **Twilight design system** — dark/light themes, four accent colors, glass panels, animated starfield, horizontal **or** vertical tabs, collapsible sidebar, unified omnibox with smart suggestions, command palette (`Ctrl+K`), full keyboard control.
- [x] **Built-in tracker and ad blocking** — bundled tracker/ad/annoyance blocklists enforced at the network layer, live per-site shield counters, one-click site allowlist, Privacy Hub with real statistics.
- [x] **Community feature voting** — in-app board: post ideas, upvote/downvote, comment, track statuses (open → planned → in-progress → shipped).
- [x] **Tab groups with colors** — drag-to-group, group rename, tinted tabs, context-menu join/leave.
- [x] **Extension compatibility layer** — install from a Chrome Web Store link, a `.zip`/`.crx` package or an unpacked folder, with permissions reviewed before anything loads.

### What's next (vote on these in `vespera://community`!)

- [ ] End-to-end encrypted sync (passphrase-derived keys)
- [ ] Split view (two pages, one tab)
- [ ] Reader mode with typography controls
- [ ] Per-group tab suspension to save memory

---

## 🏗️ Architecture (for the curious)

```
Vespera/
├── electron/           Real Chromium shell
│   ├── main.js         Window, downloads, incognito, service boot
│   ├── client-hints.js Client hint headers so sites see a real Chrome
│   ├── webview-preload.js  Identity patch for embedded pages (Google sign-in)
│   ├── privacy.js      Network blocking, GPC/DNT, link cleaning, cosmetic filters
│   └── preload.js      contextIsolation bridge
├── src/
│   ├── shared/         Privacy + tab logic shared by every layer
│   │   ├── filter-engine.js    EasyList-subset matcher (optimized core)
│   │   ├── blocklists.js       Bundled tracker/ad/annoyance lists
│   │   ├── tab-order.mjs       Pure drag-and-drop ordering (unit tested)
│   │   └── privacy-utils.mjs   Link cleaning, search engines, omnibox logic
│   └── renderer/       The Vespera chrome UI (vanilla ESM, zero frameworks)
│       ├── styles/     Twilight design system (tokens, chrome, pages)
│       └── js/         Tabs, omnibox, shields, palette, state, Settings panel + all pages
├── server/             Bundled local service (zero dependencies)
│   ├── routes/         Accounts, sync, community voting API
│   └── lib/            Auth (scrypt+HMAC), atomic JSON store, preview proxy
├── scripts/            Icon generator, UI checks, friendly postinstall
├── electron-builder.yml            Installer config (win/mac/linux)
├── .github/workflows/release.yml   Automated multi-OS build & release
└── test/               Unit/service tests: engine semantics, auth, store, tab ordering
```

* **Accounts** — scrypt-hashed passwords, HMAC-signed stateless tokens, rate limiting. Nothing leaves your machine.
* **Sync** — per-user collections (settings, bookmarks, history) with last-write-wins merging; works against any Vespera service URL.
* **Zero runtime dependencies** in the service layer — the only dependency is Electron itself.

---

## 🤝 Get Involved

Vespera is shaped by its users. Whether you want to write code, submit bug reports, or pitch new features, your voice matters here — literally: launch the browser, open **`vespera://community`**, and vote.

Drop a star ⭐ to support the project, open an issue, and let's build a better internet together!

---

*MIT licensed. Zero telemetry — that's not a setting, it's a pledge.* ✨
