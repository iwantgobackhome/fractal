# Independent native Android HTTP bridge QA

**Scoped bridge passed; no production interoperability defect reproduced.** The
final installed instrumentation executed the real accepted MainActivity,
HubClient/OkHttp, Room, MetadataStore, PdfDownloader/PdfPages and SyncEngine against
a newly built isolated real Hub. [Final instrumentation](evidence/instrumentation-6.log)
reports `OK (1 test)`, 6.281 seconds, test status 0. Android's final
`INSTRUMENTATION_CODE: -1` is the normal runner completion value here.

Run `run_7b1cfd9aece2`, task `task_45a79ee7c0e5`, dispatch `ctx_15e644efb575`.
Requests 1–13 only; request 14 is excluded. E changed only QA documentation and
harness/evidence files under `docs/implementation/qa/**`; no production edits or
self merge. This is the accepted **stage2 foundation bridge**, not stage3 UX
certification.

## Exact source, builds and device

- Accepted checkout and isolated Hub source:
  `56230ad52493bff69f6905cd87caaa5a6743b8b2`.
  It includes Android stage2 `fd2c836`/root `2d6ba7f`, prerequisite `6c2b1c9`,
  and B original-coordinate/upload/page-validation correction
  `5dad1b3af05ca0ee979af358b8b0c67d25170fdc`.
- Android source was freshly archived into ignored `runtime/android-snapshot`.
  After execution, **118 accepted tracked files byte-matched** a new archive;
  the only added Android source was this QA [instrumentation](HubHttpBridgeTest.kt).
  No peer reader WIP or APK was used.
- Installed app APK SHA256:
  `bfb9d931a08e37dc7772206e7039d681b527fb76c161e3697ef8746b7c168d34`.
- Final installed test APK SHA256:
  `f04b45fc22ce112db8193c3ba14f8c898bf54b3712697a672be9fd07f1010f3f`.
- Hub QA bundle SHA256:
  `30c73b5c66d3ee4556e7aa0c7bc9abcb9fdec5962f5f4cedfab76a4130221fa4`.
  [Builder](build.mjs) bundles this checkout's production source and explicitly
  aliases `@fractal/shared` to it. Installed dependency modules are read from
  the prior dependency location; no peer application build/source is operated.
- Actual device: **emulator-5560**, read-only `Pixel_2_API_34`, **API34**,
  WHPX, software GPU, 1536MB/two cores, no snapshots/window/audio. Every
  agent-issued adb command specified `-s emulator-5560`.
- Device reverses during execution: `tcp:6174 → tcp:6174` real API proxy and
  `tcp:6175 → tcp:6175` QA controls. The proxy forwards to the real accepted
  `createApiServer` on loopback port3288; it does not mock production responses.

[Identity and source-match evidence](evidence/identity.json),
[initial build](evidence/android-build.log), [final test rebuild](evidence/android-rebuild-5.log).
Initial app/test assembly succeeded in58s; final test rebuild succeeded in19s.
Both APKs were actually installed on5560 before the successful run.

## Executed acceptance

| Expected behavior | Actual native/HTTP evidence |
| --- | --- |
| Bearer pull projects authoritative metadata into Room. | Real HubClient pull loaded `qa-reader-catalog` and its expected title in Room. |
| Download actual PDF bytes and distinguish physical-page layout provenance from block extraction. | Native downloader's file SHA matched actual metadata and fixture bytes; snapshot contained blocks. Real page2 layout had rotation90, matching PDF hash and `pdfjs6-original-advances-v1`, separate from Paper block version. |
| Create parent/child folders before memberships through immutable CAS queue. | Real MetadataStore queues drained; Room child referenced parent; server tags and child membership matched. |
| A committed push whose response is lost must safely replay. | QA proxy consumed the real successful response then severed the E observer. OkHttp transparently retried; request `f4751d67-7903-4561-b529-a5558159083c` and its complete body were identical in both HTTP pushes. Room queue settled. |
| Stale CAS must rebase on authority with a new receipt. | Server introduced a concurrent tag after the pull snapshot. Native mutation `958fde2d-9fcf-4efe-9904-718baf93ce83`, base22, conflicted; SyncEngine created `4f94fd8c-07cb-49e9-b02a-70e82cf1a298`, base23. Both local and remote tags survived and queue drained. |
| Offline unsave/read retains Recent and never saves as a side effect. | Credentials temporarily pointed only this app at unavailable `http://127.0.0.1:1`. Failed sync was observed; queued unsave/read remained in Room. Actual MainActivity Recent navigation opened the cached PDF; a new native read event retained `saved:false`. |
| Actual cached PDF opens with endpoint unavailable. | [Native screenshot](evidence/offline-cached-reader.png) shows physical-page2's vertically rotated `Rotated crop WWW iii` rendered by Android. PdfPages opening also emitted the durable read event; this is actual APK execution, not source-only inference. |
| Reconnect settles queued work without regressing a newer timestamp/page pair. | Before reconnect, server was given deterministic newer pair `2030-01-01T00:00:00.000Z`, page4/offset.75. Older offline page2 reads and unsave settled; server and Room retained that entire newer pair and `saved:false`, with zero pending mutations. |
| Parent deletion promotes child and converges membership while retaining PDF/annotation. | Both parent and child membership were first settled. Deleting parent drained the queue, promoted child to root, removed only parent membership on server and Room, retained cached PDF bytes and the newly synced native memo. |

[Native checkpoint summary](evidence/native-bridge.txt) and
[real request bodies/replays](evidence/wire.json) contain the executed evidence.
Only E fixture pushes are collected there; D requests are not claimed as E tests.
An additional [read-only server storage snapshot](evidence/server-storage-after.json)
checks actual SQLite rows and PDF bytes after native execution: parent tombstone,
live child with null parent, surviving child membership, the final native memo
with `deleted:false`, and matching retained PDF SHA. It reads no D rows or
credentials and mutates no server state.

## Room and server before/after reconnect

| State | Saved / read pair / queue |
| --- | --- |
| [Offline Room](evidence/bridge-offline.json) | `saved:false`; `lastReadAt:2026-09-30T22:23:24.646Z`; page2/offset0; three immutable paper mutations retained (unsave, earlier read, MainActivity read), base24. Server still held saved/unread authority before reconnect. |
| [Reconnected Room](evidence/bridge-reconnected.json) | `saved:false`; newer2030 timestamp + page4/offset.75; rev28; pending `[]`. |
| [After folder deletion Room](evidence/bridge-folder-deleted.json) | Same saved/read pair; surviving membership only `qa-bridge-child`; rev30; pending `[]`. |
| [Actual server after native run](evidence/server-after.json) | Matches Room's final saved/read pair and membership. Native assertions also confirmed child root promotion, PDF retention and memo retention. |

The future timestamp is an intentional ordering fixture, not a real user read.
No user dataset, account, network service or real AI provider was involved.

## Harness iterations and defect routing

All six native attempts are retained in `evidence/instrumentation-*.log`.
Attempts1–5 stopped at QA harness assumptions: requiring an error despite
OkHttp's transparent retry; supplying a non-UUID artificial memo ID; looking for
an unsaved record in default Saved; then looking for a page label that the reader
intentionally auto-hides. The diagnostic screenshot/semantics showed a correctly
opened rotated PDF while the header was hidden. These are **harness errors**, not
reported production defects. The corrected sixth attempt passed all scoped
assertions. Each retry cleared only E's installed app data; the isolated server
was retained, with fresh request IDs/memo UUIDs and authoritative pull each time.

No new expected/actual owner defect is raised from the final bridge.
Earlier H1/H2 are corrected by accepted B5dad1b3. The current harness independently
used the exact local Origin/startup-token `application/pdf` link route twice to
seed fixtures and received201. Known invalid-page admission is not redundantly
rerun: [accepted B HTTP evidence](../../backend/original-provenance-verification.md)
records page6/5 rejection before history/provider admission for ask and explain.

## D fixture and remaining gates

[Published protocol](PROTOCOL.md) gives actual base/control URLs, D fixture key,
accepted route/envelopes, ignored credentials path, model and independent flight
IDs. D has its own disposable paired device and separately extracted five-page
PDF/translated stable blocks. D alone operates5554 and may release D-prefixed
provider flights. E never operated5554, D source/builds or D flights.

An E-only [provider control smoke](evidence/provider-smoke.json) actually admitted
two delayed E flights and released them through `/E/release`: one completed,
one durably failed NETWORK. This verifies the newly published deterministic
controls, **not native stage3 lifecycle UX**. No real provider CLI is run.

The supplied Android checkpoint is stage2. Selected/figure context, observation
close/reopen/restart without cancel, explicit Cancel, durable native
history/model/context, failed-send draft retention and idempotent UI retry remain
D/final integrated QA gates; this report does not mark them present or verified.
Ordinary translated copy/quote is preserved by having no production edits;
translated coordinate anchors/request14 are excluded. No API35 selection-boundary
or cropped/rotated native text-frame equivalence was executed. API34 PDF pixels
cannot certify API35 anchors. Software mixed-input selection/cancellation was
not exercised by this HTTP bridge. Physical Galaxy Tab/S Pen/palm/hover/latency
remain unverified and cannot be certified by this emulator.

## Resource settlement and next owner

Retained earlier PID12052/PID6888 were absent on inspection;5560/5561/6174 were
free and adb5560 was not found. No stale numerical PID was killed. A fresh Hub
was rebuilt against accepted56230ad rather than reusing the pre-correction build.

Own fresh emulator launcher7644 started `2026-09-30T22:10:16.3038180Z`;
qemu45956 started `2026-09-30T22:10:16.4194700Z`, parent7644. Before cleanup,
exact executable/start/commandline/console ownership were checked. Only5560's
6174/6175 reverses were removed and `adb -s emulator-5560 emu kill` was issued.
[Cleanup evidence](evidence/cleanup.json) confirms both processes exited,
5560/5561 listeners disappeared and5560 was no longer present. No global adb
restart/kill, another device, peer server or Orca runtime was operated. Emulator
internal generic `adb -e` initialization attempts failed with multiple emulators;
agent commands remained explicitly selected.

**Hub remains running for D, with explicit root handoff at this settlement**:
root receipt `msg_be89ebafd93b`, ACK `msg_b9ca587f17c0`.
[Exact handoff identity](evidence/hub-handoff.json): standalone PID40024,
`C:\Program Files\nodejs\node.exe`, start `2026-09-30T22:10:16.2834590Z`,
command `node.exe docs/implementation/qa/native-bridge/server.bundle.mjs`,
loopback listeners3288/6174/6175 all owned by40024. Root assumes interim lifecycle
ownership until a new independent QA dispatch takes it; do not stop while D is
active. Ignored store is `runtime/http-YYHI5c`; ignored E/D credentials remain
private. After D finishes, the verified next owner can create
`C:/Users/Home/orca/workspaces/fractal/fractal-reader-qa/docs/implementation/qa/native-bridge/runtime/stop`.
The harness then closes the real Hub, control/proxy listeners and SQLite and
writes ignored `runtime/final-state.json`. Recheck full process identity and
listener ownership before that cleanup, then verify exit/closed ports. Never
clean by a numerical PID alone.

Followups were checked at file/test checkpoints. Root ownership guidance
`msg_02957a77037e` and handoff `msg_be89ebafd93b` were processed and ACKed before
settlement. D folder allowance `msg_da8210e82a5e` was added to the protocol and
ACKed as `msg_e7eacad5457d`. Private E/D token bytes were checked absent from all
32 owned deliverable files;
credentials, bundles, stores and APK/runtime output remain ignored.
