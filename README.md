# Vespera

**A community-shaped desktop browser with built-in privacy controls.** Vespera pairs a Rust/Tauri desktop shell with a lightweight browser interface, a local service layer, and the webview provided by your operating system.

- **Platforms:** Windows x64, macOS Intel and Apple silicon, and Linux x86_64
- **Privacy:** built-in tracker and ad filtering, tracking-link cleanup, HTTPS upgrades, and Global Privacy Control / Do Not Track headers
- **Interface:** horizontal or vertical tabs, tab groups, keyboard navigation, themes, accent colors, and custom wallpapers
- **Project:** open source under the MIT license; feature requests and community voting are built into the browser

> Release notes live in [CHANGELOG.md](CHANGELOG.md). Get published installers from the [GitHub Releases page](https://github.com/Makerxm800/Vespera/releases).

---

## Contents

- [What Vespera includes](#what-vespera-includes)
- [Download and install](#download-and-install)
- [Privacy and data](#privacy-and-data)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Build and run from source](#build-and-run-from-source)
- [How the project is organized](#how-the-project-is-organized)
- [Contribute](#contribute)
- [License](#license)

## What Vespera includes

### Privacy controls

- A bundled EasyList-subset filter engine blocks supported tracker, advertising, and annoyance rules.
- Tracking parameters such as common campaign IDs are removed from links before navigation.
- Requests use HTTPS upgrades where applicable and send Global Privacy Control (GPC) and Do Not Track (DNT) signals.
- The site-information and Privacy Hub interfaces expose per-site controls and protection activity.
- Vespera is designed without telemetry collection. Normal browsing still makes requests to the websites you choose to visit; privacy features do not make browsing anonymous or replace a VPN.

### Browser workspace

- Reorder tabs, use horizontal or vertical tab layouts, and organize related tabs into colored groups.
- Restore your session, reopen recently closed tabs, and manage bookmarks, history, and downloads.
- Use the command palette, keyboard shortcuts, and unified address/search bar to move around quickly.
- Customize light, dark, or system appearance, accent colors, density, and wallpaper.
- Open private windows for a separate in-memory browsing session.
- Inspect application logs from **View logs** or `vespera://logs` when troubleshooting.

### Accounts, sync, and community

- The Account page provides account/profile controls and sync for settings, bookmarks, and history through the Vespera service configured for that installation.
- The Community page provides a feature-request board with voting, comments, and status tracking.
- Account, sync, and community functions are optional. Data needed for a feature is sent to its configured service when you use that feature; read the policy for the service you connect to, especially for self-hosted deployments.

### Extension compatibility

Vespera includes an Extensions page and a catalog/management interface, but its Tauri system-webview does **not** provide Chromium's `chrome-extension://` runtime or extension APIs. Chrome extensions therefore cannot execute in the current desktop build. The app reports this limitation rather than claiming an extension was installed when it cannot run.

## Download and install

Choose the installer that matches your computer from the [Releases page](https://github.com/Makerxm800/Vespera/releases). Download only from the official Vespera repository.

| System | Release asset | Install |
|---|---|---|
| Windows 10/11, x64 | `.exe` setup wizard or `.msi` package | Run the installer and follow its prompts. |
| macOS, Apple silicon | ARM64 `.dmg` | Open the disk image and drag Vespera to Applications. |
| macOS, Intel | x64 `.dmg` | Open the disk image and drag Vespera to Applications. |
| Linux, x86_64 | `.AppImage` or Debian/Ubuntu `.deb` | Run the AppImage, or install the `.deb` with your package manager. |

### First launch and installer warnings

Current builds may be unsigned. Windows SmartScreen or macOS Gatekeeper can therefore warn that the publisher is not recognized. Verify that the installer came from the official Releases page before proceeding. Do **not** run a file if your operating system identifies a specific malware threat. Code signing and macOS notarization are separate release-engineering tasks; see [RELEASING.md](RELEASING.md).

On Linux, the desktop webview and graphics libraries must be available on the system. If the app does not open, check the distribution's WebKitGTK and GTK package requirements and consult the build workflow for the current dependency list.

## Privacy and data

Vespera's privacy design combines local browser controls with optional service features:

- Browser settings, bookmarks, history, and session state are kept in the local application profile unless you choose to sync them.
- Built-in filtering, link cleanup, and request privacy headers run as browser features; they do not prevent a visited website from seeing the request needed to load that site.
- Signing in and using sync sends the account and selected sync data to the Vespera service configured for the app. Community posts, votes, and comments are likewise service features.
- The project does not add product telemetry. This is not a promise that websites, operating systems, or a service you choose to use collect no information.

For a self-hosted service, review its deployment, access-control, backup, and retention settings before using real account data.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Reopen closed tab | `Ctrl+Shift+T` |
| Switch to tabs 1–9 | `Ctrl+1` … `Ctrl+9` |
| Find in page | `Ctrl+F` |
| Bookmark the current page | `Ctrl+D` |
| Open the command palette | `Ctrl+K` |
| Open Settings | `Ctrl+,` |
| Show or hide the bookmarks bar | `Ctrl+Shift+B` |
| Open History | `Ctrl+H` |
| Open a private window | `Ctrl+Shift+N` |

Shortcuts can vary by operating system and may be intercepted by the page or webview. The browser menu and command palette provide alternate ways to reach common actions.

## Build and run from source

### Requirements

- Node.js 22 (the release workflow uses Node.js 22) and npm
- Rust stable via [rustup](https://rustup.rs/)
- Native build tools required by Tauri for your operating system
- On Linux, the WebKitGTK, GTK, Ayatana app-indicator, and librsvg development packages listed in `.github/workflows/release.yml`

### Common commands

```bash
# Install the JavaScript dependencies
npm ci

# Run the desktop app in development (requires the Rust toolchain)
npm start

# Run the unit and service tests
npm test

# Run the browser UI checks (install Playwright Chromium first)
npx playwright install chromium
npm run test:ui

# Serve the browser interface and local service in a web browser
npm run preview
# Open http://localhost:4600

# Build installers for the current operating system
npm run dist
```

Platform-specific bundle scripts are also available as `npm run dist:win`, `npm run dist:mac`, and `npm run dist:linux`. A native build generally needs to run on its target OS; the release workflow uses separate hosted runners for Windows, macOS Intel, macOS ARM64, and Ubuntu.

### Troubleshooting

- **The desktop app fails during startup:** open **View logs** from the browser menu, or navigate to `vespera://logs`. The log viewer includes the recorded application events and errors.
- **The app cannot open:** verify the required system webview and native libraries are installed. On Linux, install the development/runtime packages for WebKitGTK and GTK appropriate to your distribution.
- **The page is blank in web preview:** some websites block embedding or cannot be reached through the preview proxy. Use the page's **Open original** action when available.
- **An installer warning appears:** see [First launch and installer warnings](#first-launch-and-installer-warnings); only use releases downloaded from the official repository.

## How the project is organized

```text
src/
  renderer/       Browser chrome, pages, styles, and UI state
  shared/         Tab, privacy, filtering, and other shared browser logic
src-tauri/
  src/            Rust desktop shell, webview proxy, filters, settings, logs,
                  downloads, update checks, and extension capability reporting
  assets/         Bundled filter data and extension catalog data
server/
  server.js       Local service used by the web preview and desktop app
  routes/         Account, sync, and community APIs
  lib/            Authentication, storage, request routing, and proxy helpers
scripts/          Icon generation and development checks
test/             JavaScript unit and service tests
.github/workflows/ Multi-platform validation and release builds
```

The UI is written as native browser modules rather than using a large frontend framework. Tauri provides the desktop window and operating-system webview; Rust hosts the desktop capabilities and local service integration.

## Contribute

Bug reports, documentation improvements, and focused pull requests are welcome. For feature ideas, use the in-app community board at `vespera://community` when it is available. Before opening a pull request:

1. Describe the user problem and the behavior your change addresses.
2. Keep changes focused and avoid including generated installer/build output.
3. Run `npm test`; for UI changes, also run `npm run test:ui` after installing Playwright Chromium.
4. Update [CHANGELOG.md](CHANGELOG.md) when a change is intended for a release.

See [ROADMAP.md](ROADMAP.md) for the project's current direction and [RELEASING.md](RELEASING.md) for maintainer release steps.

## License

Vespera is released under the [MIT License](LICENSE).
