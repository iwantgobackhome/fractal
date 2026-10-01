# 0.2.0 release preparation checkpoint

Preparation is complete for coordinator review and integration. No push, merge, tag, release creation, workflow dispatch, full platform package build or installation was performed by this worker. Actual 0.2.0 all-OS CI, native package smoke results and publication decisions remain with the coordinator and independent QA.

## Source and versions

The checkout started at local dispatch-spec commit `8773926`, immediately above accepted clean source `239e444c`. Root/shared/Hub/UI package versions and internal shared dependency references now agree on `0.2.0`, with matching lockfile metadata. Android changes are limited to `versionName = "0.2.0"` and `versionCode = 2`; the accepted source previously declared versionName `0.1` and code 1. No Android dependency, UI product, Hub or shared contract source was changed.

## Prepared release behavior

- Windows x64 NSIS, Linux x64 AppImage/deb, macOS arm64 DMG and macOS x64 DMG, all with unique OS/architecture filenames and builder publication disabled.
- GitHub jobs on `windows-2025`, `ubuntu-24.04`, `macos-15` arm64 and `macos-15-intel` x64, with actual host assertions, npm CI and Node 22.23.1. Android uses JDK 17 and SDK/build-tools 35.0.0.
- Optional PTY package globs cover every installed OS/architecture and fully unpack native package files, preserving existing Windows paths. Local Mac packaging builds the host architecture because npm installs that architecture's optional PTY; separate CI hosts supply both DMGs.
- The package smoke runs the shipped Electron executable in Node mode, loads the bundled Hub and native PTY from ASAR, starts the Hub, checks library API and UI assets, and actually spawns the shipped PTY binary. It records shipped resource/native hashes; it has been prepared and syntax checked, not executed against a final package here.
- Source, complete app bundle (including symlink identity), per-platform payload and aggregate SHA manifests. Aggregate checks require all five jobs, all six distributions, one source commit, verified checksums and positive native desktop smoke records.
- Release-branch/manual validation produces artifacts only. A version tag must match all packages/Android exactly. Only the publication job has write permission; after all platforms and checksums succeed it creates a draft and refuses to replace any existing release.
- Mac builds default to explicit ad-hoc signing with Hardened Runtime/notarization disabled. Real configured certificates enable signing and force signing failure to fail the build; all configured Apple credentials plus signing enable notarization. There is no universal or unconditional notarized claim.
- Android restores a stable debug keystore from private `ANDROID_DEBUG_KEYSTORE_BASE64`; missing configuration fails before building. Final tag verification requires public repository variable `ANDROID_RELEASE_CERT_SHA256`, matching the prior public APK signing certificate. The coordinator owns verifying and privately configuring the old key; neither key nor private credential is committed or uploaded.

The Debian target needs project URL and maintainer metadata; the configuration supplies the actual repository homepage and the existing project's contributor maintainer name, without inventing an email. No dependency versions were changed.

## Documentation and visual evidence

All four README languages retain their original multilingual navigation and existing feature/privacy/setup/license content. Added descriptions cover scholarly UI, persistent history/annotations/sticky notes, Saved/Recent/nested folders, native News/Topics and article split reading, exact selection, in-app publication PDF and source-dependent image availability. Six concrete distribution filenames, signing boundaries and native-host commands are consistent across languages. Desktop and Android READMEs, `CHANGELOG.md`, release notes and `docs/RELEASING.md` provide matching detail.

Stale dashboard/dark-theme/old Android screenshot references were replaced with previously accepted actual scholarly client evidence. Existing screenshot files remain intact. These references are earlier qualified layout evidence, not captures of the final integrated 0.2.0 thumbnail source:

- `docs/implementation/desktop/stage3/discovery-1280-light-en.png`: accepted scholarly discovery runtime layout, including controlled unknown-metadata cases.
- `docs/implementation/desktop/pdf-reader-failure/packaged-public-original-read.png`: accepted packaged desktop in-app public publication PDF reader.
- `apps/android/qa/pdf-acquisition/screens/phone360-current/exact-user-current-verified-offline-reader.png`: accepted native Android PDF/cache reader.

The coordinator will integrate final client/backend thumbnail source and route final accepted thumbnail screenshots for the final README refresh. Current prose describes source-provided optional images without claiming coverage for every paper, automatic figure generation, guaranteed image acquisition, or available PDFs for every publication.

The new Linux 512px PNG and seven-resolution ICNS were generated from existing `apps/desktop/assets/icon.svg`; all prior accepted branch/window/tray/Windows icon assets were verified unchanged. No image generation or geometry change was used.

## Verification actually completed

| Gate | Actual result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; 400 installed packages, existing dependency versions preserved |
| `npm run desktop:build` | Passed on the preparation source: shared, UI, Hub and desktop bundle |
| `npm run typecheck` after shared build | Passed for shared/Hub/UI |
| actionlint 1.7.12 | Passed on the release YAML, including runner labels and expressions |
| Actual electron-builder 26.15.3 CJS config loader/schema | Passed without packaging |
| Focused preparation checker | Passed: permissions, native matrix, branch/tag guards, filenames, stable-key missing-secret rejection, icon preservation/containers, all-language navigation and local links |
| Negative version guards | Correctly rejected `v0.1.0`, `v0.2.0-rc.1` and `main`; accepted `v0.2.0` and `release/v020` |
| JavaScript syntax and `git diff --check` | Passed |
| Windows/Mac/Linux final packaging/native smoke | Not run; coordinator/CI owned after integrated source is declared |
| Android final APK/signature verification | Not run; requires coordinator's stable private key setup and final integrated source |
| Remote release/CI/publication | No worker operation performed |

An initial typecheck on the fresh checkout failed because the shared package had not been built yet. The normal desktop build succeeded, the subsequent typecheck passed, and CI now explicitly builds shared before typecheck. This was a clean-checkout ordering correction; no product source fix was made.

Repeat focused gates with `python docs/implementation/release/v020/check-preparation.py` (Python 3 plus PyYAML), `npm run release:verify`, actionlint on `.github/workflows/release.yml`, and `git diff --check`. Build shared first before a clean typecheck. Native CI must still execute the prepared scripts and validate actual uploaded files.

## Coordinator's remaining integration gate

Integrate the accepted final thumbnail contracts/client source and screenshots, review this checkpoint, set the stable Android key secret/public certificate variable, and choose one reviewed remote trigger. Review all actual native jobs and downloaded payload/source/resource/package manifests before promoting a draft. No physical-device, installation, API 35 runtime, external provider or request14 qualification is claimed here.

Runner and builder syntax were checked against [GitHub's current hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/), [v26 Mac signing/notarization options](https://www.electron.build/v26/docs/mac/) and [v26 Linux targets](https://www.electron.build/v26/docs/linux/). The installed 26.15.3 loader/schema was also exercised directly.
