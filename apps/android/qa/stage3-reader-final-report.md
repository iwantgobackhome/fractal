# Android reader stage 3

Implementation is complete on the accepted Android library/data foundation. This report accompanies the final owned Android commit; its exact SHA is supplied in the dispatch completion. The parent is `a45380be3e5235b52a929b71154b6e1510f04488`, with stage-3 checkpoint `6a0b724edde41c270f3c9a74072bb26b435d893c` and accepted library stage `fd2c836ab5b8e87ca209c711334feded931071f9` in its ancestry. No merge or shared/hub/desktop edits were made.

## Result and compatibility

- Expanded windows use actual original/translation panes; medium and phone windows switch panes using physical page, stable block ID and relative reading offset. These reading links are approximate within a page, not annotation mappings. Missing translated page content produces an explicit gap with access to the original page. Untranslated source-block fallbacks are labelled original passages.
- The two header rows, phone toolbar/tablet pen rail and PDF viewport retain their extent through writing, text selection and panel opening. The research panel overlays the viewport at a measured maximum of 420dp; it does not resize the paper. Tools expose original text selection, deliberate region selection, width reset, source notes and retained history. The full title/bibliography remains available in a scrollable dialog, including at 2x font scale.
- Source-only sticky notes retain complete body and quote independently, position, colour and collapse state. Move, edit, collapse and explicit delete use the existing dirty annotation path. Unpositioned legacy memos remain available in the panel.
- Original selection uses the accepted, data-unwrapped text-layout response cached by actual PDF SHA, extraction version and physical page. Identity, page count, crop/rotation, layout schema and legal UTF16 boundaries are checked before hit testing. Original Unicode is copied unchanged. Approximate font-advance envelopes are labelled as approximate highlights; they are not glyph outlines. Scanned/no-text/unsupported pages require a deliberate region fallback.
- API35 native selection references are isolated in `NativePageSelection`; the reader's canonical cached range path is common to API29-35. Native character indexes are never declared to be B's canonical offsets. New source provenance uses the accepted optional contract. Extraction coordinates rotate once into rendered coordinates; only explicitly unrotated records are rotated on display. Untagged legacy coordinates and JSON remain unchanged, with source uncertainty shown. Changed hash/layout/range hides obsolete geometry/thumbnail while retaining text.
- Translated content uses normal Compose text selection and the actual Android Copy toolbar. Quoting a copied translated excerpt retains translated provenance without original ranges, rects or translated position anchors. Request14 annotation remapping is excluded.
- Requests are persisted with immutable IDs and complete context before admission. Close detaches panel collectors/polling while Hub generation continues; explicit Cancel is a durable action. Reopen, paper-specific drafts, restart and offline history use Room. Same-ID retries recover ambiguous admission without creating another history entry or provider generation. Active Hub generations are never imported as settled local edits.
- Model/language selectors show complete selected labels, preserve unavailable explicit model choices, disable invalid sends, and retain arbitrary saved BCP47 language labels. Answer-language overrides use the accepted request contract and do not change global Hub preferences. History kind/status/context labels are localised; explanations show passage/figure and page context instead of raw generated coordinate prompts.

## Software input and layout diagnosis

The scoped `ReaderInputHost` owns only eligible original-page pen streams inside the measured reader viewport and outside registered controls/notes/handles/panels. A finger-first stream can transfer to the native pen owner without reconstructing a DOWN event: Android ViewGroup drops the intercepting POINTER_DOWN, so that same real event is delivered once after Compose receives its cancellation. Remaining palm pointers stay owned until the stream ends. Genuine CANCEL discards the stroke. Finger navigation and pinch/pan continue normally; side-button erasing, predictor use, tool capture and undo remain intact. There is no Activity `dispatchTouchEvent` bypass or cancellation-to-commit rule.

Early combined runs intermittently failed with reentrant layout or SnapshotStateObserver thread assertions. Original crash evidence remains in `stage3-crash-buffer.log`, `stage3-regressions-final.log` and `stage3-native-and-real-frame.log`. An empty debug fixture Activity removed the synthetic tests' disposal/replacement of MainActivity startup content and exposed the first caller in **`stage3-empty-fixture-routing.log`**: `LazyListState.scrollToItem` / `ReaderWorkspace.restore` after Room completion, through Compose ui-test Applying/FrameDeferring interceptors, on a `ThreadPoolExecutor` worker. App and test Compose both resolve to 1.8.0 (`stage3-compose-app-dependencies.log`, `stage3-compose-dependencies.log`); a version mismatch was not established.

`restore` now confines force-remeasurement to `Dispatchers.Main.immediate`, retaining the nonzero-fraction frame/yield and zero-offset fast path. **`stage3-main-restore-routing.log`: OK (13 tests)** combines all twelve synthetic actual-window routing/marker tests with a normal-frame production MainActivity max-zoom/leave/reopen/recreate/finger-scroll test. No exceptions are swallowed and no global measure/thread workaround is installed.

The production lifecycle test has no Compose test clock or test-owned composition. It reads live production semantics on main for navigation and injects normal window pointer events. This emulator's native accessibility roots were null even for shell uiautomator with MainActivity focused and power Awake. Native translated Copy therefore clicks the real floating-toolbar TextView obtained through public API29+ `WindowInspector.getGlobalWindowViews`; it never manufactures clipboard content.

Measured evidence includes the independent rendered red PDF marker, not only InkSurface bounds. At the recorded 4x case, paper bounds change from `(0,442,1080x1440)` to `(-1543,-1415,4320x5760)` with marker near `(515,1062)` and canonical final ink point approximately `(.4832176,.45069444)`. Dry rendering is derived at a maximum 4,194,304 pixels per needed layer (observed 4,191,372), while vectors, inputs, brush coordinates and full-size hit testing remain unchanged. Empty layers are not allocated.

## Verification

Environment: disposable owned `emulator-5554`, Pixel_2_API_34, Android API34; Java17 and SDK35 build tools. No real user library was opened. E owns the actual accepted local Hub and bridge; D used only `D-reader-catalog`, D-prefixed flights/folders and its designated private credentials. Credentials are not included in artifacts. E's other emulator/dataset and Hub lifecycle were not operated by D.

| Check | Result | Evidence |
|---|---|---|
| App + AndroidTest APK build; app/data/sync/ink unit tests | PASS; 25 unit tests (6/10/3/6), zero failures/errors | `stage3-build-final.log`, Gradle XML results |
| Combined native window routing and production normal-frame lifecycle | PASS, 13 tests | `stage3-main-restore-routing.log` |
| Original cached range/copy/quote, finger long press, finger start and pen end handle drags, actual translated Copy/quote, V2->V3 migration, retained-history repository tests | PASS, 6 tests | `stage3-range-cache-retention-final.log` |
| Accepted V1 migration and library/sync regression suite retained | PASS, 9 library tests in original 20-test run | `stage3-regressions.log` |
| Actual HTTP close/reopen, refused-endpoint offline reading/edit/reconnect, retries and cancel | PASS, 1 test | `stage3-http-bridge.log` |
| Actual HTTP in-flight history across separate Android processes | PASS before and after, 1 each | `stage3-http-restart-before.log`, `stage3-http-restart-after.log`, `stage3-http-restart-state.json` |
| Actual figure PNG/context/page-only citation, provider failure retained context and explicit UI Cancel | PASS, 1 test | `stage3-http-figure-cancel.log` |
| Six requested 360/800/1280 portrait/landscape capture profiles | PASS, 2 capture tests each | `stage3-capture-*.log`, `stage3-final-screens/` |
| Phone font2, tablet Dark font1.5, Sepia, actual Korean app locale | PASS, 1 capture test each | corresponding capture logs/screens |

The V2->V3 migration fixture preserves old papers/saved/read state, cached PDF bytes/path, old memo body/quote/colour/collapse/rect, history, an immutable pending mutation and a 64-bit cursor string; it adds only reader text/position/request cache tables. The V1->V3 fixture continues to leave last-read unknown for old cached shelves. Annotation JSON and revision acknowledgement guards are retained.

Original range tests copy `iii` exactly and extend by genuine finger/pen handles to canonical `[0,12)` (`WWW iii wide`), with unchanged paper bounds. The first 160dpi helper overshot by its 2px touch-slop trigger and correctly selected a legal trailing space; the injection was corrected rather than trimming clipboard text or relaxing the expected range (`stage3-range-cache-retention-touch-slop.log` preserves that diagnostic). Actual translated native Copy selects/quotes a proper substring without original offsets. Rendered PDF extraction envelopes independently contain actual pixels on physical pages1/2/3: 1699/1951/2217 dark pixels, including page2 rotation90 with crop `[60,80,560,720]` and page3 crop `[30,40,550,730]`. This proves envelope/frame alignment, not exact glyph outlines.

Final original/translated interaction captures additionally pass two tests in `stage3-range-clean-captures.log`; the source Copy capture waits for Android's system clipboard overlay to dismiss. The phone landscape history/quote captures were refreshed after the explicit panel-width correction. Earlier 411dp screenshots in `stage3-screens/` are intermediate interaction evidence; the final set is `stage3-final-screens/`.

HTTP offline tests use a real refused loopback endpoint, cached PDF/layout/snapshot/translations and the actual native dirty queue. Reconnect preserves memo body/quote/position/colour/collapse plus saved state, tags and D-only nested memberships. The actual five-page download has twelve stable blocks and nine completed translated blocks; remaining source-only content is honestly labelled. One lost-admission case intentionally closes a **real successful HTTP response** before reading its history ID and throws a scoped client IOException: that response-loss simulation is distinct from the real refused-endpoint outage. Retry uses the identical request ID. `stage3-http-final-state.json` records one provider call for every observed D flight, including the lost-response/retry cases.

Restart evidence uses two instrumentation processes and an explicit `am force-stop` between them, with D's server flight continuing and being released while Android is absent. The first instrumentation process had already ended by the host PID check; this is not claimed as killing a still-live PID mid-stream. Reopening in a different PID recovers the Room request/context and completed actual Hub history. Explicit UI Cancel differs from Close and leaves retained history available.

## Reproduction commands

From this worktree, PowerShell:

```powershell
$env:JAVA_HOME='C:/Program Files/Java/jdk-17.0.2'
$env:ANDROID_HOME='C:/Users/Home/AppData/Local/Android/Sdk'
./apps/android/gradlew.bat -p apps/android :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :data:testDebugUnitTest :sync:testDebugUnitTest :ink:testDebugUnitTest --console=plain
& C:/adb/platform-tools/adb.exe -s emulator-5554 install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
& C:/adb/platform-tools/adb.exe -s emulator-5554 install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& C:/adb/platform-tools/adb.exe -s emulator-5554 shell am instrument -w -e class 'app.fractal.reader.ReaderInteractionTest,app.fractal.reader.ReaderLifecycleTest' app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
& C:/adb/platform-tools/adb.exe -s emulator-5554 shell am instrument -w -e captureProfile phone360-ranges -e class 'app.fractal.reader.ReaderStageTest#genuineCachedRangeCopyQuoteAndHandles,app.fractal.reader.ReaderStageTest#fingerLongPressAndFingerPenHandlesChangeGenuineRange,app.fractal.reader.ReaderStageTest#actualTranslatedTextSelectionCopyAndQuote,app.fractal.reader.ReaderMigrationTest,app.fractal.reader.ReaderHistoryRepositoryTest' app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
```

HTTP test methods are `ReaderHubBridgeTest#aActualCloseReopenOfflineRetryAndExplicitCancel`, `#bAdmitBeforeExternalProcessRestart`, `#cRecoverAfterExternalProcessRestart` and `#dActualFigureFailureAndUiExplicitCancel`. They opt in through the designated private device config and assert disposable unpaired state. Known generated gesture/reader/lifecycle fixture queues are removed before HTTP admission so unrelated synthetic annotations never reach the Hub; D's actual cached paper, notes and history remain intact. Reverse ports are6174 and6175. Restart control releases only the recorded D flight through E's `/D/release` control; never use E's control actions or expose its credentials.

Capture commands use `wm density160`, `wm size` per the table below, `settings put system font_scale`, and instrumentation methods `ReaderStageTest#capturesSourceSplitAndCachedTranslation` plus `#capturesActualHubDownloadedPaperAndRetainedHistoryOffline`. `-e captureProfile <profile>` selects the output directory; `-e theme Dark|Sepia` applies the actual bundled theme. Korean uses `cmd locale set-app-locales app.fractal.reader --locales ko` and `#capturesKoreanCachedReaderLabels`, then restores English. PNGs are actual UiAutomation screenshots; filenames record Activity content dimensions/font scale, while PNG dimensions include system bars. `stage3-final-screens/manifest.json` records each PNG's full size and SHA.

| Profile | wm size (density160) | Theme/font |
|---|---|---|
| phone360-portrait / phone360-landscape | 360x800 / 800x360 | Light1.0 |
| tablet800-portrait / tablet800-landscape | 800x1280 / 1280x800 | Light1.0 |
| tablet1280-portrait / tablet1280-landscape | 1280x1800 / 1800x1280 | Light1.0 |
| phone360-font2 | 360x800 | Light2.0 |
| tablet1280-dark-font1_5 | 1280x800 | Dark1.5 |
| tablet800-sepia / tablet800-korean | 800x1280 | Sepia1.0 / Light1.0 Korean |

## Remaining limits and handoff

No physical Galaxy Tab or S Pen was used. Real palm rejection, device stream splitting, pressure/tilt/predictor behavior and sustained device performance still require physical acceptance; emulator injection does not establish them. The finger-first sole-stylus **software** cancellation boundary is fixed and tested, independently of that hardware gate. Runtime execution was API34 only: API29 and API35 device compatibility remains an explicit runtime gate despite the shared cached path and isolated native35 references.

Within-page original/translation reading links are approximate and preserve semantic physical page/block/relative offset; they do not claim fine source-to-translation glyph alignment. Legacy untagged coordinate provenance cannot be recovered reliably and is not silently repaired. Notes/history/source text survive even when precise geometry is unavailable. Native accessibility null roots on this disposable emulator remain a harness limitation; actual gestures, normal frames, actual native Copy, rendered pixels and Room/HTTP persistence were checked through independent paths.

The supervised discovery/news/topics/related stage is separate. No new discovery fields were guessed and no request14 was implemented. Per root, owned5554 and E's Hub remain available for the next dispatch; no lifecycle cleanup or unrelated work follows this completion.
