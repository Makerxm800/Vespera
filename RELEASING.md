# Releasing Vespera

Cutting a release builds real desktop installers for **Windows**, **macOS** and
**Linux** and publishes them on the GitHub Releases page — fully automated.

## Steps

1. **Bump the version** in `package.json` and the top-level `package-lock.json` entries (e.g. `"version": "0.2.0"`). Update `CHANGELOG.md` and the in-app release notes.
2. **Commit & merge** the change to `main`.
3. **Tag and push:**

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Done. GitHub Actions (`.github/workflows/release.yml`) then:
   - runs the unit/service tests and Chromium UI checks,
   - builds on native runners:
     - `windows-latest` → `Vespera-Setup-<v>.exe` + `Vespera-Portable-<v>.exe`
     - `macos-latest` → `Vespera-<v>-mac-arm64.dmg` + `Vespera-<v>-mac-x64.dmg`
     - `ubuntu-latest` → `Vespera-<v>-linux-x64.AppImage` + `Vespera-<v>-linux-x64.deb`
   - publishes **Release v<x.y.z>** with all installers attached.

Watch progress at **Actions → Build & Release** on the repo.

## Testing or retrying a build manually

Run **Actions → Build & publish Vespera → Run workflow** manually from `main`.
Leave `release_tag` blank to build installers and upload them as run artifacts
without publishing a release. To rebuild and publish an existing `v*` tag,
enter it in `release_tag` (for example, `v0.2.0`); the workflow checks out that
tag's source and attaches the installers to its GitHub Release.

## Code signing (optional)

The builds are currently **unsigned**. Windows SmartScreen checks the
Authenticode signature and publisher reputation; macOS Gatekeeper checks
signing and notarization. Neither warning is caused by Electron's `app.asar`,
so removing the archive will not fix them. A new Windows signature can still
need time to build reputation, so signing helps but cannot guarantee that
SmartScreen stops warning immediately.

- **Windows**: use a trusted code-signing certificate and add the
  `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` repository secrets. The release
  workflow passes those secrets to electron-builder when present. Never put
  the certificate or its password in source control or chat.
- **macOS**: enroll in Apple Developer and set `CSC_LINK` / `CSC_KEY_PASSWORD`
  (plus notarization via `notarize` config in `electron-builder.yml`).

## Icons

App icons are generated deterministically (no design tools needed):

```bash
npm run icons   # → build/icon.{png,ico,icns}, build/icons/*.png
```
