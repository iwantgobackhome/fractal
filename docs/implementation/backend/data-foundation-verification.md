# Data foundation verification

Backend owner B completed the foundation stage for supervised run `run_7b1cfd9aece2`, task `task_aa0dad1fb29c`. Scope is shared contracts, hub persistence/API/sync and backend integration documentation. No desktop/Android/UI implementation, discovery-provider overhaul, related-service overhaul, or translated/original annotation mapping is included.

Implemented explicit saved versus recent/read-progress state; nested folders with multiple membership/tags; persistent question/explanation and legacy conversation history; explicit history list/detail/cancel/delete; stream disconnection independence; revision-checked metadata sync with conflict records, durable retry receipts and tombstones; backward-compatible memo appearance; metadata-only publication and safe same-reader-identity acquisition.

Integration types, routes, event fields, timestamp/progress units, migration decisions and client checkpoint obligations are in [data-foundation.md](data-foundation.md). A concrete, unimplemented positional-PDF-text extraction task for Android API29–34 is in [pdf-text-selection-followup.md](pdf-text-selection-followup.md). Discovery catalog-to-reader association remains a later dispatch: mismatched identities are rejected before creating unrelated duplicates, and existing reader identity validation is preserved.

## Commands and results

Executed in this worktree on 2026-10-01 (Korea time):

| Command | Actual result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Installed the initially missing dependencies; no dependency manifests or lockfile changed. |
| `npm run build -w @fractal/shared` | Passed. |
| `npm run typecheck -w @fractal/shared` | Passed. |
| `npm run typecheck -w @fractal/hub` | Passed. |
| `npm run test -w @fractal/shared` | Passed: 2 test files, 5 tests. |
| `npm run test -w @fractal/hub` | Passed: 22 test files, 125 tests. |
| `npm run test -w @fractal/hub -- src/store/foundation.test.ts` | Passed: 18 foundation tests, including guarded real HTTP disconnect/cancellation. |
| `npm run test -w @fractal/hub -- src/library/core.test.ts` | Passed after metadata-only acquisition changes; full hub run includes 13 current core tests. |
| `git diff --check` | Passed. |

The initial test run identified three existing tests with hardcoded migration counts through version 10; these expectations were updated to include migration 11. No runtime test failure remains. Tests use injected providers/network and do not require real AI accounts or external catalog services.

The coordinator separately reported `npm.cmd run typecheck -w @fractal/ui` passed against this worktree's newly built shared contracts, confirming existing desktop type compatibility; owner B did not edit UI files.

## Regression evidence

The real pre-foundation SQLite DDL in `packages/hub/src/store/fixtures/sqlite-v10.sql` creates an old-schema database directly, without invoking the new store constructor or stripping columns from a new schema. Tests populate old bibliography edits, folders/memberships/tags, conversations, annotations, blocks, translations, jobs and legacy highlights, plus an actual PDF fixture in the old content-addressed blob layout. Migration preserves the old PDF bytes and all old records while adding saved=true, savedAt=addedAt, null lastReadAt/progress, root parents and copied history. A deliberately failing change-log trigger proves migration DDL and metadata roll back together; reopening proves migration runs once.

Ingestion and metadata-only acquisition tests prove new ingest is unsaved/unread, reading populates recent/progress without saving, explicit unsave retains PDF and all other data, and same-key metadata acquisition keeps saved state/tags/folders. A mismatched catalog identity fails before an unrelated reader record is created.

Folder tests prove nested membership, cycle/self-cycle/missing-parent rejection, omitted-parent rename compatibility, child promotion on interior/root deletion, paper retention, tombstone propagation, ID non-reuse and transactional rollback.

History tests prove durable admission before generation, partial/error/completed/canceled states, client iterator closure/reopen and process restart, exact request replay without regeneration, request-ID mismatch rejection, explicit filtered APIs, tombstone synchronization, and old active conversation progress/clear/restart compatibility. A real guarded HTTP SSE test closes the client's response stream, observes continued generation, replays its completed result without another provider call, then separately invokes the history cancellation API and verifies the provider signal is aborted while partial text remains.

Sync tests prove stale offline saved/progress edits return current data and can be rebased; receipts survive restart; repeated requests do not advance revisions/cursor; conflicting reused IDs are rejected; folder/history tombstones cannot be resurrected by stale edits; annotation-only payloads and old non-strict pull decoders remain compatible; metadata write/change/receipt rollback is atomic. Concurrent remote annotations between a pull and push remain available from the consumed pull cursor, demonstrating why D must never advance its checkpoint from push serverHead/cursor. Explicit hard paper deletion publishes annotation/history tombstones and deletedPapers.

Remaining integration work belongs to C/D: use saved/recent views, bind panels to historyId, close without cancel/delete, support folder hierarchy/membership and sticky fields, implement Android Room migration and durable offline metadata queues/rebasing, and advance checkpoints only from durably consumed pulls. The coordinator owns review/merge and the next discovery/reliability dispatch.
