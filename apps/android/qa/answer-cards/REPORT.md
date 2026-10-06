# Android persistent page answer cards

Implemented on `iwantgobackhome/cards-android`, based on `feature/answer-cards-licenses` and shared placement contract `dbfe0fd`.

Cards render inside the physical PDF page overlay, with a 320dp maximum width and positions clamped using measured card dimensions. Every new Ask or Explain creates an independent thread; follow-ups keep that card’s thread. Older cards remain mounted or restore from history, and newer cards render above older ones when positions overlap.

Placement is normalized page coordinates and persists on drag end after a 250ms debounce. Open, collapsed, and dismissed states are retained on the thread root (named root first, oldest turn otherwise). A collapsed card is a single question/explanation marker at its card position. Delete requires confirmation, dismisses only the card and marker, and keeps the conversation available in History; opening History restores the card.

Placement edits use the existing metadata mutation queue with baseRev. The queue retains placement-only intent; the push envelope merges it over the full pulled history JSON, preserving context, answer, conversation, and required contract fields. Placement projection and conflict rebases use updatedAt last-writer-wins. Durable local reader intents bridge moves made before history attachment; both history refresh and sync pull reconcile them without requiring a mounted reader card.

Source overlays remain mounted to preserve input continuity and draw translucent accent highlights during presses, dragging, and field focus. Retained text quads survive local JSON serialization; original-text layout provenance can recover remote quads, with rotated rectangles as fallback for region/figure/equation/table sources.

## Verification

- Required Gradle unit/build targets pass with the specified JDK 17 and Android SDK: data 23 tests, app 24 tests, sync 12 tests; zero failures/errors.
- `:app:assembleDebugAndroidTest` passes.
- Direct instrumentation on **Galaxy_23_API_34 / emulator-5556**: ReaderAnswerCardTest and ReaderHistoryRepositoryTest, **5 tests passed**.
- Checks cover drag continuation, drag source highlight, page scrolling, second explanation retaining the first answer, collapse/expand, focused source highlight, confirmation-based dismissal, marker removal, root placement mutation, reopening from History, retained thread follow-ups, offline request replay, and pre-attachment placement reconciliation with a full history sync envelope.
- `git diff --check` passes.
- emulator-5554 was never cleared, unpaired, installed to, or otherwise targeted.

## Evidence

- [Build log](build.log)
- [Instrumentation log](instrumented.log)
- [Card follows page scroll](01-page-scroll.png)
- [Focused source highlight](02-source-highlight.png)
- [Two retained cards](03-two-cards.png)
- [Dismissed card](04-deleted.png)
- [Reopened from History](05-reopened-from-history.png)
- [Source highlighted during drag](06-drag-source-highlight.png)

The interaction fixtures are intentionally isolated and unpaired, with retained answer records and simulated sync responses. Live cross-device hub synchronization was not exercised against the user’s paired emulator; the full-record placement wire path is covered by unit and Room-backed instrumentation tests.
