# Vespera Roadmap

The community decides what's next — vote at **`vespera://community`** inside the browser.
Statuses: `open` → `planned` → `in-progress` → `shipped`.

## ✅ Shipped — v0.1.0 "First Light"

### 1. Core privacy engine optimization
- [x] EasyList-subset filter engine: `||domain^`, wildcards, `^` separators, anchors,
      `@@` exceptions, `$important`, `$badfilter`, `$domain`, `$third-party`, type options
- [x] Compiled-once regexes + per-hostname bucketing (50k matches ≪ 1s, benchmarked in tests)
- [x] Tracking-parameter stripping (`utm_*`, `fbclid`, `gclid`, `msclkid`, …)
- [x] HTTPS-only upgrades, strict referrer policy, `Sec-GPC` + `DNT` on every request
- [x] Zero telemetry — permanently locked-off switch in Settings

### 2. Sleek, modern UI theme overhaul
- [x] "Twilight" design system: dark + light themes, 4 accents, 2 densities
- [x] Custom frameless window with drag regions and window controls
- [x] Tab strip: drag-reorder, favicons, loading spinners, close-on-middle-click
- [x] **Vertical tab layout** option (sidebar with drag-reorder)
- [x] Unified omnibox: URL/search detection, live suggestions (history + bookmarks + internal)
- [x] Command palette (`Ctrl+K`), full keyboard shortcuts, toast system
- [x] Internal pages: Welcome (starfield hero), New Tab, Settings, Privacy Dashboard,
      Community, Account, History, Bookmarks, Downloads

### 3. Advanced built-in tracker and ad blocking
- [x] Bundled blocklists: 120+ tracker/telemetry domains, ad-network patterns, annoyances
- [x] Network-layer enforcement in Chromium via `webRequest` (cancels before load)
- [x] Per-site shields popover with live counters + one-click allowlist
- [x] Cosmetic filtering (hide selectors incl. cookie banners / newsletter popups)
- [x] Privacy Dashboard: per-site stats, session totals, quick controls

### 4. Community feature-request voting system
- [x] In-app board with Top / New / By-status sorting
- [x] Post ideas with categories (Idea, Privacy, Performance, Design, Sync, Dev)
- [x] One vote per account (up/down, toggle to remove), live scores
- [x] Threaded comments per idea
- [x] Status tracking (moderators): open → planned → in-progress → shipped

### Platform
- [x] Real Chromium desktop app (Electron 33) with `<webview>` page isolation
- [x] Accounts: register / login / profile / sign-out-everywhere (scrypt + HMAC tokens)
- [x] Sync: settings, bookmarks, history — per-user, last-write-wins
- [x] Session restore (tabs come back after relaunch)
- [x] Downloads panel with real download tracking (desktop)
- [x] Incognito window (in-memory partition, full shields)
- [x] Web preview mode of the same UI (`npm run preview`)

## 🔜 Next up — vote to prioritize!

- [ ] **End-to-end encrypted sync** — passphrase-derived keys, server can't read your data
- [ ] **Split view** — two pages side by side in one tab
- [ ] **Reader mode** — distraction-free reading with typography controls
- [ ] **Tab groups** — color-coded groups in both layouts
- [ ] **Extension compatibility** — run popular MV3 extensions
- [ ] **Profiles** — separate work/personal spaces with independent data
- [ ] **Container tabs** — site isolation with per-container cookie jars
- [ ] **Bundled translation** — on-device page translation, no cloud

## 🌍 Community process

1. Anyone signed in can post an idea at `vespera://community`.
2. The community votes. One account, one vote (changeable anytime).
3. Top-voted ideas move to **planned**, then **in-progress**.
4. When shipped, the changelog in the next release credits the requester.

*Want something not on this list? Post it in the community board — that's literally how this roadmap works.*
