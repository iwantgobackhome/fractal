# Desktop reader stage 2

Implemented on the accepted desktop/index commit `4bc725933c60b3b2eaa7f7c659a8f1d8012e8472`, with the supplied positional foundation commits `376a20d` and `6dd6f3e`. Scope is the desktop React reader, its hub client, desktop verification tooling, and this evidence directory. Discovery stays on the existing implementation until the coordinator supplies its final stage dependency.

The reader has a wrapping scholarly title/context band, compact page/view/model/language controls, original-only pen/text/region tools, and a 306 px research margin. The shared accessible selector serves reader models/languages and history filters. Existing translation jobs, progress, language preferences, exports/printing, settings, account connections, glossary API and related/reference access remain connected. The prototype supplies design direction only: PDFs are still rendered by PDF.js and translated paragraphs come from stored translations.

Questions and selected-text/figure/equation/table explanations use the actual persistent history routes and SSE `historyId`, with a stable request ID for each admitted request. The active entry and unsent draft/context are retained per paper in the browser profile. New question detaches the previous active entry into the durable archive and opens a fresh draft; it does not delete history or cancel generation. History filters/search retain entries and their original physical-page/region/quote context. Closed or detached observers can reopen pending/final results, and a hub interruption retains partial answers and retryable errors. Explicit Cancel invokes the server cancellation route. Model-unavailable errors and completed-but-empty answers have distinct states; retrying a settled failure creates a fresh request rather than endlessly replaying that failure. Migrated conversations remain readable in the same history list.

Original-file loading is separate from extraction eligibility. An unsupported extraction with valid PDF bytes opens its original canvas and can receive deliberate region notes/questions. Native text coverage reports when a page has no selectable PDF text and directs the reader to Region; its translation pane reports unavailable extraction rather than claiming generated text. Actual product upload through the file input retains the image-only PDF, opens its unsupported original, and admits a region question without implying saved membership. Identical PDF bytes correctly reuse the existing paper identity. The region UI supplies coordinates and available extracted text; it performs no OCR or image interpretation.

Positioned memos retain their complete body, quote, color, collapsed state and normalized original physical-page rectangle. Typing saves after a short pause and on blur, with local draft/pending-mutation recovery; edits can also be saved explicitly. Header dragging and arrow movement, Shift+arrow resizing, and a resize handle constrain new positions to the page. Collapse/reopen retain content, list entries navigate to the original anchor, and deletion is explicit. Clean remote memo updates do not get overwritten by stale editor bodies. Historical highlight/ink rectangles retain their existing rendered-page interpretation.

## Original selection and coordinate compatibility

The whole-span sweep has been removed from the reader interaction. Native PDF.js text nodes and browser caret/DOM ranges supply partial-character geometry. The drag retains its native anchor while scrolling or changing the virtual window, supports backwards ranges, and keeps at most the current three-page canvas window plus one pinned anchor page. Selection across a virtual gap obtains intervening original text from the accepted derived layout rather than rasterizing the entire PDF. Those fallback envelopes retain the foundation's approximation/coverage limits; unavailable intermediate text is not invented. Cross-page quotes/copy carry physical page markers, and saved highlights are split by their physical page.

The text layer retains original Unicode with `disableNormalization`, uses display-column ordering, and links matching native runs to the accepted legal UTF-16 boundaries. Grapheme/emoji and indivisible ligature endpoints are snapped legally. PDF.js span font scaling, crop handling and intrinsic rotation stay intact; required TextLayer rotation CSS applies the page's intrinsic rotation once. Derived quads are unrotated crop-relative and rotate once when used for intervening-page fallback. Layout responses are checked against SHA-256 of the actual loaded PDF bytes. No new shared/source-provenance wire fields are introduced while that contract is pending.

Highlight paint no longer intercepts text drags; a separate marker in the page gutter deliberately opens its editor without covering the adjacent word. Selecting Text or Region disables pen input while keeping existing ink visible. The ordinary translated text selection/copy/quote path uses actual translated DOM content and records an explicit translated-passage provenance label. It adds no translated annotation anchor or translated-to-original position mapping.

Clipboard overrides validate immutable native range endpoints and connected text nodes before using the captured PDF excerpt. Shift navigation, selection replacement, whole-document selection, and paper changes cannot copy an earlier cached quote. A live cloned DOM range would shift during virtual-page removal, so the cache retains plain endpoint snapshots instead. Browser-default copy remains available when the current range does not match. Keyboard range capture runs after browser defaults on keyup, including when document focus is outside the PDF container.

Long translated headings wrap within their physical page without ellipsis. When a zoomed physical page exceeds a narrowed split pane, the pane's horizontal scrollbar retains access to the complete page. Actual heading line bounds and end-character recovery are verified; the figure screenshot also fits both pages within their panes.

## Verification

All verification uses fresh temporary `FRACTAL_DATA`, an empty legacy directory, and isolated browser/Electron profiles. Nothing resets or modifies a user database. The integration runner uses the actual hub HTTP/SSE routes, SQLite store, structure detector, built React UI and PDF.js renderer; only the AI provider boundary produces controlled test output, without account credentials or external generation. Its temporary image-only PDF is the raster-only page extracted from the accepted actual geometry fixture.

Commands run from the worktree root:

```powershell
npm run desktop:build
npm run typecheck -w @fractal/ui
npm run test -w @fractal/ui
npx tsx apps/desktop/tools/stage2-verify.ts
npx prettier --write packages/ui/src/App.tsx packages/ui/src/components/HighlightLayer.tsx packages/ui/src/components/PdfPane.tsx packages/ui/src/components/SelectionQuote.tsx packages/ui/src/design/reader.css packages/ui/src/reader/InkLayer.tsx packages/ui/src/reader/NotesPanel.tsx packages/ui/src/reader/ReaderBar.tsx packages/ui/src/reader/SelectionMenu.tsx packages/ui/src/shell/hub-api.ts packages/ui/src/lib/native-selection.ts packages/ui/src/lib/native-selection.test.ts packages/ui/src/reader/ResearchPanel.tsx packages/ui/src/reader/StickyLayer.tsx apps/desktop/tools/stage2-verify.ts
git diff --check
```

- Desktop build passes: shared/UI/hub builds and desktop bundles; the hub's existing typecheck also passes.
- UI typecheck passes, and 22 tests in eight files pass, including meaningful Unicode/ligature endpoint and bounded-sticky regressions.
- Actual rendered PDF pointer drags pass at 100% and 150%, backwards, within/across two columns, through an existing highlight, on a 90° cropped page, and on a 30° angled/cropped run. The cross-page drag covers physical pages 1–2 with three live canvases, and Ctrl+C retains physical-page provenance. Unicode runs in the actual embedded-font fixture retain authoritative legal boundaries.
- Actual translated paragraph pointer drag, Ctrl+C and quote-to-question pass; its retained context has translated provenance and no original rectangle.
- Current-range copy passes immediately after Shift+ArrowLeft, Shift+Home/End, double/triple-click, Ctrl+A, direct range replacement and a paper change. Native Electron additionally exercises actual partial PDF dragging and immediate Shift-arrow copy through its OS clipboard.
- Edge dragging actually auto-scrolls the original pane. A five-page native range retains its start anchor with three live canvases, copies the unmounted intermediate pages from the hash-checked layout, and keeps the image-only page's text empty.
- Idempotent replay creates no duplicate history. Pending close/reopen, paper change, final answer retention, selected-text and detected-figure explanations, archive filters/keyboard focus, failed drafts, explicit cancellation, and service shutdown/restart recovery pass.
- The actual image-only/unsupported PDF opens one original canvas with zero text spans. Product upload retains PDF bytes and unsaved membership, and a region question persists honest empty-text/physical-page context. Sticky full-body edits, automatic save, pointer movement, keyboard movement/resize, color change, collapse/reopen, paper change and hub restart retain content. Native Electron reopens that original PDF/memo and a completed question from the same isolated database; explicit deletion of a second memo survives reload while the original memo's full body remains intact.
- The screenshot matrix contains all 18 requested viewport/theme/language combinations, with long Korean/English titles and no document-level horizontal overflow. Runtime browser exceptions are empty.

Authoritative results: [verification.json](stage2/verification.json). Reproducible runner: [stage2-verify.ts](../../../apps/desktop/tools/stage2-verify.ts). Logs: [desktop build](stage2-desktop-build.log), [UI typecheck](stage2-typecheck.log), [UI tests](stage2-tests.log), [integration](stage2-integration.log). Node reports its SQLite experimental warning and Vite reports its large-chunk warning; both commands complete successfully.

## Product screenshots

| Language/theme | 1280 × 800                                 | 1440 × 900                                 | 1920 × 1080                                 |
| -------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------- |
| English/light  | [PNG](stage2/reader-en-light-1280x800.png) | [PNG](stage2/reader-en-light-1440x900.png) | [PNG](stage2/reader-en-light-1920x1080.png) |
| English/dark   | [PNG](stage2/reader-en-dark-1280x800.png)  | [PNG](stage2/reader-en-dark-1440x900.png)  | [PNG](stage2/reader-en-dark-1920x1080.png)  |
| English/sepia  | [PNG](stage2/reader-en-sepia-1280x800.png) | [PNG](stage2/reader-en-sepia-1440x900.png) | [PNG](stage2/reader-en-sepia-1920x1080.png) |
| Korean/light   | [PNG](stage2/reader-ko-light-1280x800.png) | [PNG](stage2/reader-ko-light-1440x900.png) | [PNG](stage2/reader-ko-light-1920x1080.png) |
| Korean/dark    | [PNG](stage2/reader-ko-dark-1280x800.png)  | [PNG](stage2/reader-ko-dark-1440x900.png)  | [PNG](stage2/reader-ko-dark-1920x1080.png)  |
| Korean/sepia   | [PNG](stage2/reader-ko-sepia-1280x800.png) | [PNG](stage2/reader-ko-sepia-1440x900.png) | [PNG](stage2/reader-ko-sepia-1920x1080.png) |

Additional actual-render evidence: [partial 100%](stage2/partial-range-100.png), [partial 150%](stage2/partial-range-150.png), [column](stage2/column-range.png), [cross-page](stage2/cross-page-range.png), [rotated crop](stage2/rotated-crop-range.png), [angled run](stage2/angled-range.png), [Unicode](stage2/unicode-source.png), [figure explanation](stage2/figure-explanation.png), [image-only sticky](stage2/image-only-sticky.png), [native Electron web contents](stage2/electron-scan-note.png).

Additional edge-case screenshots: [five-page virtual gap](stage2/cross-virtual-gap.png), [translated heading end recovered by scrolling](stage2/figure-heading-end.png), [uploaded image-only region question](stage2/image-only-upload-question.png).

## Remaining boundaries

Physical Surface/Wacom pen hardware and live Codex/Claude generation were not exercised. Native selection inherits PDF.js font substitution and the foundation's explicit heuristic/unsupported coverage limits for complex layouts; derived rectangles remain approximate envelopes rather than glyph ink bounds. The original scan stays faithful, but the current text-only explanation API does not interpret its raster image. This stage verifies a rebuilt development Electron shell; it does not repeat stage 1's accepted packaged NSIS/PE icon inspection or claim a newly installed reader build. The same accepted icon files/configuration are untouched. New optional coordinate provenance awaits the coordinator's accepted shared contract, and related/discovery enhancements await the separate final-stage dispatch. Request 14 remains excluded.
