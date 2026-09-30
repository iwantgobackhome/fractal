# Android reader interaction stability

Worker D, task `task_2ac8d14edf1e`, dispatch `ctx_af54d3b0f34b`, supervised run `run_7b1cfd9aece2`. Reviewed 2026-10-01, Asia/Seoul. Source baseline: `fbf0a12d234adbc6b67fcb70092a751ae8861d9e`. The coordinator owns integration; this worktree has not merged foundation, desktop, or prototype commits.

The scoped pen-induced layout jump is reproduced and corrected. Actual PDF pixels and the ink plane now share the measured zoom transform. This is software regression evidence, **not complete mixed-input/palm or physical S Pen acceptance**.

## Implementation

- Reader header measures 48.5 dp in both visible and hidden states, including the divider. Writing state cannot resize it; a labeled button restores controls. Scroll-driven visibility updates pause during pen ownership. Pen-down/up and restoring controls leave the paper's coordinates unchanged.
- PDF page aspect ratio is known before first layout rather than replaced after bitmap rendering. Zoomed page width is measured inside a clipped viewport, so the PDF does not letterbox inside a taller ink plane. Pinch uses a local focal point, bounded horizontal pan and vertical list compensation. Raw finger movement avoids feedback from the page moving underneath the pointers. Original and translation keep their existing independent list states; no annotation mapping or split-reading feature was added.
- The ink surface classifies each pointer's actual tool type. Pen drawing, text selection and erasing reserve the stream, explicitly disallowing parent interception; additional pointers do not navigate. After pen-up, a remaining palm is suppressed until the stream ends. Cancellation, detachment and stream completion release ownership. Ordinary single-finger reader scrolling delegates to `LazyColumn`; explicit two-finger transforms own only their stream, and pointer removal rebases the centroid. The standalone ink demo retains its existing callback behavior.
- Cancellation discards partial strokes and does not create an undo entry. A canceled incidental palm pointer does not cancel a pen-first stroke. Brush, color, width, eraser mode and shape are captured per gesture. Recorded tilt is copied on commit, fixing a mutable-list alias that could crash dry rendering after erase/undo/another stroke. Predictor recording/predicted wet input and ordinary undo/redo remain in place.
- A distinct **Select text** tool reserves pen input for selection while preserving **Lasso** for ink selection. API 35 receives start/end boundaries; API 29–34 and PDFs without native selectable text retain an explicit region fallback, explain the limitation, and disable empty-text Copy. Range handles and offline older-API text geometry remain subsequent work.
- Reader-level question context carries selected text, physical page and first rectangle to the existing `/ask` endpoint. It is retained until explicitly cleared, including across compact panel dismissal; this does not implement persistent question history. Rectangles are clamped in the serialized number domain, and the existing language compatibility retry preserves selected context. Memo bodies render separately from optional quotes, including unquoted and legacy memos. No Room schema or backend contract changed.

## Executed verification

Environment: Windows host, process-local JDK `C:/Program Files/Java/jdk-17.0.2`, Android SDK `C:/Users/Home/AppData/Local/Android/Sdk`. Disposable existing `Pixel_2_API_34` AVD launched with `-read-only -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect`. Emulator display was 1080×1920 physical pixels, density 420 dpi (2.625 px/dp), API 34. No real app was reset or paired to a real Hub.

The fixture creates a four-page 600×800-point PDF locally, with printed text and a red marker. `ReaderInteractionTest` composes the actual `ReaderScreen` against this cached PDF, or the actual `InkCanvas` for focused state tests. It constructs `MotionEvent`s with pointer IDs, tool types, pressure, tilt, side-button and cancel flags, and dispatches them through the activity's window on the UI thread. Ordinary isolated streams use touchscreen or stylus source; mixed streams keep a stable touchscreen/stylus source. Page/ink coordinates come from `getLocationInWindow` and measured View dimensions. The printed PDF marker is measured independently from `UiAutomation.takeScreenshot()` pixel data.

These events exercise Android View/Compose/list routing and real native ink rendering. They bypass hardware device dispatch and vendor classification; they do not reproduce real palm size, hover, Samsung input firmware, latency, pressure calibration or fast handwriting timing.

| Probe | Baseline / before | Corrected / after |
|---|---|---|
| Pen paper top, before/down/up | 316 / 315 / 221 px | 316 / 316 / 316 px |
| Restore hidden reader controls after pen-up | Not a stable baseline geometry | Same paper coordinates |
| Ordinary finger scroll, paper top | 316 → -38 px, including changing header | 316 → 57 px with stable header |
| Pen-up with palm still down | Source risk; not executed on baseline | 316 px throughout pen/palm stream; fresh finger scroll resumes |
| Pinch ink bounds | Source showed constrained width and resized height | (0,316), 1080×1440 → (-250,16), 1620×2160 |
| Pinch focal content point | Not measured on baseline | (500,916) px retained, ≤3 px tolerance |
| Actual printed PDF marker | (514.5,935.0) px at fit width | (522.0,944.5) px after zoom, matching ink bounds within tolerance |
| Two-finger pan after zoom | Not measured on baseline | +80 px horizontally, +30 px vertically, exact expected bounds |
| Stationary pinch / lifted finger / pen after zoom | Source risks | No unintended geometry changes; normal parent scroll resumes |

Final instrumented suite: **11 tests, 0 failures**. It covers pen-down/up and control visibility, normal finger navigation, pen/palm ownership and release, canceled pen input, pen-first canceled palm removal, finger-first takeover while both pointers remain, the framework-cancel boundary and fresh-stream recovery, button eraser/undo/new stroke with independent tilt values, tool transitions/text-selection ownership, pinch centroid rebasing, and rendered PDF/ink zoom alignment and pan.

Android unit suites: **14 tests, 0 failures**: app context/memo regression tests 3, ink engine 6, sync wire 3, data merge 2. App and ink demo debug APK builds succeeded. `git diff --check` passed. The new app tests verify memo body/quote separation, selected text/page/rectangle/model propagation, preservation during the existing compatibility retry, valid edge rectangles and ordinary questions without selected context. They verify request construction, not live Hub delivery or durable history.

Commands, with `JAVA_HOME` and `ANDROID_HOME` set only in the process, from `apps/android`:

```powershell
./gradlew.bat :app:connectedDebugAndroidTest :app:testDebugUnitTest :ink:testDebugUnitTest :sync:testDebugUnitTest :data:testDebugUnitTest :app:assembleDebug :inkdemo:assembleDebug --console=plain
./gradlew.bat :app:connectedDebugAndroidTest --console=plain
```

The second command rechecks the final test changes. Compact runtime observations and the final instrumented execution log are beside this report. APK: `app/build/outputs/apk/debug/app-debug.apk`; instrumentation XML: `app/build/outputs/androidTest-results/connected/debug/TEST-Pixel_2_API_34(AVD) - 14-_app-.xml`.

## Diagnosed crash and explicit remaining boundary

The routed erase/undo/new-stroke test initially crashed in `DryInkView.drawStroke`:

```text
java.lang.IllegalArgumentException: INVALID_ARGUMENT: Either all or none of the inputs in a batch must report `tilt`.
  at androidx.ink.strokes.MutableStrokeInputBatchNative.appendSingle(Native Method)
  at androidx.ink.strokes.MutableStrokeInputBatch.add(StrokeInputBatch.kt:262)
  at app.fractal.ink.DryInkView.drawStroke(InkCanvas.kt:444)
```

The previous committed stroke referenced the live tilt list; a later stroke repopulated only part of it. The corrected commit copies the list, and the same test erases, undoes and draws another stroke with different tilt values while asserting the earlier samples stay intact.

A finger-first mixed stream that becomes a **sole stylus** is canceled by this Compose version's adapter. Temporary diagnostics recorded:

```text
action=0   flags=0  tracked=-1 penOwns=false ids=[(0, 1)]
action=261 flags=0  tracked=-1 penOwns=false ids=[(0, 1), (1, 2)]
action=6   flags=32 tracked=1  penOwns=true  ids=[(0, 1), (1, 2)]
action=3   flags=0  tracked=1  penOwns=true  ids=[(0, 0)]
```

Here tool type 1 is finger, 2 is stylus, and the final action 3 is a synthesized `ACTION_CANCEL`. The adapter resets pointer tracking when a sole pointer's tool type changes; the temporary trace has been removed from production source. The focused regression asserts the canceled partial stroke is discarded and the next fresh pen stream works. **This transition remains unresolved software acceptance**, explicitly accepted by the coordinator as a boundary for this prerequisite; it is not counted as successful uninterrupted mixed-input writing. No broad Activity touch bypass or cancellation-to-commit workaround was introduced.

No real Galaxy Tab or S Pen was used. Hardware acceptance remains open for repeated writing, slow/fast strokes, pen-first and palm-first contact, pen-up with palm remaining, side-button/eraser-tip behavior, hover, cancellation, portrait/landscape, split screen, DeX and resize/rotation. API 35 range exactness, handles and the forthcoming API 29–34 offline geometry integration also remain open. Persistent question history will use the coordinator's accepted foundation in the next Android integration stage; this branch deliberately keeps baseline APIs. Request 14 and annotation mapping are excluded.
