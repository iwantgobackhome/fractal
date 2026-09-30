# Independent integrated QA checkpoint — final dependencies pending

Run `run_7b1cfd9aece2`; E task `task_e12b7180f532`, dispatch `ctx_168bc27d144c`. Reviewed 2026-10-01 Asia/Seoul. Accepted source is `3a2cf10617b85dbbbf74aea25b810730175448cc`; baseline is `fbf0a12d234adbc6b67fcb70092a751ae8861d9e`. This is a preparation checkpoint, **not final product certification**. Requests 1–13 remain the target; request 14 is excluded. No production files were changed.

## Executed on this accepted source

`npm ci --no-audit --no-fund` and `npm run desktop:build` passed in this worktree. The latter builds shared contracts, the Vite UI, Hub and desktop bundle, including the package TypeScript checks; it does not prove a current Windows installer. The build emitted a Vite large-chunk advisory. Execution emitted Node's existing experimental SQLite warning.

`npx tsx docs/implementation/qa/integrated/current-desktop-check.ts` passed against fresh disposable SQLite and a fresh headless Edge session. AI completion alone is a deterministic boundary; accepted built UI, PDF.js, actual HTTP/SSE and real SQLite execute. No remote acquisition or user account was used. The script's service/browser closed, and its process exited 0. See `checkpoint-evidence/current-desktop.json`, the three settled PNG captures, and normalized command logs. The fixture is a five-page geometry PDF, not evidence of dense scholarly page presentation.

| Narrow assertion | Actual observation |
| --- | --- |
| Empty saved library | English empty index with zero SQLite library rows; no horizontal document overflow at 1440×900 |
| Original partial pointer selection | Physical page 1, actual pointer drag selects `WW iii` within `WWW iii wide thin` |
| Observation close versus cancellation | Close leaves the same history entry running; delayed completion settles it; reopen displays the same completed question, page and quote |
| Durable answer/model | SQLite contains the completed text, model, request ID and page-only citation; current older C context is untagged, so `contextSourceStatus: unknown` is expected, not proof of final grounding |
| Keyboard | Escape from a control inside the research panel hides the retained component |
| Typography/layout | Long scholarly title uses Source Serif 4/Noto Serif KR stack; long custom model label wraps legibly in the question panel; settled 1440×900 light and 1280×800 sepia captures have no document overflow |

Initial preparation attempts exposed QA fixture errors (invalid noncanonical publication identity, preference-loading race), PDF relayout timing and a mistaken detached-versus-hidden assertion. These were corrected in the owned script, not routed as production defects. The final capture waits for the drawer transition. No concrete new production defect has been established on this checkpoint.

## Accepted evidence reviewed, without repeating unaffected suites

Reviewed root `orchestration.md`, `review/request-acceptance.md`, `review-risks.md`, baseline QA, design handoff/tokens/accessibility, C stage1/stage2 reports and representative captures, B discovery/provenance reports and actual route/store validation, D interaction/foundation reports and enlarged-font phone capture, and E native bridge report. The production diff from baseline spans 187 files under apps/packages; this checkpoint's execution deliberately covers the old C/new B consumer boundary rather than claiming a line-by-line audit or running every owner suite.

| Requests / integration risk | Accepted evidence | Remaining final verification |
| --- | --- | --- |
| 1, 4, 6: scholarly UI, selectors, keyboard, themes | A design; C stage1/stage2 rendered matrices and packaged startup/icon resources; D stage2 library font/focus/48dp checks; E narrow actual render above | Current C final discovery/render/package; current D reader/discovery APK, phone 360 at 200% essential controls and full title access |
| 2: durable selected/figure questions, detach/cancel/history/model/language | B immutable request/history/citation contracts; C stage2 real lifecycle; E current close-complete-reopen | Final C/D tagged source/hash/frame/legal UTF16 ranges, per-question BCP47/auto persistence, restart/pull/citations, draft retention and same-ID retry; unavailable explicit model cannot silently fall back |
| 3: migrations, Recent/save/folders/tags/offline | B real SQLite v10→13 migration retention; D real Room v1 retention; E accepted native bridge Room/OkHttp/SyncEngine proof | Final consumer convergence: older events preserve timestamp/progress pair; local/remote folder deletion and rename conflict preserve audit and independent save/tags, avoid resurrection/retry loops |
| 5, 7, 13: taxonomy, news, related/source status | B discovery 166 Hub tests and 10 shared tests; actual catalog identity, incidental DOI, empty-cache fallback, bounded timeout/429 and source error/cache contracts | C final/D discovery current presentation, title/identifier collision projection, unknown/OA honesty, useful cached rows with provider/errorCode/retryAt and navigation |
| 8, 10, 11, 12: pen, original/translation, memos, split | D routed stability prerequisite; C actual partial/backwards/Unicode/rotated/cross-page selection; E accepted native PDF SHA/page2 layout/offline cached PDF and memo retention | D accepted reader actual selected legal ranges, expanded sticky body/edit/color/collapse, original/translation mapping/cache, max-zoom vector/derived cache stability; ordinary translated copy/quote stays in scope |
| 9: Android icon | Accepted D stage2 adaptive/legacy/round resource evidence | Current final APK source/hash/resources and independently observed installation where feasible |

B provenance report supplies 55 focused tests, including 10 real HTTP fixtures, PDF hash/frame/page/extraction-version/UTF16 admission and historical JSON semantics. These contract checks are strong backend evidence but cannot certify a consumer sends the final fields. Likewise, the earlier E bridge on accepted `56230ad` verifies actual Bearer pull, PDF bytes, folder CAS/replay/rebase, offline unsave/Recent cached PDF and reconnect deletion promotion, but cannot certify later Android reader/discovery UX.

## Final gates held for accepted owner checkpoints

Root must supply accepted C final and D reader/discovery source before final platform certification. Root's staged gates include C publication alias/minimum-title/conflicting-ID projection and retrying transient unavailable provenance on reconnect with localized durable labels. D gates include phone essential tools at 360/200%, full scholarly title access, expanded sticky editor/body/color/collapse, stale tagged thumbnail hash/frame rejection without losing notes/quotes/drafts, localized history/context labels, explicit unavailable model handling, and bounded derived dry-cache at maximum tablet zoom. Current D execution updates reported by root are informative but are not accepted source evidence yet.

Final visual review should use current owner source-rich long titles/authors/venue/abstract/split/sticky captures first. Geometry-only PDF captures cannot establish scholarly information density. Final screenshots must dismiss OS clipboard overlays after separate copy proof. API35 native indices/frame remain distinct from B extraction ranges unless actually verified on an independently owned API35 device. Routed emulator mixed-input checks do not certify physical Galaxy Tab/S Pen palm/hover/latency. Installed pinned-taskbar appearance is separate from executable/installer resource proof.

## Resource custody at this checkpoint

Rechecked full retained Hub identity on this dispatch, including after the independent desktop test: PID `40024`, executable `C:\Program Files\nodejs\node.exe`, start UTC `2026-09-30T22:10:16.2834590Z`, command `"C:\Program Files\nodejs\node.exe" docs/implementation/qa/native-bridge/server.bundle.mjs`, loopback listeners 3288/6174/6175 all owned by that process. Its actual loaded production source is `56230ad52493bff69f6905cd87caaa5a6743b8b2`, bundle SHA256 `30c73b5c66d3ee4556e7aa0c7bc9abcb9fdec5962f5f4cedfab76a4130221fa4`; it was **not rebuilt from 3a2cf10**. Accepted translation-language settings repair is already applied. Private credentials remain in ignored native-bridge runtime files.

E retains lifecycle custody while D finishes its designated D fixtures/flights on its own 5554. No D data/preferences/flights or peer devices/builds were operated in this dispatch. The Hub will not be restarted/stopped during those flows. The exact ignored stop marker is `C:\Users\Home\orca\workspaces\fractal\fractal-reader-qa\docs\implementation\qa\native-bridge\runtime\stop`. Prior E emulator 5560 is stopped; ports 5560/5561 remain unbound. No Android device was operated for this checkpoint. Final settlement must document verified safe cleanup or an explicit next-owner handoff.
