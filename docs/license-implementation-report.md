# License notices implementation report

Implemented generated desktop and Android dependency notices, packaged app notices,
and Settings → Open-source licenses on both applications. All four READMEs now
point to the included notices. Generation methodology and font provenance are
in [license-generation.md](license-generation.md).

## Validation

- `npm run typecheck`: passed after building shared workspace outputs.
- `npm test -w @fractal/ui`: 18 files, 74 tests passed.
- `node --test scripts/*.test.*`: 14 tests passed, including generator dedupe,
  transitive production closure, missing license-text coverage, and offline
  Electron-notice preservation on macOS/Windows/Linux.
- `JAVA_HOME=/Users/dowankim/Library/Java/JavaVirtualMachines/jdk-17.0.20.1+1/Contents/Home ANDROID_HOME=/Users/dowankim/Library/Android/sdk bash ./gradlew :app:assembleDebug :app:testDebugUnitTest`
  from `apps/android`: passed; 21 unit tests, zero failures.
- `npm run desktop:build` plus `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config scripts/release-config.cjs --mac --arm64 --dir --publish never`:
  passed (fast local .app equivalent, no DMG creation).
- `node scripts/smoke-packaged-release.mjs`: passed using the actual macOS arm64
  app executable; packaged Hub, UI assets, library API and native PTY work.
- Verified all 18 npm package manifests physically present in app.asar have
  matching name/version entries in the desktop notices. Production closure also
  covers bundled/inlined hub and UI dependencies.
- Verified `News Papers.app/Contents/Resources/licenses` contains repository
  LICENSE (11,357 bytes), THIRD_PARTY_NOTICES.md (1,254 bytes), and generated
  desktop-third-party.txt (136,586 bytes).
- `unzip -l apps/android/app/build/outputs/apk/debug/app-debug.apk` lists all
  three `assets/licenses` files. Their bytes exactly match repository/generated
  sources: LICENSE 11,357 bytes, THIRD_PARTY_NOTICES.md 1,254 bytes, and
  android-third-party.txt 718,123 bytes. The list contains 179 resolved module
  entries, including AndroidX/Compose/Kotlin/kotlinx/OkHttp, and full bundled
  font notices.
- Packaged Electron UI probe: the real read-only IPC returns all five notices;
  Settings → Open-source licenses opens a visible native dialog, and selecting
  LICENSES.chromium.html renders visible Chromium notice text in its sandboxed
  iframe under the shipped Hub Content Security Policy.
- `git diff --check`: passed.

## Electron runtime notices

Inspection found electron-builder 26.15.3 explicitly deletes Electron's LICENSE
and LICENSES.chromium.html during macOS packaging. The coordinator authorized
preserving these notices too. Release hooks now snapshot the exact target
Electron distribution immediately after extraction, then write
`resources/licenses/LICENSE.electron.txt` and `LICENSES.chromium.html` after
packaging. No network request, cache search, additional plugin, or runtime
dependency is introduced. This applies to both macOS architectures, Windows,
and Linux; platform preservation behavior is covered by unit tests. The desktop
IPC/dialog exposes these additional notices (Electron MIT notice: 1,096 bytes;
Chromium notices: 20,111,209 bytes), with Chromium HTML displayed in a
sandboxed iframe; the packaged probe now asserts all five files.

## Scope and limits

Android SettingsScreen resides inside the reserved reader directory; the
coordinator explicitly authorized only its six-line settings entry/navigation
change and the separate new OpenSourceLicensesScreen.kt file. No answer-card,
reader implementation or Hub history-route files were edited.

Browser/hub mode hides the license button because the desktop read-only preload
API is absent. Android metadata generation uses existing repositories and normal
Gradle caching; missing embedded upstream license text is marked with its POM
license URL. Both generators intentionally retain metadata for dependencies with
missing upstream text rather than silently dropping them.

The local macOS packaged smoke emits existing optional pdfjs canvas/polyfill
warnings, but its Hub/API/PTY assertions pass. This task does not change PDF
rendering or those optional native dependencies. No push, tag, release or remote
publication was performed.
