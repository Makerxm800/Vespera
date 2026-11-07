# Releasing Vespera

Cutting a release builds real desktop installers for **Windows**, **macOS** and
**Linux** and publishes them on the GitHub Releases page — fully automated.

## Steps

1. **Bump the version** in `package.json` (e.g. `"version": "0.2.0"`).
2. **Commit & merge** the change to `main`.
3. **Tag and push:**

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Done. GitHub Actions (`.github/workflows/release.yml`) then:
   - runs the test suite,
   - builds on native runners:
     - `windows-latest` → `Vespera-Setup-<v>.exe` + `Vespera-Portable-<v>.exe`
     - `macos-latest` → `Vespera-<v>-mac-arm64.dmg` + `Vespera-<v>-mac-x64.dmg`
     - `ubuntu-latest` → `Vespera-<v>-linux-x64.AppImage` + `Vespera-<v>-linux-x64.deb`
   - publishes **Release v<x.y.z>** with all installers attached.

Watch progress at **Actions → Build & Release** on the repo.

## Testing a build without publishing

Run **Actions → Build & Release → Run workflow** manually — it builds all
installers and uploads them as run artifacts (no release is created).

## Code signing (optional, later)

The builds are currently **unsigned**, so first launches show a one-time
warning (Windows SmartScreen → "More info → Run anyway"; macOS Gatekeeper →
right-click → Open). To remove those warnings:

- **Windows**: buy a code-signing certificate and set `WIN_CSC_LINK` /
  `WIN_CSC_KEY_PASSWORD` repo secrets.
- **macOS**: enroll in Apple Developer and set `CSC_LINK` / `CSC_KEY_PASSWORD`
  (plus notarization via `notarize` config in `electron-builder.yml`).

## Icons

App icons are generated deterministically (no design tools needed):

```bash
npm run icons   # → build/icon.{png,ico,icns}, build/icons/*.png
```
