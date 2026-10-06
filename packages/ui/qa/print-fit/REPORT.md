# PDF export fitting verification

Implemented print-only translation fitting using shared A4 dimensions (96 CSS px/inch), 8 mm landscape / 10 mm portrait margins, and a 6 mm split gutter. Translations scale down to 0.6; longer content is sliced onto explicitly labelled continuation sheets with the original half left empty. The print root is laid out offscreen before printing, print spacing is applied during measurement, fonts and original raster rendering are awaited, and readiness is reported only after the fitted layout and continuation snapshots commit. Interactive KoreanPane code and desktop printing options are unchanged; desktop already sets preferCSSPageSize.

The UI currently supports only Korean and English, so continuation strings were added to both dictionaries; there are no Japanese or Chinese UI dictionaries in this checkout. Continuations preserve all translated pixels using contiguous vertical slices; a line or figure may cross a continuation boundary. No automatic readiness timeout remains, since that could print partially measured content.

Validation:

- `npm run typecheck`: passed across shared, hub, and UI.
- `npm test -w @fractal/ui`: 16 files / 65 tests passed, including five fit-computation tests.
- Initial checks required `npm run build -w @fractal/shared` because this new worktree had no generated shared package output; checks then passed.
- `node packages/ui/qa/print-fit/verify.mjs`: Chrome printed the real PrintView/KoreanPageView with deterministic synthetic two-column translations and a mocked PDF raster source.
- `swift packages/ui/qa/print-fit/render.swift packages/ui/qa/print-fit/artifacts`: PDFKit verified physical PDF page counts and extracted continuation labels, then rendered every PDF page to PNG.
- Visually inspected split-fit-page1.png and split-continuation-page2.png: fitted content stays on one sheet; continuation has a visible `p.1 (계속)` label and blank original half.

Results:

| Fixture                  | Source pages | Physical sheets | Continuations | Scale    |
| ------------------------ | ------------ | --------------- | ------------- | -------- |
| Split fitting            | 2            | 2               | 0             | 0.692087 |
| Translation-only fitting | 2            | 2               | 0             | 0.714921 |
| Split oversized fallback | 2            | 12              | 10            | 0.6      |

Artifacts (generated locally and ignored by Git):

- `/Users/dowankim/orca/workspaces/fractal/print-fit-pages/packages/ui/qa/print-fit/artifacts/results.json`
- `/Users/dowankim/orca/workspaces/fractal/print-fit-pages/packages/ui/qa/print-fit/artifacts/split-fit.pdf`
- `/Users/dowankim/orca/workspaces/fractal/print-fit-pages/packages/ui/qa/print-fit/artifacts/translation-fit.pdf`
- `/Users/dowankim/orca/workspaces/fractal/print-fit-pages/packages/ui/qa/print-fit/artifacts/split-continuation.pdf`
- `/Users/dowankim/orca/workspaces/fractal/print-fit-pages/packages/ui/qa/print-fit/artifacts/split-fit-page1.png`
- `/Users/dowankim/orca/workspaces/fractal/print-fit-pages/packages/ui/qa/print-fit/artifacts/split-continuation-page2.png`

The supplied evidence is an already-exported PDF, not the source paper plus translation snapshot, so the exact evidence paper was not re-exported. The committed fixture harness reproduces translation overflow with the production components and can be rerun locally on macOS with Chrome and Swift installed.
