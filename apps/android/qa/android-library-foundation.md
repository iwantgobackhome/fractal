# Android library and offline foundation

Worker D, task `task_9788900aca91`, dispatch `ctx_9628e7cd31b6`, supervised run `run_7b1cfd9aece2`. Reviewed 2026-10-01, Asia/Seoul. Base is coordinator-supplied `b2d659c` (reviewed iteration02 design), on foundation `3510324` and accepted reader stability `d042b41`. Only Android files changed; no merge, shared tokens, desktop or Hub edits. Request 14 is excluded.

## Delivered behavior

- Explicit Room migration 1→2 keeps old paper keys, bibliography JSON, PDF hashes/paths, page counts, annotations including memo bodies/quotes and ink samples, dirty state and decimal pull cursor. The old shelf becomes Saved with savedAt=addedAt; lastReadAt/progress remain unknown until an actual cached PDF is loaded. Migration never uses destructive fallback. New tables persist folders, complete history/snapshots, immutable metadata requests, latest remote revisions and retained obsolete folder edits.
- Saving, ingestion, caching and actual reading are separate. Saved and Recent can overlap; unsaving keeps the paper, PDF, annotations and read history. Loaded PDF/page changes queue a real read event, and the reader restores its physical page. Finer scroll/block anchors and split-reading controls belong to stage3.
- Paper, folder and settled-history mutations queue atomically with the local projection. Exact retries preserve request UUID/body, including a response lost after application; CAS rejection creates a new UUID against current authority and preserves independent unsent edits. Three-way tag/membership merges preserve independent additions/removals and legacy orphan memberships. Latest pulled authority prevents an old replay receipt regressing newer fields. Older or equal read timestamps keep the current timestamp/progress pair, comparing actual Instants even with different ISO precision; newer and progress-only updates still work.
- Only a fully applied pull advances the consumed checkpoint. Push cursor/serverHead never does. An annotation acknowledgement clears dirty state only when the persisted JSON still equals the immutable JSON sent. Older Hubs without metadataResults leave metadata queued for compatible reconnect.
- Nested folder create/rename/move/delete supports multiple memberships, descendant union counts and tags. Cycles/deleted parent reuse are rejected. Local deletion waits for older dependent paper/child edits to settle before the Hub deletes that folder. A remote tombstone rebases invalid pending memberships/parents with fresh receipts, promotes children and preserves other memberships/tags/saved state/papers/annotations. Obsolete rename/move intent is retained in a durable audit and accessible through **Review retained edits**; a duplicate pure delete is settled without resurrection or endless retry.
- Full paper snapshots and translations are cached. Translation joins use stable blockId and positive one-based physical regions.page; pageOrdinal is never used as a paper page. Unlocated blocks are omitted rather than assigned a fabricated page. Original snapshot JSON and future optional bibliography fields are preserved.
- The reviewed scholarly library uses bundled Source Serif 4 and Pretendard, accepted common colors, full M3 semantic roles and restrained shapes. Titles/authors wrap; metadata is at least 12sp. A 360dp phone has bottom destinations; tablets have an index and, from 840dp, a scrollable paper detail pane. Tablet rail width follows font scale. Short landscape moves search into a functional sheet and keeps the content scrollable. Search/filter/destination state survives opening a reader or settings. Existing import, pairing, cache controls, reader tools and settings remain available. No nonfunctional discovery destinations or review-fixture product data were added.
- Custom selectors expose complete selected labels, selection semantics, 48dp minimum targets, visible keyboard focus, scrolling Home/End/arrow navigation, Enter and Escape. Dynamic removed/empty/loading choices are guarded. Tab→Close→Enter closes without choosing; focus returns to the trigger. Close/Unavailable/Loading use English/Korean resources resolved before the native Dialog composition. Settings and model/language choices use this component.
- Launcher adaptive and legacy vectors derive from the accepted 40-unit branch master. Manifest icon and roundIcon point to the same launcher resource. APK inspection confirms adaptive foreground/background, explicit legacy drawable, branch vector and both actual font assets. The in-app branch uses current ink color so it remains visible in Dark.

## Executed verification

Windows, process-local JDK `C:/Program Files/Java/jdk-17.0.2`, SDK `C:/Users/Home/AppData/Local/Android/Sdk`, disposable unpaired `Pixel_2_API_34` AVD (`-read-only -no-window -no-audio -no-snapshot`, software GPU), serial emulator-5554. No real user library, credentials or database was accessed. One earlier unreleased development-v2 DB was cleared on this disposable AVD while the v2 schema was being developed; the acceptance fixture independently opens an actual pre-foundation v1 file through the final migration.

**18 unit tests passed:** app context/memo 3, ink 6, sync wire 3, existing data merge 2, new metadata/translation merge 4. The read-event unit test explicitly covers older/newer timestamps, equal instants with different ISO representations and progress-only updates.

**30 instrumented tests passed:** LibraryFoundationTest 9, LibraryUiTest 9, OfflineLaunchTest 1, accepted ReaderInteractionTest 11. Debug app and test APKs build successfully. Final passing logs: [build](stage2-final-build.log), [instrumentation](stage2-final-tests.log).

After the final narrow large-font header placement adjustment, 13 focused UI executions passed against the final APK: six window sizes, three tablet font/keyboard checks, one phone font check and three theme/settings checks. The final build and all unit suites also pass. An intermediate UI run exposed a fixture timing race: the database save change preceded the Room Flow list removal, allowing the next first-row Organize action to target the outgoing row. The test now waits for that row to leave Saved before choosing the next row; the complete 30-test rerun passed.

The nine foundation tests operate the actual Room database with a contract test transport. They cover:

1. A manually created real SQLite v1 file and a valid four-page PDF fixture, migration validation, byte-identical cached PDF, IDs/dirty annotations/memo context/ink/cursor preserved, old Saved and unknown read state.
2. CAS rejection, new request ID, independent remote tags/venue and a concurrent later local title edit.
3. Offline failure and application-before-response-loss, exact receipt retry, newer pulled revision surviving replay and pull checkpoint safety.
4. Legacy-Hub missing metadataResults and compare-to-sent annotation acknowledgement retaining a concurrent memo body/quote edit.
5. Local nested folder deletion, promotion, multiple memberships, annotation retention, cycle and tombstoned-ID protection.
6. Offline save, actual read, nested folder/tag and full settled history context/answer round trip after the transport reconnects.
7. Local deletion ordered after queued membership edits under the Hub's exact new-folder-membership validation rule.
8. Remote folder deletion rebasing queued membership intent, independent tags/save and child promotion, including preserved pre-existing orphan memberships.
9. Remote deletion against queued rename and duplicate delete: empty settled queue, durable obsolete intent, authoritative tombstone/promotion and retained independent paper fields.

The transport reproduces the published Hub CAS/receipt and new-membership validation behavior; these are **not a live HTTP Hub integration test**. A paired end-to-end reconnect with the coordinator-integrated Hub remains system acceptance.

The actual MainActivity cold-launch test opens a cached valid PDF without pairing/Hub, explicitly unsaves the fixture and records Recent on actual read without re-saving it. The reader UI test opens a real cached PDF and snapshot and confirms stable-ID translation on physical page 2 despite pageOrdinal 9. Selector tests send real emulator keyboard events, including dynamic removal, empty/loading, a 60-choice Home/End list, Korean labels and Close/focus restoration. Fixtures exist only in androidTest.

The 11 accepted reader interaction regressions pass after integration. Their earlier measured baseline/corrected geometry and hardware limitations remain in [reader-interaction-stability.md](reader-interaction-stability.md): paper top before/down/up 316/315/221 → 316/316/316 px, normal finger 316→57 px, pen/palm stream stable and fresh finger navigation resumes. Stage2 changes no ink ownership, predictor, eraser/undo or PDF transform code.

## Actual screen evidence

Screens are native UiAutomation captures of the production composables with isolated bibliographic QA records, not HTML prototypes. At density 160, requested physical size equals nominal total dp; Android system bars reduce the reported content height used in filenames. All screenshots include the system bars. Final screen directory: [stage2-screens/stage2-qa](stage2-screens/stage2-qa).

| Requested full size | Configuration / evidence |
|---|---|
| 360×800 | [Phone portrait, bottom navigation](stage2-screens/stage2-qa/library-360x752.png) |
| 800×360 | [Short landscape, functional search sheet entry and scrollable content](stage2-screens/stage2-qa/library-800x312.png) |
| 800×1280 | [Tablet portrait index](stage2-screens/stage2-qa/library-800x1224.png) |
| 1280×800 | [Tablet landscape index/detail](stage2-screens/stage2-qa/library-details-1280x744.png) |
| 1280×1800 | [Wide portrait index/detail](stage2-screens/stage2-qa/library-details-1280x1744.png) |
| 1800×1280 | [Wide landscape index/detail](stage2-screens/stage2-qa/library-details-1800x1224.png) |
| 800×1280, font scale 1.5 | [Scaled tablet](stage2-screens/stage2-qa/library-800x1224-font-1.5.png), [End focus scrolled into view](stage2-screens/stage2-qa/selector-long-list-end-focus-font-1.5.png), [keyboard Close](stage2-screens/stage2-qa/selector-close-keyboard-focus-font-1.5.png) |
| 360×800, font scale 2.0 | [Scaled phone, scrollable full labels](stage2-screens/stage2-qa/library-360x752-font-2.0.png) |
| 1280×800, alternate themes | [Dark](stage2-screens/stage2-qa/library-details-1280x744-dark.png), [Sepia](stage2-screens/stage2-qa/library-details-1280x744-sepia.png) |

[Korean title](stage2-screens/stage2-qa/library-korean-title.png) verifies the serif CJK fallback (Android native serif fallback, including Noto Serif CJK) rather than switching the heading to a sans typeface. Font licenses are under design/font-licenses; both fonts came from the project's existing bundled packages, without a new download. [Korean loading](stage2-screens/stage2-qa/selector-korean-loading.png) verifies actual localized selector labels. [Dark settings](stage2-screens/stage2-qa/settings-dark.png) and [Dark selector](stage2-screens/stage2-qa/settings-selector-dark.png) verify headings outside library surfaces. Additional keyboard captures use 150% font; all four scaled-screen/keyboard reruns passed. Visual review corrected an initially narrow scaled tablet rail, invisible Dark branch/uncolored heading and insufficient enlarged bottom-destination separation before these final captures.

At 360dp/200% font, the actual header title measures Rect(58,12,344,110) and the Settings button Rect(224,122,344,176), leaving 12dp vertical separation. The capture test asserts non-overlap; the user font scale remains intact and the Settings target exceeds 48dp. Measured header bounds, full pixel dimensions and content dp/fontScale for every final capture are in [stage2-screen-observations.log](stage2-screen-observations.log).

## Reproduction commands

From this worktree, with environment variables set only in the process:

```powershell
$env:JAVA_HOME='C:/Program Files/Java/jdk-17.0.2'
$env:ANDROID_HOME='C:/Users/Home/AppData/Local/Android/Sdk'
./apps/android/gradlew.bat -p apps/android :app:assembleDebug :app:assembleDebugAndroidTest :data:testDebugUnitTest :sync:testDebugUnitTest :app:testDebugUnitTest :ink:testDebugUnitTest --console=plain
$adb='C:/adb/platform-tools/adb.exe'
& $adb -s emulator-5554 install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s emulator-5554 install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $adb -s emulator-5554 shell am instrument -w app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
# Actual six-size captures: repeat with each size listed in the table.
& $adb -s emulator-5554 shell wm density 160
& $adb -s emulator-5554 shell wm size 360x800
& $adb -s emulator-5554 shell am instrument -w -e class app.fractal.reader.LibraryUiTest#captureActualScholarlyLibrary app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
# At 800x1280, repeat with font_scale 1.5 and the two keyboard methods.
& $adb -s emulator-5554 shell settings put system font_scale 1.5
& $adb -s emulator-5554 shell am instrument -w -e class 'app.fractal.reader.LibraryUiTest#captureActualScholarlyLibrary,app.fractal.reader.LibraryUiTest#selectorTabToCloseEnterRestoresTriggerWithoutChoosing,app.fractal.reader.LibraryUiTest#selectorHandlesDynamicRemovedEmptyLoadingAndLongKeyboardList' app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
# At 360x800 use font_scale 2.0; at 1280x800/font_scale 1.0 use -e theme Dark or Sepia.
& $adb -s emulator-5554 pull /sdcard/Android/data/app.fractal.reader/files/stage2-qa apps/android/qa/stage2-screens
& $adb -s emulator-5554 shell settings put system font_scale 1.0
& $adb -s emulator-5554 shell wm size reset
& $adb -s emulator-5554 shell wm density reset
& C:/Users/Home/AppData/Local/Android/Sdk/build-tools/35.0.0/aapt.exe dump badging apps/android/app/build/outputs/apk/debug/app-debug.apk
git diff --check
```

APK package/icon/font entries and SHA256 are in [stage2-apk-icons.log](stage2-apk-icons.log). Six-size, scaled-keyboard/phone and theme execution logs are alongside this report. Generated APKs remain normal ignored build outputs.

## Remaining acceptance and next stage

No real Galaxy Tab or S Pen was used; emulator injection cannot establish Samsung palm/hover/latency behavior. Physical hardware acceptance and the already documented finger-first→sole-stylus Compose adapter cancellation boundary remain open. This work preserves the accepted software behavior and does not claim to resolve that vendor/input boundary.

The published fine PDF layout contract has been received through the coordinator: direct data-unwrapped PdfTextLayout, one-based physical page, unrotated crop-relative normalized quads, intrinsic rotation once and original Unicode UTF16 boundaries with identity/version/hash checks. Its integration, selection handles, split/scroll geometry, sticky memo controls and durable generation/history UI are stage3. Full settled history context/answers are persisted/synchronized here; active Hub generation and legacy conversation ownership are not overwritten. Discovery is a subsequent stage; optional raw bibliography fields remain intact.
