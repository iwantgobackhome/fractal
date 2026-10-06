# Answer placement endpoint

Implemented in the hub only; shared contracts and UI are unchanged.

## Route and UI integration

The future UI method `hub.setAnswerPlacement(paperKey, id, placement)` should send
`PUT /api/papers/:key/history/:id/placement` with JSON `{ "placement": placement }`,
using the existing mutation authentication headers. Encode both path parameters.
The response uses the normal API envelope: `{ data: { history: HistoryEntry } }`.
The placement must contain `page`, `x`, `y`, `state`, and ISO datetime `updatedAt`,
validated by the existing shared `answerPlacementSchema`. Invalid bodies return
400; missing/deleted history and paper-key mismatch return 404.

The supplied placement clock is retained. Saving uses `putHistory`, which bumps
`rev`, advances the entry's server-side `updatedAt`, and records the ordinary
history sync change. Both history list/detail GET and sync pull return placement.
SQLite persists the complete entry as JSON; restart persistence is covered by a
real HTTP test. DELETE still removes entries from visible history and publishes
a history tombstone with their placement.

## Sync and merge behavior

Android can supply `entry.placement` in the existing sync push history mutation.
No contract changes or additional sync fields are required. `putHistory` merges
placement by its own `updatedAt`: newer wins, older is ignored, equal timestamps
favor incoming placement, and omission retains stored placement. This also
preserves placement when generation or legacy conversation mirroring rewrites an
entry. Existing `baseRev` conflicts and restrictions on running/legacy history
imports remain intact; clients must retry conflicted mutations using current rev.
Dismissal uses `state: dismissed`, rather than removing placement.

## Verification

- Built the previously missing local shared package output to run checks; no
  shared source or tracked shared files changed.
- `npm run typecheck`: passed across shared, hub, and UI.
- `npm test -w @fractal/hub`: 260 passed, 3 failed, matching the known pre-existing
  Claude usage shutdown failure and two publication cache-message assertions.
- Focused placement and foundation suites: 21 passed.
- New HTTP tests cover PUT/GET/list/pull, revision advancement, invalid bodies,
  missing ID, paper mismatch, SQLite restart, DELETE tombstone, Android push
  round-trip, placement clock ordering, equal clocks, omission, and rev conflict.

UI integration is left to its owner. No push, tags, or release actions performed.
