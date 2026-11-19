# Releasing Vespera

Cutting a release builds real desktop installers for **Windows**, **macOS** and
**Linux** and publishes them on the GitHub Releases page — fully automated.

## Steps

1. **Bump the version** in `package.json`, the top-level `package-lock.json` entries and `src-tauri/Cargo.toml`. Update `CHANGELOG.md` with the new release notes.
2. **Commit & merge** the change to `main`.
3. **Tag and push** the matching `vX.Y.Z` tag; for example:

   ```bash
   git tag v0.2.2
   git push origin v0.2.2
   ```

4. Done. GitHub Actions (`.github/workflows/release.yml`) then:
   - runs the unit/service tests and Chromium UI checks,
   - builds the Tauri bundles on native runners:
     - `windows-latest` → `Vespera_<v>_x64-setup.exe` (NSIS) + `Vespera_<v>_x64_en-US.msi`
     - `macos-15` → `Vespera_<v>_aarch64.dmg` · `macos-15-intel` → `Vespera_<v>_x64.dmg`
     - `ubuntu-latest` → `Vespera_<v>_amd64.AppImage` + `Vespera_<v>_amd64.deb`
   - publishes **Release v<x.y.z>** with all installers attached.

Watch progress at **Actions → Build & Release** on the repo.

## Testing or retrying a build manually

Run **Actions → Build & publish Vespera → Run workflow** manually from `main`.
Leave `release_tag` blank to build installers and upload them as run artifacts
without publishing a release. To rebuild and publish an existing `v*` tag,
enter it in `release_tag` (for example, `v0.2.2`); the workflow checks out that
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

### Getting rid of the Windows "Windows protected your PC" screen

That blue SmartScreen window appears because the installer has no trusted
signature, not because anything is wrong with the files. It cannot be removed
by changing code. The options, from easiest to hardest:

1. **Sign with SignPath Foundation** (free for open-source projects): apply at
   signpath.org/foundation, then add their signing step to `release.yml`.
2. **Sign with Azure Artifact Signing** (formerly Trusted Signing, a paid
   monthly service) or a standard/EV code-signing certificate, and set
   `bundle.windows` signing in `src-tauri/tauri.conf.json`.
3. **Publish through winget or the Microsoft Store**, which have their own
   trust paths.

Until the app is signed, people can click **More info**, then **Run anyway**.
Updates started from inside Vespera download the installer themselves, so
they are not marked as "downloaded from the internet" the way a browser
download is.

## Icons

App icons are generated deterministically (no design tools needed):

```bash
npm run icons   # → src-tauri/icons/icon.{png,ico,icns}, src-tauri/icons/{32,128,256,512}x*.png
```
