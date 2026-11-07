# Vespera Browser 🚀

> **A next-gen, community-first browser engineered for absolute privacy and superior performance.**
> Real Chromium core · sleek Twilight UI · zero telemetry · accounts + sync · community-voted roadmap.

Most mainstream browsers are designed to serve advertisers, hoard your data, or lock you into corporate ecosystems. **Vespera** completely flips the script. Built from the ground up to be private by default, it strips away telemetry and tracking bloat while offering a lightning-fast, beautifully designed experience crafted entirely for the community.

---

## ✨ Why Vespera Beats the Competition

* **🔒 Privacy by Default:** Zero sneaky data harvesting or telemetry. Your browsing habits belong to you, and nobody else.
* **⚡ Blazing Fast & Lightweight:** Stripped of heavy corporate bloatware so your system resources go toward what *you* are doing, not background tracking.
* **🎨 Community-Driven Design:** Built around what real users actually want—clean aesthetics, intuitive navigation, and zero annoying clutter.
* **🌐 Open Source & Transparent:** No hidden code or backdoors. Inspect, verify, and contribute to how your browser operates.

### What makes Vespera *different* from Chrome & other browsers

| | Vespera | Chrome / mainstream |
|---|---|---|
| Telemetry | **Zero, permanently (switch is locked off)** | Constant usage & crash reporting |
| Trackers & ads | **Blocked out of the box** | Allowed (it's the business model) |
| Tracking links (utm/fbclid/gclid) | **Stripped automatically** | Kept and profiled |
| Vertical tabs + command palette | **Built in** | Extensions or nothing |
| Feature roadmap | **Voted by the community, in-app** | Decided in a boardroom |
| Sync accounts | **Your own store, scrypt-hashed passwords** | Corporate identity lock-in |
| Global Privacy Control + DNT | **Sent on every request** | Off by default |
| Per-site shields panel | **One click, live counters** | Buried settings |

---

## 🛠️ Quick Start

```bash
# 1. Install (pulls Electron + the Chromium core)
npm install

# 2. Run the desktop browser  (real Chromium webviews)
npm start

# …or run the web preview of the same UI (browser-in-browser demo)
npm run preview   # then open http://localhost:4600

# Run the test suite (25 tests incl. engine benchmarks)
npm test
```

**Requirements:** Node.js 20+ and npm. That's it.

---

## 🗺️ Roadmap — shipped in this build

- [x] **Core privacy engine optimization** — EasyList-subset filter engine with precompiled regexes and domain-bucketed matching (50k matches in milliseconds), tracking-parameter stripping, HTTPS upgrades, strict referrer policy, GPC/DNT headers.
- [x] **Sleek, modern UI theme overhaul** — the *Twilight* design system: dark/light themes, four accent colors, glass panels, animated starfield, drag-reorder tabs (horizontal **or** vertical layout), unified omnibox with smart suggestions, command palette (`Ctrl+K`), full keyboard control.
- [x] **Advanced built-in tracker and ad blocking** — bundled tracker/ad/annoyance blocklists enforced at the network layer in Chromium, live per-site shield counters, one-click site allowlist, Privacy Dashboard with real statistics.
- [x] **Community feature-request voting system** — in-app board: post ideas, upvote/downvote, comment, track statuses (open → planned → in-progress → shipped). The most-voted ideas define what gets built next.

### What's next (vote on these in `vespera://community`!)

- [ ] End-to-end encrypted sync (passphrase-derived keys)
- [ ] Split view (two pages, one tab)
- [ ] Reader mode with typography controls
- [ ] Tab groups with colors
- [ ] Browser extension compatibility layer

---

## 🏗️ Architecture (for the curious)

```
Vespera-beta/
├── electron/           Real Chromium shell
│   ├── main.js         Window, downloads, incognito, service boot
│   ├── privacy.js      Network blocking, GPC/DNT, link cleaning, cosmetic filters
│   └── preload.js      contextIsolation bridge
├── src/
│   ├── shared/         Privacy engine shared by all layers
│   │   ├── filter-engine.js    EasyList-subset matcher (optimized core)
│   │   ├── blocklists.js       Bundled tracker/ad/annoyance lists
│   │   └── privacy-utils.mjs   Link cleaning, search engines, omnibox logic
│   └── renderer/       The Vespera chrome UI (vanilla ESM, zero frameworks)
│       ├── styles/     Twilight design system (tokens, chrome, pages)
│       └── js/         Tabs, omnibox, shields, palette, state + all pages
├── server/             Bundled local service (zero dependencies)
│   ├── routes/         Accounts, sync, community voting API
│   └── lib/            Auth (scrypt+HMAC), atomic JSON store, preview proxy
└── test/               25 tests: engine semantics, auth, store, benchmarks
```

* **Accounts** — scrypt-hashed passwords, HMAC-signed stateless tokens, rate limiting. Nothing leaves your machine.
* **Sync** — per-user collections (settings, bookmarks, history) with last-write-wins merging; works against any Vespera service URL.
* **Zero runtime dependencies** in the service layer — the only dependency is Electron itself.

---

## 🤝 Get Involved

Vespera is shaped by its users. Whether you want to write code, submit bug reports, or pitch new features, your voice matters here — literally: launch the browser, open **`vespera://community`**, and vote.

Drop a star ⭐ to support the project, open an issue, and let’s build a better internet together!

---

*MIT licensed. Zero telemetry — that's not a setting, it's a pledge.* ✨
