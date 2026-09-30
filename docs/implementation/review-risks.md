# Coordinator review risks

## Baseline source findings to verify after implementation

- Android translation uses `block.pageOrdinal` as physical page, drops block IDs, and does not retain an offline translation snapshot.
- Android selection-to-question clears selection without passing its context; memo sidebar can omit the memo body when a quote exists.
- Pen activity changes toolbar layout height and may compete with parent scrolling. Real stylus/palm validation is required.
- Android PDF selection below API 35 returns no selection; original-PDF fallback needs offline positional data.
- Synchronization currently pulls at a cursor, pushes local annotations, then stores the push response cursor. Concurrent changes between pull and push can be skipped. New metadata/history sync must consume changes before advancing its pull checkpoint.
- Metadata revision conflicts need actionable current values and safe client retry/merge; they must not silently discard offline saved/folder/progress edits.
- Closing a question/explanation panel differs from explicit cancellation. Persist request and final/interrupted status; reconnect or restart must retain history.

These are review gates, not claims of completed fixes or device verification.

## Concrete integration findings

- PC original PDF availability must be separate from extraction/translation eligibility. Existing ready/partial-only reader gating hides valid scanned/unsupported source PDFs. Reader stage explicitly requires image-only original PDF evidence and region fallback.
- A winning read event must preserve both `lastReadAt` and `readProgress`. Retaining a newer timestamp with an older page is inconsistent. Android client and hub owners received paired-event regression requirements; intentional progress-only edits remain compatible.
- Android immutable metadata queues must converge after local and remote folder deletion. Removing tombstoned membership from the UI projection alone leaves a stale queued patch that can permanently fail the real hub's active-folder validation. Preserve surviving tags/save/memberships and exact immutable receipts; mock tests must reproduce server validation.
- Android custom selector must survive options becoming empty while open, use localized unavailable/close labels, retain actual keyboard focus and visible active options, and match all Material color/shape roles to the accepted scholarly palette. Initial captures still contained default purple roles; final acceptance requires corrected captures and targeted tests.
- Android finger-first mixed input becoming sole stylus still crosses a known Compose synthetic cancellation boundary. Prior stability acceptance does not close that gate; reader stage must resolve or precisely establish it. Physical Galaxy Tab/S Pen remains unverified.
- Fine PDF geometry is accepted as approximate operator/font-advance envelopes with honest partial/no-text coverage. Platform cache identity/rotation/hit-testing remains separate client work, and historical annotations must not be silently reinterpreted.
