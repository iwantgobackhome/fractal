# Building and reviewing a Fractal release

The release workflow builds one reviewed source commit on Windows x64, Linux x64, macOS arm64, macOS x64 and an Android build host. It does not publish automatically: a matching `v<version>` tag can create a draft only after all jobs and the aggregate checksum job succeed. Branch and manual validation upload Actions artifacts without creating a release. The coordinator owns pushes, tags, CI dispatches and the final release decision.

## Versions and source gate

Use Node.js 22.12 or newer (CI pins 22.23.1), `npm ci`, `npm run release:verify`, `npm run build -w @fractal/shared`, `npm run typecheck`, and `npm run desktop:build`. The shared package must be built before Hub/UI typechecking on a clean checkout. The root, shared, Hub and UI manifests and lockfile must agree. Android must have `versionName 0.2.3` and `versionCode 5`; the tag must be exactly `v0.2.3`. A higher historical Android code would require a reviewed monotonic increment before changing this gate.

The workflow accepts `release/**` pushes, `v*` tags and manual dispatches on a release branch or version tag. First validate the reviewed source and any corrections on a release branch. After that matrix succeeds and its artifacts are reviewed, create the immutable version tag at that same source commit; the tag runs the final publication matrix. Avoid an additional manual dispatch for a ref already being validated by its push or tag event. Do not overwrite main or the existing 0.1.0 release. Validate YAML with actionlint and inspect native host architecture assertions before any external operation.

## Native desktop packages

| Host | Command | Expected files under `dist/installer/` |
| --- | --- | --- |
| Windows x64 | `npm run desktop:dist:win` | `Fractal-0.2.3-win-x64.exe` |
| Linux x64 | `npm run desktop:dist:linux` | `Fractal-0.2.3-linux-x64.AppImage`, `Fractal-0.2.3-linux-x64.deb` |
| macOS Apple Silicon | `npm run desktop:dist:mac` | `Fractal-0.2.3-mac-arm64.dmg` |
| macOS Intel | `npm run desktop:dist:mac` | `Fractal-0.2.3-mac-x64.dmg` |

CI uses `windows-2025`, `ubuntu-24.04`, `macos-15` (Apple Silicon) and `macos-15-intel`, checks the actual Node host architecture, and builds each Mac architecture on its native runner. The local macOS command builds only the host architecture, matching npm's installed optional PTY package; produce the second DMG on a host of that architecture. Local cross-architecture packaging cannot establish native runtime success. Every builder passes `--publish never`.

The accepted Windows branch icons are preserved. `generate-distribution-icons.mjs` rasterizes the established icon SVG into Linux PNG and a multi-resolution macOS ICNS; no new visual is generated. The package includes all `@lydell/node-pty-*` optional platform packages installed for the host and unpacks their native files from ASAR. Do not use `npm ci --omit=optional` or copy `node_modules` across OS/architectures.

After packaging, run `node scripts/smoke-packaged-release.mjs`, then `node scripts/release-manifest.mjs <platform>-<arch>`. The smoke uses the shipped Electron executable in Node mode, imports its ASAR Hub, serves its UI/library API and spawns a terminal through its shipped PTY. It records real unpacked native binary and resource hashes. Package manifests hash the complete app bundle and distribution manifests hash files submitted for release. This proves bundled startup, not a GUI installation or every product feature.

## In-app updates

Packaged Windows NSIS and Linux AppImage/deb builds check the published GitHub release after ten seconds and every six hours. The tray also offers **Check for updates**. Downloads begin only after **Update**, and installation waits for **Restart to update**. **Later** hides that version until a different version appears. Development builds have no updater. Packaged macOS builds are unsigned, so Squirrel.Mac cannot apply updates: they read the GitHub `releases/latest` API on the same schedule, show **Open download page** for a newer version, and open the release page in the browser. macOS remains DMG-only and needs no `latest-mac.yml`.

`release-config.cjs` declares the GitHub publish provider for `iwantgobackhome/fractal`, while all builds retain `--publish never`. Upload `latest.yml` and the matching `.exe.blockmap` from Windows, and `latest-linux.yml` and the matching `.AppImage.blockmap` from Linux alongside the installers. AppImage's runtime uses its embedded differential map; the build hook additionally exports the external map for the release checksum contract. Matching `.deb.blockmap` files are copied if present. The manifest and aggregate verifier require the metadata and primary blockmaps, hash them, and reject unknown files even when a platform checksum lists them. Run `node --test scripts/release-artifacts.test.mjs` to exercise copying, aggregate acceptance, missing metadata/maps and unknown-file rejection with isolated fixtures. The packaged Hub/PTY smoke is unchanged and does not launch the updater.

Android checks `releases/latest` at app startup at most once per 24 hours, with a manual **Check for updates** button in Settings. It compares the release tag against `BuildConfig.VERSION_NAME`, downloads the exact `Fractal-<version>-android-debug.apk`, and verifies its SHA-256 against the same release's aggregate `SHA256SUMS.txt` before opening the Android installer. Android may ask the user to allow Fractal to install apps; installation resumes after approval. APK signing identity must still match the installed app. Only published releases are visible to update checks: review and manually publish the draft with all installers, metadata, maps and checksums together.

## Signing

Without configured Mac credentials, `release-config.cjs` selects an ad-hoc identity (`-`), disables Hardened Runtime and skips notarization. This is not Developer ID signing or notarization and may require the user to approve opening an application in macOS security settings. The two DMGs are not universal builds.

Optional Mac Actions secrets are `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Real certificate credentials enable signing; all three Apple notarization credentials plus signing enable notarization. Configured signing/notarization failures must fail the job rather than be represented as successful signed outputs. Windows signing credentials are not configured by this pipeline.

## Android debug distribution

CI uses JDK 17, SDK platform 35 and build-tools 35.0.0, then runs `bash gradlew --no-daemon :app:assembleDebug` in `apps/android`. It restores the stable debug keystore from the private `ANDROID_DEBUG_KEYSTORE_BASE64` Actions secret to an isolated runner temporary path. Restore and Gradle use the same explicit `FRACTAL_ANDROID_KEYSTORE_PATH`; CI refuses a missing path or key and never falls back to a random signing identity. Before assembly, JDK keytool exports the public certificate and checks its SHA-256 against the previous release. Restoration refuses to overwrite an existing file. Local builds retain their existing default signing configuration when the CI path variable is absent. Never commit the key or upload it in artifacts.

Set the public repository variable `ANDROID_RELEASE_CERT_SHA256` to the prior APK certificate SHA-256 (hex, colons optional); every release workflow build requires it for the prebuild key check. `verify-android-release.mjs` then independently checks the assembled APK application ID, version/code, min/target SDK, debug signature and certificate. The report contains only public certificate information. `release-manifest.mjs android` copies the APK as `Fractal-0.2.3-android-debug.apk` and hashes the payload. No new release keystore or SDK credentials are needed for this debug distribution. These checks make no emulator, physical-device or API 35 runtime claim.

## Aggregate review and draft publication

Each of the five platform jobs uploads a uniquely named artifact. The aggregate job requires all native jobs to succeed, checks six installers plus Windows/Linux update metadata and blockmaps, verifies every per-platform checksum, checks one source commit and positive desktop Hub/PTY smoke results, and writes `SHA256SUMS.txt`. Only the publication job has `contents: write`; it rechecks versions and the aggregate manifest and refuses to mutate an existing release. It creates a draft with `gh release create --verify-tag --draft`.

Before promoting that draft, download and verify the files and manifests, inspect each platform's native evidence, compare the reviewed source and bundled resources, and record the actual Actions run URL/commit. Check the Android certificate against 0.1.0 and inspect actual Mac signing results. A prepared configuration, a Windows source run, or a cross-build is not evidence that Mac/Linux native startup passed. Keep final evidence and unresolved limitations separate from preparation checks.

## Primary references

- [GitHub hosted runner OS and architecture labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/)
- [electron-builder v26 macOS and notarization environment](https://www.electron.build/v26/docs/mac/)
- [electron-builder v26 Linux targets](https://www.electron.build/v26/docs/linux/)
- [actionlint 1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)
