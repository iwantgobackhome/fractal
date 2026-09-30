# Authorized narrow Hub shutdown correction

E dispatch `ctx_168bc27d144c`; source base `3a2cf10617b85dbbbf74aea25b810730175448cc`. Root explicitly extended production ownership in message `msg_5e8263e88d26` to `packages/hub/src/structure/service.ts`, shutdown wiring and focused regression tests/docs. This correction is separate from final platform certification and does not alter the retained D QA Hub.

## Concrete defect and correction

**P1 lifecycle defect, backend owner B/root integration.** Upload a PDF through actual `POST /api/papers/upload`, leave its scheduled structure detector pending, immediately call the embedding Hub's `stop()`, then let the detector reject. Expected: clean bounded shutdown, no late SQLite access/rejection, stored PDF retained and unfinished extraction recoverable. Accepted pre-fix source instead produces an unhandled `Error: database is not open`: `StructureService.schedule`'s catch queries `getPaper` after service shutdown closed SQLite. Late successful detection, source-fetch/cache and reference enrichment can also write after shutdown.

`reproduce-shutdown-baseline.mjs` executed that real HTTP path in a fresh E-only disposable Hub using accepted pre-fix service/API source from git. `shutdown-evidence/baseline.json` records the observed exception without credentials. The reproduction listener deliberately captures that expected baseline rejection; it does not suppress exceptions in the corrected tests. Generated bundles, disposable SQLite and PDFs remain ignored.

The API server now calls `structure.stop()` at the beginning of close, before the embedding service reaches `store.db.close()`. Structure stop is idempotent, marks the service closed, detaches only its own block callback and aborts its fetch signal while retaining existing caller timeouts. It declines new work and checks closure before the scheduled first turn, after each asynchronous detector/source/enrichment continuation and before the error handler touches SQLite. Late results are discarded even when an injected detector/fetcher ignores abort. It does not await an uncooperative external job. Rows left running remain recoverable: the next StructureService constructor resets them to pending, with PDF/user data unchanged.

## Meaningful verification

| Command | Result |
| --- | --- |
| `node docs/implementation/qa/integrated/reproduce-shutdown-baseline.mjs` | Expected pre-fix closed-SQLite unhandled rejection reproduced after actual HTTP 201 upload and immediate stop; isolated service closed |
| `npm test -w @fractal/hub -- src/structure/shutdown.test.ts src/structure/structure.test.ts src/api/provenance.test.ts` | 25 passed: initial six shutdown regressions, nine structure tests and ten actual HTTP provenance tests |
| `npm test -w @fractal/hub -- src/structure/shutdown.test.ts` | Final seven passed after adding enrichment failure/fallback case |
| `npm run build -w @fractal/hub` | Final TypeScript check and Hub bundle passed |

The seven final shutdown cases cover pre-turn cancellation, late detector success and rejection, a source fetch that returns after abort, enrichment success and failure with no new fallback request/cache write, and actual Hub HTTP PDF upload/stop while detection remains unresolved. They verify bounded stop, no unhandled continuation, retained PDF bytes and pending restart recovery. No unaffected full platform suite was repeated. Node's existing experimental SQLite warning is the only runtime advisory. Logs are normalized UTF-8 under `shutdown-evidence/`.

Retained native-QA process40024 still has executable/start/command/listeners identity documented in CHECKPOINT.md; it was not rebuilt, restarted, stopped or given these new bytes. D fixtures/devices were not operated. C must rebuild its current package after root accepts this correction. Final C/D source and package/APK certification remain pending.
