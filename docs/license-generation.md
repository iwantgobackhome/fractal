# App license notices

Both apps ship the repository `LICENSE` (News Papers, Apache-2.0),
`THIRD_PARTY_NOTICES.md` (including the original PaperRead MIT notice), and a
regenerated third-party dependency list. They are available in Settings →
Open-source licenses (설정 → 오픈소스 라이선스).

## Desktop

`npm run desktop:build` runs `scripts/generate-licenses.mjs` after the application
build. All desktop distribution scripts run this build, including release CI.
The generator follows production, optional and installed peer dependency edges
in `package-lock.json`, starting at the root application, `packages/hub` and
`packages/ui`, following workspace links and nested npm resolution. Development
edges are excluded. This deliberately conservative closure includes dependencies
inlined into `hub.mjs` and the UI bundle, fonts, the copied PDF worker, packages
removed by tree shaking, and native optional packages for other platforms.
Entries are deduplicated by name/version, with metadata and full installed
LICENSE/LICENCE/COPYING/NOTICE/OFL files. Missing upstream texts are explicitly
identified; unavailable optional packages use lockfile metadata.

The output is `dist/licenses/desktop-third-party.txt`. electron-builder copies
this and the two repository notices into `resources/licenses` on all platforms.
Electron and Chromium supply their own notices in the Electron distribution.
The release configuration snapshots those notices in `afterExtract` and restores
them in `afterPack` as `resources/licenses/LICENSE.electron.txt` and
`LICENSES.chromium.html` on every target. This uses the already extracted exact
target distribution, requires no additional download/cache lookup, and prevents
electron-builder from discarding them on macOS. The desktop dialog lists both;
Chromium HTML is displayed in a sandboxed iframe. The packaged probe requires each application notice to exist
and contain text. Desktop preload exposes a fixed, read-only `readLicenses` IPC;
it accepts no path and checks the main frame and app origin. The UI uses a native
modal dialog with scrolling and hides the entry in hub/browser mode.

## Android

The app Gradle build defines `generateDebugLicenseNotices` and
`generateReleaseLicenseNotices`; each variant's asset merge depends on its task.
The task enumerates that variant's resolved runtimeClasspath module components,
including transitive AndroidX, Compose, Kotlin, kotlinx, OkHttp and other modules.
It resolves their POMs through the existing Google/Maven repositories, follows
parent POMs for inherited license metadata, and includes embedded license/notice
texts from resolved JAR/AAR artifacts where present. Missing embedded text is
explicitly marked with upstream license links from the POM. Failed POM resolution
fails the build rather than silently dropping a dependency. No new Gradle plugin
or repository is required; initial metadata resolution may need network access,
after which Gradle's normal cache applies.

Each variant includes `assets/licenses/LICENSE`,
`assets/licenses/THIRD_PARTY_NOTICES.md`, and
`assets/licenses/android-third-party.txt`. A copy of the generated list also goes
to `dist/licenses/android-third-party.txt` for inspection. The settings entry
opens a scrollable screen and reads those packaged assets off the main thread.

## Bundled font notices

Both applications also include the full font notices stored in
`scripts/license-texts`. Pretendard 1.3.9's npm tarball omits its upstream LICENSE,
so its notice is preserved from the
[matching upstream tag](https://github.com/orioncactus/pretendard/blob/v1.3.9/LICENSE).
The Source Serif notice preserves Adobe's copyright and reserved font name from
[upstream](https://github.com/adobe-fonts/source-serif/blob/release/LICENSE.md),
supplementing the npm package's own license text. These files require no network
access during notice generation. When upgrading bundled fonts, review/update
the corresponding notices.

Gradle's artifact-only POM resolution uses its documented
[artifact extension notation](https://docs.gradle.org/current/userguide/resolving_specific_artifacts.html).
