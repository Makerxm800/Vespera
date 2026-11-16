# Releasing Vespera

Cutting a release builds real desktop installers for **Windows**, **macOS** and
**Linux** and publishes them on the GitHub Releases page — fully automated.

## Steps

1. **Bump the version** in `package.json`, the top-level `package-lock.json` entries **and** `src-tauri/Cargo.toml` (e.g. `"version": "0.2.0"`). Update `CHANGELOG.md` and the in-app release notes.
2. **Commit & merge** the change to `main`.
3. **Tag and push:**

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Done. GitHub Actions (`.github/workflows/release.yml`) then:
   - runs the unit/service tests and Chromium UI checks,
   - builds the Tauri bundles on native runners:
     - `windows-latest` → `Vespera-Setup-<v>.exe` (NSIS) + `Vespera-<v>-x64.msi`
     - `macos-14` → `Vespera-<v>-mac-arm64.dmg` · `macos-13` → `Vespera-<v>-mac-x64.dmg`
     - `ubuntu-latest` → `Vespera-<v>-linux-x86_64.AppImage` + `Vespera-<v>-linux-amd64.deb`
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
signing and notarization. Neither warning is caused by how the app is
packaged, so removing files will not fix them. A new Windows signature can
still need time to build reputation, so signing helps but cannot guarantee
that SmartScreen stops warning immediately.

- **Windows**: use a trusted code-signing certificate and configure
  `bundle.windows.signing` in `src-tauri/tauri.conf.json`. Never put the
  certificate or its password in source control or chat.
- **macOS**: enroll in Apple Developer and configure `bundle.macOS.signing`
  in `src-tauri/tauri.conf.json` (identity + provisioning profile), plus
  notarization through Tauri's bundler options.

## Icons

App icons are generated deterministically (no design tools needed):

```bash
npm run icons   # → src-tauri/icons/icon.{png,ico,icns}, src-tauri/icons/{32,128,256,512}x*.png
```
