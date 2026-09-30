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
