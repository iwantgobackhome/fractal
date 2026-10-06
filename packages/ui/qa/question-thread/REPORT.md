# Desktop question thread redesign

Implemented in `packages/ui` only, on `iwantgobackhome/q-thread-ui`.

The dock now resizes with a left-edge pointer handle, arrow keys (20px steps), and double-click/Home reset. Width clamps to 300px–60% of the window and persists with guarded localStorage access; the existing desktop flex layout reflows the reader.

The current thread is independent of the draft. Every ask/explain request sends its threadId, successful submission immediately clears the composer and attachment, and editing text/model or removing the chip preserves previous turns. Failed submissions restore the unsent draft when the user has not changed it. Retry creates another turn and preserves an unrelated draft. New Question and opening a History thread are the only actions that change the selected conversation. Legacy entries group with follow-ups sent using their entry ID. History groups threads with first-question title, count, date, and retained filters/search.

Quoted passages use a one-message attachment chip, become collapsible attachments inside user turns, and clear after sending. Passage Ask opens the existing floating surface with the chip and focused input, without auto-sending. Structural Explain opens the dock and submits into its current thread. Floating surfaces have an independent UUID per session and share the conversation/composer implementation. The dock persists threadId, unsent text, attachment, and model per paper.

Answer language comes exclusively from the Settings preference. Settings includes a collapsed, validated custom BCP47 field. Coordinates and verbose physical-page labels are replaced with p.N links; source status displays only actual problems. Answer actions are compact buttons shown on hover/focus, and settled turns have no routine status line.

## Validation

- `npm run typecheck`: passed across shared, hub, and UI.
- `npm test -w @fractal/ui`: passed, 74 tests in 18 files. Nine added tests cover grouping/legacy continuation, draft retention/clearing, width clamps, and plain thread requests with optional Settings language.
- `npm run build -w @fractal/ui`: passed.
- `git diff --check`: passed.
- `npm run e2e`: could not launch because `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` is absent.
- Started the hub and UI dev servers with `npm run dev` (7327 and 5173), then stopped them after validation.
- Chrome fallback: `npx tsx packages/ui/scripts/question-thread-qa.ts` passed. It uses the real API server with the existing fake-provider/PDF fixture and exercises two sends, clearing, persisted draft restoration, chip removal, input editing, pointer/keyboard resizing and reset, grouped History/open, New Question, passage popup focus/attachment/send/follow-up, and custom Settings language.

The fallback decorates returned history context with threadId captured from the actual outgoing request because this isolated UI branch does not contain the parallel hub persistence patch. This proves UI behavior and outgoing thread IDs; it does not prove the hub supplies earlier turns to the model. The fake provider's canned English response is fixture content, not a claim that language preference is ignored.

## Screenshots

- [Two retained turns plus restored unsent chip](thread-with-chip.png)
- [Wider panel with reflowed reader](resized-panel.png)
- [Settings answer language and custom BCP47 field](settings-answer-language.png)

## Integration notes

Integrate the parallel hub thread persistence/context worker before production use. The root `scripts/e2e.ts` still assumes passage Ask immediately generates an answer and uses the old status markup; its expectations need updating outside this worker's UI-only ownership. The committed UI-specific Chrome fallback reflects the approved interaction.
