# Page-pinned desktop answer cards

Implemented on `iwantgobackhome/cards-ui`, based on the shared placement contract in `dbfe0fd`.

Each selection Ask or structural Explain creates a new card with its own conversation thread ID. Cards render as absolute-positioned portals inside their original PDF page, using normalized page coordinates rather than viewport coordinates. Dragging and keyboard movement clamp within the page; a ResizeObserver also keeps expanded cards within a resized page. Repeated questions at the same source stagger their card headings, and markers sit above open cards so they remain reachable. Positions and open/collapsed/dismissed state save to the thread root with a 200 ms debounce. Writes serialize per thread and failed writes retain the latest pending placement for retry. Root lookup prefers `id === threadId`, then the oldest turn.

Collapse produces a `?` marker for questions or `i` for figure/equation/table explanations; expanding retains the same conversation and position. Escape collapses the focused card. Confirmed deletion dismisses its card without deleting History. Opening a thread in History reopens its card and navigates to the original page. Popup composers cannot switch to another conversation via New Question; selection Ask creates the separate card instead.

Hover, keyboard focus, and dragging show a purple translucent source accent. Stored text layout ranges reconstruct selected unit rectangles from layout quads; legacy contexts use their stored rectangle. Geometry uses the existing provenance checks and rotation utility, and stale/unavailable sources and nonrendered source pages produce no highlight. Card dragging is excluded from PDF text and region selection so it cannot trigger reader autoscroll.

Cards appear only on the original PDF. Split view displays them on the original side; translation-only view hides them along with the original pane. Restoring the reader loads all root placements in open/collapsed state. Dismissed threads remain available in History.

## Validation

- `npm run build -w @fractal/shared` generated the workspace declarations required by the initial checkout.
- `npm run typecheck`: passed for shared, Hub, and UI.
- `npm test -w @fractal/ui`: passed, 78 tests in 19 files. Added tests cover coordinate round trips and scroll offsets, clamping including small pages, source-adjacent defaults, and explicit/fallback thread-root selection.
- `npm run build -w @fractal/ui`: passed (existing bundle-size and Zod annotation warnings).
- `FRACTAL_E2E_CHANNEL=chrome npm run e2e`: passed after rebuilding the UI. Covers drag movement; bounding-box movement by actual page scroll delta; hover highlight; marker collapse/expand; Escape; stable model picker; retained follow-ups; second Ask with first card retained; confirmed deletion and retained History; History reopening the same conversation; saved open/collapsed restoration without new generation; and existing highlight/region/settings smoke checks.
- `git diff --check`: passed.

## Integration limit

This isolated worktree does not contain `PUT /api/papers/:key/history/:id/placement`. `HubApi.saveAnswerPlacement` uses the existing missing-route compatibility behavior: 404 returns null and card placements remain in memory for the reader session. Durable placement writes must be verified after integrating the parallel Hub worker. The reload e2e seeds root placements directly through the test store to verify UI restoration; it explicitly logs that the actual placement route is absent and does not claim to prove endpoint persistence. When the route is present, the same e2e also checks that the prior card interactions produced stored placement fields.

## Screenshots

- [Hover source highlight](source-highlight.png)
- [Two independent cards, first collapsed](multiple-cards.png)
- [Dismissed card reopened from History](history-reopened.png)
- [Saved open and collapsed cards restored](restored-cards.png)
