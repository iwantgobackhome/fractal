# Android accepted-source native validation checkpoint

Accepted backend supply: `ecaaef850166292f97680fd62d676906e4da4578`, supplied by the coordinator into clean Android `d70f615`. The backend owner source `5280a876986a4cabc8ebb6d203f7243f181c90b3` was integrated by the coordinator as `423f46726491b5fd2165d57a1f4c2f05ab3d6d94`. Android production `app/src/main` and `sync/src/main` remain byte-for-byte unchanged from that accepted supply; subsequent changes are focused QA only.

The isolated helper was built at clean QA checkpoint `e5037c4997b7db92c55f816cb56b0e57f2735177`. Its build verifies ancestry and unchanged `packages/hub` and `packages/shared` trees against the accepted supply. The sole production-source build transform changes the standalone main predicate from `if (invokedDirectly())` to `if (false && invokedDirectly())`, preventing imported main from starting a default user Hub; exported acquisition/API implementations remain intact. No standalone user Hub was launched.

Ordinary MainActivity native tests use real Hub HTTP, Room, SyncEngine, PdfDownloader, PdfCache and the original reader. The cached index provides controlled bibliographic entry points, with the exact user paper's title/authors/date grounded in its actual arXiv citation metadata. Live success acquisition uses the accepted backend's default public network, with no PDF seeding, response replacement or `setContent` fake UI. A separate real Hub handler controls only outbound login HTML for its named error case; the QA proxy separately controls bare old-Hub 404, offline response and delayed response delivery.

| Gate | Observed result |
| --- | --- |
| Live unbookmarked JMLR publication with no reported PDF URL | MainActivity Read opens the original PDF; 42,310 bytes, SHA-256 `1c338a6b3c6c1dcafda3990a8098b8b50dd6c77616361396fb75f6822c6e0778`, matching the independent publisher download and real Hub bytes. Unsaved remains unsaved; Recent appears only through actual reader entry. Cached offline recreation passes. |
| Saved metadata-only JMLR Dropout publication | Actual acquisition preserves canonical key, saved=true, tags, nested folder parent/membership, complete memo body/quote, cached completed history and reader position. |
| Exact user `https://arxiv.org/abs/2609.40325v1` | Actual page and versioned PDF return HTTP 200. Reported title: WorldAuditBench: Interactive 3D World Auditing with Multimodal Agents. MainActivity Read opens the original 45-page PDF, remains unsaved, enters Recent through the reader and recreates offline. Native gate passes in 18.67 seconds; 49,668,700 bytes, SHA-256 `d9fdc657534201a7e1df44080ae52fb1c168b791b56581ebf2ddf35d0b087901`, matching the independent exact-v1 download. |
| Actual delayed HTTP, same Hub but changed device/account | Captured credentials reject late response; no local admission, download or navigation. |
| Actual delayed HTTP, superseded request | Request guard rejects late response with no local effects. |
| Actual delayed HTTP with concurrent local edits | Save, tags, nested membership and memo edits remain projected and dirty; queued intent remains byte-for-byte intact, and acquisition does not add Recent. |
| Controlled old Hub / login HTML | Retry and reason plus explicit publication/PDF/manual-file fallbacks are visible; no automatic browser navigation, reader event or Save. |
| Phone 360 dp / font scale 2 | Focused native action, live progress, retry and fallback captures show wrapping within the dossier's scrollable layout. Read remains a separate primary action; manual link/source actions remain explicit. |
| Focused Room tests | Five tests pass, including canonical unsaved admission, stale scope/request, concurrent dirty preservation, bare old-Hub versus structured 404 reason, malformed/no-PDF/mismatched-key/changed-hash rejection before admission. |
| Build / unit tests | Debug application and test APK build; app/sync/data unit checks pass. |

Evidence: `native-public-publisher.log`, `native-preservation-errors-scope.log`, `native-exact-user-arxiv.log`, `native-font2-progress-fallback-current.log`, `native-observations.log`, `http-state.json`, and `screens/phone360*/`. Renderer diagnostic lines emitted to stderr by SwiftShader appear alongside passing instrumentation results; no AndroidRuntime crash was observed.

Owned native resource: API34 `emulator-5562`, read-only headless Pixel_2_API_34; launcher PID 45404 and QEMU child PID 39892. Owned hidden helper: Node PID 52260, started `2026-10-01T05:34:14.949Z`; external listeners 6284/6285, internal real Hub listeners 10373/10374, private storage under ignored `apps/android/qa/pdf-acquisition/data/hub`. Only 6284/6285 reverses belong to this worker. Exact executable/process creation/command/listener receipts are retained in ignored local data and will be exported without credentials for cleanup accounting.

This checkpoint precedes final APK freeze and resource cleanup; it does not relabel a preliminary APK as final. No physical S Pen verification is claimed, and accepted original finger/translated-copy/pen/history code was not redesigned. Request14 remains excluded.
