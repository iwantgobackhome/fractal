# News Papers rename validation

The display name, repository links, release artifact contract, Android application ID (`app.newspapers.reader`), and desktop app ID (`app.newspapers.desktop`) are updated without a version bump. Desktop executable names are `news-papers` on Windows/Linux and `News Papers` on macOS, producing `News Papers.app`; Debian uses package name `news-papers`.

Desktop migration copies old Hub data and Electron profiles into the new defaults before the single-instance lock or Hub startup. It retains originals, preserves existing destinations and explicit overrides, and publishes complete copies through a temporary sibling and rename. Interrupted temporary copies are replaced on the next attempt. Failures stop startup with a generic message that contains no paths or data.

Validation on macOS arm64:

- `npm run typecheck`: passed after building `@fractal/shared` on the clean checkout.
- `npm test -w @fractal/hub`: 248 passed; the three pre-existing failures are Claude usage shutdown and the two publication/open altered-cache checks.
- `cd packages/ui && npx vitest run`: all 14 files / 54 tests passed.
- `node --test scripts/release-artifacts.test.mjs scripts/data-migration.test.cjs`: all 9 tests passed, including all three migration platforms, interrupted temporary copies, existing destinations, overrides, legacy APK alias requirements, and rejection of differing alias bytes.
- `FRACTAL_E2E_CHANNEL=chrome npm run e2e`: passed.
- Required Android app/data/ink/sync unit tasks and `:app:assembleDebug`: passed with the supplied JDK 17 and local Android SDK.
- `verify-android-release.mjs`: passed; actual `aapt dump badging` reports `app.newspapers.reader`, version `0.2.4`, code `6`, and `News Papers` labels, including Korean.
- Unpacked `electron-builder --mac dir --arm64 --publish never` build: passed; Info.plist reports `CFBundleIdentifier=app.newspapers.desktop`, `CFBundleExecutable=News Papers` in `News Papers.app`.
- Launching the packaged app with temporary HOME and `--headless` reached `desktop.ready`. A sentinel in the old `.local/share/fractal` appeared unchanged in `.local/share/news-papers`; the original remained. macOS Cocoa derives Electron appData independently of HOME, so the temporary profile was not part of that launch; profile migration is covered in isolated directory tests.
- Old GitHub repository URLs remain only in untouched historical CHANGELOG, release notes, and implementation evidence.

Intentionally retained names: `FRACTAL_*`/`PAPERREAD_*`, `@fractal/*` and root npm package name, Kotlin namespaces/packages/classes/theme names, internal TypeScript/code identifiers and wire/API names, generated token names, historical evidence/release notes/CHANGELOG, test fixture names, old migration source paths, and icon asset paths owned by the other worker. Published 0.2.4 download URLs retain their existing `Fractal-*` asset basenames, while repository URLs and display text are updated.

The coordinator approved exactly one transitional compatibility artifact: an identical `Fractal-${version}-android-debug.apk` alias beside the new APK, present in both Android and aggregate checksums. Old Android clients require that name for discovery; the new application ID means News Papers installs separately. Future release versions, notes, GitHub repository rename, publication, icons, and the Settings update section remain with the coordinator/other worker.
