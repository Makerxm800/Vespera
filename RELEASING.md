# Releasing Vespera

The release workflow builds native installers for Windows, macOS, and Linux and publishes them on the GitHub Releases page.

## Prepare a release

1. Set the same version in `package.json`, the root entries in `package-lock.json`, and `src-tauri/Cargo.toml`.
2. Add user-visible changes to `CHANGELOG.md`; update the root README, `docs/index.html` release pill, and in-app release notes when relevant.
3. Run `npm ci`, `npm test`, and `git diff --check`.
4. Commit and push the release source to the branch you intend to publish.

The project tests and release builds use Node 22. Linux native builds target Ubuntu 24.04; their apt package archives are cached for repeat runs.

## Release from the default branch with a tag

For a normal release, merge the prepared commit to the default branch, create the matching version tag, and push the tag:

```bash
git tag v0.2.4
git push origin v0.2.4
```

The `v*` tag starts `.github/workflows/release.yml`. It runs the unit/service tests, builds on native platform runners, and publishes the installers. The current matrix produces:

- **Windows x64:** `Vespera_<version>_x64-setup.exe` and `Vespera_<version>_x64_en-US.msi`
- **macOS:** `Vespera_<version>_aarch64.dmg` and `Vespera_<version>_x64.dmg`
- **Ubuntu x86_64:** `Vespera_<version>_amd64.AppImage` and `Vespera_<version>_amd64.deb`

## Publish from a working branch without rebuilding

The workflow also supports an explicit manual publish. This is useful when a release must be made from a working branch rather than the default branch:

1. In **Actions → Build and publish Vespera**, select the source branch and run it with both inputs blank. This builds and uploads the platform installers without publishing a release.
2. After that run succeeds, run the workflow again from the **same branch**. Set `release_tag` to the package version (for example, `v0.2.4`) and `artifact_run_id` to the successful build-only run ID.
3. The workflow verifies the branch, commit ancestry, all four successful platform jobs, and all four unexpired artifact archives, then publishes those installers for the tested source commit.

A `release_tag` must match the version in `package.json`. To rebuild an existing tag instead, dispatch the workflow with `release_tag` set and leave `artifact_run_id` blank; the workflow checks out that tag and rebuilds it.

Watch progress under **Actions → Build and publish Vespera**. Repeat builds can reuse the Ubuntu package cache; a cold cache still installs the dependencies normally.

## Code signing (optional)

The builds are currently **unsigned**. Windows SmartScreen checks the Authenticode signature and publisher reputation; macOS Gatekeeper checks signing and notarization. Neither warning is caused by how the app is packaged, so removing files will not fix them. A new Windows signature can still need time to build reputation, so signing helps but cannot guarantee that SmartScreen stops warning immediately.

- **Windows:** use a trusted code-signing certificate and configure `bundle.windows.signing` in `src-tauri/tauri.conf.json`. Never put the certificate or its password in source control or chat.
- **macOS:** enroll in Apple Developer and configure `bundle.macOS.signing` in `src-tauri/tauri.conf.json` (identity + provisioning profile), plus notarization through Tauri's bundler options.

### Getting rid of the Windows "Windows protected your PC" screen

That blue SmartScreen window appears because the installer has no trusted signature, not because anything is wrong with the files. It cannot be removed by changing code. The options, from easiest to hardest:

1. **Sign with SignPath Foundation** (free for open-source projects): apply at `signpath.org/foundation`, then add their signing step to `release.yml`.
2. **Sign with Azure Artifact Signing** (formerly Trusted Signing, a paid monthly service) or a standard/EV code-signing certificate, and set `bundle.windows` signing in `src-tauri/tauri.conf.json`.
3. **Publish through winget or the Microsoft Store**, which have their own trust paths.

Until the app is signed, people can click **More info**, then **Run anyway**. Updates started from inside Vespera download the installer themselves, so they are not marked as "downloaded from the internet" the way a browser download is.

## Icons

App icons are generated deterministically (no design tools needed):

```bash
npm run icons   # → src-tauri/icons/icon.{png,ico,icns}, src-tauri/icons/{32,128,256,512}x*.png
```
