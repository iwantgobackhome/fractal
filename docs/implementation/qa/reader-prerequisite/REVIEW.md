# Reader prerequisite evidence — E

Accepted source: `9dea34cebe4133068b63a289b504cce141d889f1`; supervised run `run_7b1cfd9aece2`, task `task_0a66de26df69`, dispatch `ctx_6d7bef177bfd`. Review date: 2026-10-01 Asia/Seoul. Requests 1–13 only; request 14 is excluded. This is coordinate/provenance and integration prerequisite evidence, not acceptance of C/D's new reader UX or physical input.

Two Hub defects were reproduced through actual loopback HTTP: the local PDF-link media-type guard rejects valid PDF uploads, and a question can persist and cite a physical page beyond the known PDF page count. Existing displayed annotation ratios must retain their interpretation: treating every historical row as B's unrotated quads demonstrably displaces it on a rotated page. No production source or stored user annotation was edited or migrated.

## Coordinate and provenance compatibility

| Producer → consumer | Accepted convention | Compatibility with B; evidence level |
| --- | --- | --- |
| B `PdfTextPage.runs[].units[].quad` | Four top-left, unrotated crop-relative normalized points; physical page is one-based; intrinsic rotation is separate | Rotate exactly once before displayed-page scaling. Actual accepted fixture extraction, PDF.js viewport math, independent MuPDF render and visual inspection passed. |
| Source `Block.regions` | Unrotated crop-relative axis-aligned boxes from hub PDF extraction; `pageOrdinal` is a within-page ordinal | Same base frame as B, but no UTF-16 selection offsets or polygons. Source inspection only; cannot treat these as a native displayed selection or as a physical page number. |
| PC TextLayer drag → `Highlight.rects` | `PdfPane` measures displayed span bounds, `sweepSelection` selects whole runs/lines, `selectionToRegions` divides by displayed page box; `HighlightLayer` paints percentages unchanged | Historical rectangles are displayed-page ratios, including intrinsic rotation already applied by TextLayer. Executed accepted functions + real fixture viewport math establish frame mismatch; no new Electron reader drag was executed. This accepted path does not use `Range.getClientRects()` for its saved highlight. |
| PC pointer ink → `InkLayer` | Pointer position divided by displayed host width/height; outline multiplies by displayed page dimensions | Same displayed frame as historical PC highlights. Source inspection; no pen hardware run. |
| Android API29–34 fallback → highlight/memo | `PdfPages.select()` returns null; `PdfPage` makes a blank-text rectangle from rendered touch start/end, or a fixed box around rendered long-press point; saveMemo retains first rectangle | Displayed bitmap ratios. Accepted fallback does **not** consume source `Block.regions`; no creator/consumer mismatch from block geometry was established. Exact path inspected in accepted source and the corresponding peer files then available. |
| Android API35 native selection → highlight/memo | Input normalized touch × `PdfRenderer.Page.width/height`; native bounds ÷ those dimensions; native selected chunks joined with spaces; consumers draw ratios directly | API docs establish top-left point coordinates and page text-stream indexes. Native crop/intrinsic-rotation equivalence to B has **not** been executed or established; do not apply an extra rotation or reuse native indexes as B offsets on this evidence. |
| Android ink → bitmap overlay | `InkCanvas` divides local touch by rendered page size, stores `[x,y,pressure,tMillis]`; draw multiplies normalized values by display dimensions | Displayed frame; compatible with PC displayed ink convention by source inspection. No real input/native drawing acceptance claimed. |
| `/ask` and `/explain` history context | Caller-supplied one-based `context.page` and normalized rect; quote stored as `selectedText`; explanation stores `explanationKind` | HTTP preserves supplied geometry/page, but no coordinate-space/hash/layout-version marker exists in accepted context. The server does not infer provenance or fix a wrong page/frame. |
| Android cached PDF/snapshot/positions | PDF filename identity uses SHA; commit hashes downloaded bytes; snapshot contains Paper `extractionVersion` | Actual HTTP layout version is `pdfjs6-original-advances-v1`, while Paper extraction version is `pdfjs6-lines-v4`. These are different identities. Position cache must use layout's own `(actual PDF SHA, layout extractionVersion, physical page)`, not Paper block version. Current accepted Android has no B position-cache/drag integration yet. |

All accepted memo/highlight/ink records lack a stored frame version, PDF SHA and B text-range offsets. Paper identity alone cannot establish which creator frame an arbitrary untagged imported annotation used. Preserve historical render/storage semantics; do not guess or rewrite old geometry. For **new original-PDF** records and reader request context, recommend an optional explicit frame/version (`rendered-page-normalized-v1` or `unrotated-crop-normalized-v1`), actual source PDF SHA, and layout version/range identity when using B offsets. Use a single documented frame conversion at the renderer/crop boundary. An optional schema must be preserved through sync, storage and clients; accepted Zod object parsing would discard unknown newly added fields unless B defines them.

Translation remains an independent text selection: ordinary copy and quote are in scope. Translated-to-original positioned annotation mapping, mirroring or coordinate conversion is forbidden by request 14.

## Executed fixture evidence and placement risk

Original fixture: `packages/hub/test/fixtures/text-layout.pdf`, SHA-256 `f79b45a88b17b236ade1298edf4cafdceae6a9f19907eb29126332a7c9037b96`. The probe freshly extracted its five pages into [layouts.json](layouts.json). [coordinate-checks.json](coordinate-checks.json) records PDF.js viewport calculations and accepted legacy function outputs; [rendered/selection-checks.json](rendered/selection-checks.json) records independent MuPDF checks.

| Actual selection | Executed result |
| --- | --- |
| Page 1 `iii`, UTF-16 `[4,7)` | Unrotated/displayed frame agreement; independent advance-edge error 0.000004 PDF points. |
| Page 2 `iii`, crop `[60,80,560,720]`, intrinsic 90°, UTF-16 `[17,20)` | B bounding box `(x=.41452,y=.0869375,w=.02664,h=.02890625)` → displayed `(x=.88415625,y=.41452,w=.02890625,h=.02664)` in a 640×500 viewport. Independent advance-edge error 0.000021 PDF points; rendered polygon follows the vertical ink. |
| Page 3 `iii`, crop `[30,40,550,730]`, angled 30° text, UTF-16 `[11,14)` | Intrinsic page rotation is 0; the glyph quad retains the text angle. Independent baseline-origin error 0.000018 PDF points. |
| Page 5 `fi` `[16,18)`, decomposed `é` `[13,15)`, emoji `[38,40)` | Each range has one legal unit; extraction and independent visual review confirm indivisible ligature/grapheme/surrogate handling. Ordinary f+i also exists in the same fixture. |

Reviewed [selection contact sheet](rendered/selection-contact-sheet.png) and its representative page images. These are font advance/ascent/descent envelopes, not exact glyph outlines; the combining accent extends above its envelope. No general precision guarantee, OCR coverage, RTL fine-grained geometry, arbitrary equation reading order or platform hit-testing guarantee follows from these examples.

**R1 — high compatibility risk, B contract / C and D render owners.** Reproduction: preserve the page-2 displayed legacy box `.88415625/.41452`, then treat it as unrotated and apply 90° again. Expected: historic placement remains at `.88415625/.41452`. Actual mathematical result: `.55884/.88415625` (dimensions swap again), far from the original text. Conversely drawing B's unrotated box directly through the accepted percentage renderer yields top-left `(265.2928,43.46875)` pixels instead of displayed `(565.86,207.26)` pixels. Evidence: actual fixture viewport math plus executed `selectionToRegions`/`regionToPixels`. This proves incompatible frames, not that a new platform reader has already introduced this regression. Recommendation: optional explicit markers on new records; no silent historic migration.

The accepted PC helper also returns the entire `WiWi iii` span when a four-pixel drag intersects it; exact output is in coordinate-checks.json. This is an accepted source limitation supporting C's selection work, not a claim about its active reader implementation. Never fabricate B character positions by uniformly splitting a legacy span.

## Actual HTTP defects

| ID / owner / severity | Reproduction and expected | Actual / evidence / recommendation |
| --- | --- | --- |
| H1 / B Hub guard; C local PDF-link caller affected / high | Seed catalog metadata; local `POST /api/library/qa-reader-catalog/pdf`, valid loopback Origin + current startup token + `Content-Type: application/pdf`, accepted fixture body. Expected 201 linked publication reader. | **415**, `{error:{code:INVALID_INPUT,...}}`, before handler. Same body with disposable paired Android Bearer returns **201** and five-page Paper. `api/index.ts` exempts media type only for `/api/papers/upload`, leaving this newer binary link route behind JSON guard. Extend the narrow PDF media-type exemption to the library PDF-link route while retaining local host/origin/token checks. Probe case `local PDF-link rejected before handler`. |
| H2 / B AI route admission / medium | Ready five-page fixture; `/api/papers/qa-reader-catalog/ask` body `{question:'Page outside PDF',page:6,requestId:'outside-ask'}`. Expected reject a known impossible physical page before generation/durable admission. | **200** SSE; completed history `context.page=6`; deterministic provider has no page citation, and server appends **`[p.6]`**. Text-layout route correctly reports page 6 unavailable `page_out_of_range`. Validate caller page against known Paper.pageCount; inspect the same validation need on `/explain`, whose schema currently only checks positive integer. `/explain` out-of-range was not separately executed. Probe case `out-of-range question physical page admitted`. |

HTTP Kotlin-wire compatibility observation, **not an existing builder defect**: serializing `ReadProgress(page=2)` with explicit nullable defaults (`fraction`, `blockId`, `scrollOffset` all null), or Author with `orcid:null`, returns 400 in shared schema. Actual `MetadataStore.read` and current field patch builders omit those nullable defaults, and their representative HTTP requests passed. Retain those builder wire shapes or align serialization deliberately; do not broaden production schema based on an unused hypothetical path.

## Actual HTTP passes and exact lifecycle contract

The probe calls the real `createApiServer`, binds an ephemeral **127.0.0.1** port, uses new SQLite storage, a disposable `JsonDeviceStore` Bearer, and a deterministic in-process AI provider. It does not call route handlers directly. It uses accepted shared schemas by bundling this checkout's source; installed dependencies are read from the desktop worktree, with `@fractal/shared` explicitly aliased to this accepted checkout. No provider CLI, outside acquisition, real pairing token or user store is used.

[http-evidence.json](http-evidence.json) and [http-probe.log](http-probe.log) separately label HTTP passes, reproduced defects, and wire observations. Passed cases include:

- Metadata publication: 201 `{data:LibraryRecord}`; metadata-only layout: 200 `{data:{status:'unavailable',reason:'no_pdf',...}}`.
- Paired publication PDF link: 201 `{data:{paperKey,paper,record,hasPdf}}`; same-byte relink is idempotent; different-byte relink returns 409 `SOURCE_CHANGED`; original bytes/SHA and `sourceKind:'publication'`/catalogKey persist.
- Reader snapshot: `{data:{paper,blocks,translations,job}}`; one-page layout: `{data:PdfTextLayout}`, no `layout` wrapper; `page=0` returns 400, page 6 of 5 gives 200 unavailable. Physical page and block ordinal remain distinct.
- PDF: raw bytes, quoted SHA ETag; Android RangePlan `bytes=17-` + matching If-Range gives 206 exact suffix; stale If-Range gives 200 full replace; full-length partial gives 416; If-None-Match gives 304. All body comparisons passed.
- SyncEngine-shaped batch: `{annotations:[],folders:[{id,baseRev,requestId,deviceId,patch}],papers:[{paperKey,baseRev,requestId,deviceId,patch}],history:[]}`. Folder is created before paper membership in the same batch. Response is `{data:{results,metadataResults,cursor,serverHead}}`; metadata results contain `kind,id,applied,conflict,rev,current`.
- Retry uses exactly the same requestId and payload; receipt/result remains unchanged. Stale CAS returns `applied:false,conflict:true,current:<authority>` inside HTTP 200, not an HTTP conflict. Reusing requestId with changed payload returns 400. A rebase must use a **new** requestId; push's head cursor does not replace the consumer pull cursor.
- Android memo wire passes and retains the exact input displayed rectangle. Folder removal clears membership and retains PDF/cache/annotations.
- `/ask`: 200 `text/event-stream` with delta/done/error event JSON; each durable event includes `historyId`, terminal done contains `answer`. `/explain` stores physical page 3, bbox as `context.rect`, `explanationKind:'equation'`, quote as `selectedText`, answer, and `latex:'x=1'`.
- List history routes: `/api/papers/:key/history` or `/api/library/history` → `{data:{history:[...]}}`; optional kind/status filtering. Item GET → `{data:{history:entry}}`. Error envelope is `{error:AppError}`.
- Same generation requestId + same paper/kind/question/context replays the existing history with zero extra provider calls; changed question/context is rejected. A restart-failed request replay remains failed: use a new requestId for an intentional new generation attempt.
- Real HTTP observer connection aborted after the admitted event: durable entry stayed running, then completed when the fixture provider was released. Panel close/disconnect detaches observation; it is **not** cancellation. Accepted transport still consumes generation after the observer disconnects; no network reconnect/UI delivery behavior is certified.
- Explicit `POST .../history/:id/cancel` returns `{data:{history:<canceled>}}`, aborts active generation, and prevents late overwrites. Canceled replay can contain only persisted delta then EOF; determine canceled status by history GET rather than assuming every stream ends in a done/error event.
- Remote replacement of a currently running history row returns HTTP 200 CAS conflict/current even when baseRev matches. Settled question/explanation history import succeeds with exact rev and a new receipt. Active generation remains Hub-owned; legacy `kind:'conversation'` writes remain `/chat`-owned (source-inspected rejection; no separate legacy chat run here).
- DELETE history returns a tombstone in `data.history`; subsequent item GET returns 404. Pull includes history/tombstone changes for synchronization. Closing a panel is not DELETE.
- Reopen SQLite with a persisted running crash-prefix row: recovery settles it failed/NETWORK, retains text, and same-id POST replays without new provider work. This simulates the persisted crash state; no actual process crash or other worker restart was induced. Settled question history and positions survive reopen. The cache route returned matching SHA/version after restart; this independent probe did not instrument extractor-call count.

Source lifecycle inspected: `ai/history.ts` owns detached flights keyed by store; `cancelHistory` settles before aborting; late events consult durable terminal/deleted state; `stopHistory` fails admitted work on shutdown; SqlitePaperStore constructor recovers pending/running rows. `metadata-sync.ts` protects active history and identity. Android accepted `SseParser` decodes delta/done/error text but does not expose `historyId`; SidePanel owns only a transient answer and has no requestId/history reconnection UI. Those are accepted foundation limitations to be implemented by D, not claims that D WIP failed.

## Primary native API evidence

Checked current official Android documentation on 2026-10-01:

- [PdfRenderer.Page.selectContent](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer.Page#selectContent(android.graphics.pdf.models.selection.SelectionBoundary,%20android.graphics.pdf.models.selection.SelectionBoundary)): API35; point or text-index boundaries; same point selects a word; empty selection can be null; long-running work should use a worker thread. The accepted app guards `SDK_INT<35`; no API35 fixture was executed.
- [SelectionBoundary](https://developer.android.com/reference/android/graphics/pdf/models/selection/SelectionBoundary): points are measured in 1/72-inch units with origin at page top-left; indexes belong to the native processed text stream. This does not establish equality with B's PDF.js text/order/UTF-16 boundaries or resolve native intrinsic-rotation/crop behavior.

Native stop-index documentation differs between Page.selectContent's parameter description and PageSelection.getStop's wording, further supporting independent B range provenance rather than importing native stream endpoints. Rotated/cropped API35 behavior remains an explicit native gate. No unsupported native fact is promoted from source inference to executed evidence.

## Commands, outcomes and remaining scope

Run from this isolated checkout:

```powershell
node docs/implementation/qa/reader-prerequisite/build-probe.mjs
node docs/implementation/qa/reader-prerequisite/probe.bundle.mjs
python -X utf8 packages/hub/test/fixtures/verify-text-layout.py docs/implementation/qa/reader-prerequisite/layouts.json docs/implementation/qa/reader-prerequisite/rendered
```

Both final Node commands exited 0; the Python command exited 0 and its six selection checks passed. Initial harness attempts were corrected for Windows ESM `file:` imports and PDF.js6 loading-task destruction before the successful HTTP run; these were QA harness errors, not production defects. No full existing suite or redundant owner suite was run.

The coordinator subsequently authorized a separate disposable real Android bridge, then explicitly deferred its execution to a new dispatch (`msg_2edc39b56eb1`) so B can implement contract/fixes first. Preparation retained:

```powershell
python docs/implementation/qa/reader-prerequisite/prepare-android.py
$env:JAVA_HOME='C:/Program Files/Java/jdk-17.0.2'
$env:ANDROID_HOME='C:/Users/Home/AppData/Local/Android/Sdk'
./docs/implementation/qa/reader-prerequisite/runtime/android-snapshot/apps/android/gradlew.bat -p docs/implementation/qa/reader-prerequisite/runtime/android-snapshot/apps/android :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon '--max-workers=2' --console=plain
node docs/implementation/qa/reader-prerequisite/probe.bundle.mjs --bridge
```

Copied project uses `git archive HEAD apps/android packages/shared/tokens`, preserving accepted source and adding only [HubHttpBridgeTest.kt](HubHttpBridgeTest.kt) from owned QA. [android-build.log](android-build.log): BUILD SUCCESSFUL in 1m 6s, 161 tasks; no APK installed, no instrumentation executed, no actual Android HTTP bridge pass. An initial PowerShell unquoted `-Dorg.gradle.workers.max=2` invocation failed argument parsing before compilation; corrected command above passed.

Prepared owned processes at dispatch settlement: emulator launcher PID **6888**, read-only `Pixel_2_API_34`, **emulator-5560**, console/adb ports **5560/5561**, 1536MB/2 cores/software GPU/no window/no snapshots; last explicit adb check was **offline**. Own isolated Hub PID **12052**, **127.0.0.1:6174**, store under ignored QA `runtime/http-*`; it waits for ignored `runtime/bridge-stop` marker. Disposable connection details remain only in ignored `runtime/bridge-private.json` and are never printed/committed. The completed Gradle build did not install anything. Emulator startup attempted its own generic `adb -e` screen-timeout command, which failed with “more than one emulator”; no successful cross-device command occurred. Every agent-issued adb command targeted emulator-5560. Neither D's emulator-5554, worker sources, previews nor servers were operated.

The next explicitly scoped dispatch may execute the prepared bridge after checking those process/device states. Still open: real MainActivity/OkHttp/Room→Hub integration, API29/34 offline B drag/range selection and cache invalidation, API35 native cropped/rotated behavior, final integrated C/D UX, and **physical Galaxy Tab/S Pen/palm/hover/latency plus finger-first→sole-stylus mixed-input cancellation boundary**. The latter cannot be certified by an emulator. This review supplies prerequisites and routes H1/H2/R1 to their owners; it does not resolve those gates.

Coordinator checkpoint receipts: `msg_d4a8d5881e8f` (coordinate convention), `msg_0077d08a2e5d` (executed HTTP defects/math), `msg_fe638abeb317` (owned processes), `msg_5ff86331c8e7` (revised scope ACK). Exact-terminal deliveries `delivery_c42dfa0d40cd`, `delivery_3d32298c4a59`, `delivery_6bdb7885e61c` were checked, processed and acknowledged before settlement.
