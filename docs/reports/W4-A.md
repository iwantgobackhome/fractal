# W4-A — Android English and Korean UI

## Delivered

- Moved user-facing text in `:app` and the `:ink` toolbar, including accessibility labels, into matching English `values/` and Korean `values-ko/` resources. `:design` has no user-facing string literals.
- Added Android per-app language selection (System, Korean, English) in Settings, with `locales_config.xml` for Android 13+ and AppCompat locale storage for older versions. System is the default.
- Added a first-run language screen before Connect. Leaving its System selection untouched allows a paired hub's `GET /api/preferences` `uiLanguage` to become the app language. An explicit device selection takes precedence. Missing or older preferences endpoints are ignored.
- Sent `answerLanguage` with questions and retried without the hint if an older hub responds with HTTP 400.
- Removed the extra page line from a textless region highlight in Notes; it now shows one `p.N region` / `p.N 영역` label with the crop.
- Saved the selected paper key across locale-driven activity recreation so an open reader can be restored.

## Verification

- `gradlew.bat test assembleDebug --console=plain`: **BUILD SUCCESSFUL** (380 tasks).
- English/Korean resource key parity: `:app` 75/75 and `:ink` 34/34, with no missing keys.
- Source audit over `apps/android/{app,ink,design}/src/main/java` using `rg -n -F 'Text("'`, `rg -n -F 'contentDescription = "'`, and `rg -n '[가-힣]'` (Kotlin files): no matches. The remaining string literals are identifiers, network keys, configuration values, and user data. `git diff --check` passed.
- Installed on an Android 13 emulator and checked first-run System default and Continue to Connect, Settings language switching, library, reader, and the single Notes region label. Captures are valid PNG files at 1440×3088 (phone) or 2560×1600 (tablet).

| View | English | Korean |
| --- | --- | --- |
| First run, phone | [Language](W4-A-phone-first-run-en.png) | — |
| Library, phone | [English](W4-A-phone-library-en.png) | [Korean](W4-A-phone-library-ko.png) |
| Reader, phone | [English](W4-A-phone-reader-en.png) | [Korean](W4-A-phone-reader-ko.png) |
| Notes, phone | [English](W4-A-phone-notes-en.png) | [Korean](W4-A-phone-notes-ko.png) |
| Settings, phone | — | [Korean](W4-A-phone-settings-ko.png) |
| Library, tablet | [English](W4-A-tablet-library-en.png) | [Korean](W4-A-tablet-library-ko.png) |
| Reader, tablet | [English](W4-A-tablet-reader-en.png) | [Korean](W4-A-tablet-reader-ko.png) |

## Limits

The paired hub available for emulator captures predates `GET /api/preferences`, so hub language adoption and question hint handling were verified by code/build review, not against the new hub endpoint. The emulator ran Android 13; AppCompat support below API 33 was configured but not exercised on an older emulator.
