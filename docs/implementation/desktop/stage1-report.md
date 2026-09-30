# Desktop stage 1 — scholarly research index

Implemented the coordinator-reviewed iteration 02 direction on the accepted design/foundation base. The product uses the existing bundled fonts and generated common tokens: a 244 px research sidebar, serif headings and full paper titles, fine rules, real bibliography details, restrained red actions, and compact status controls. Reader layout/selection/history panels/sticky notes remain the next stage; this stage adds only actual reading-position recording and restoration to the existing reader.

The research index reads the accepted bibliography and folder APIs. Saved, recently read, and locally available PDFs are distinct views; importing/opening does not save a paper. Save removal is an explicit action and local destructive deletion is a separate confirmed action inside the paper editor. Rows use real authors, venue/year, abstract, tags, folder membership, PDF status, and recorded page/offset/fraction; missing publication/authors/position are stated plainly. Metadata-only records offer their source URL rather than assuming a reader file exists. Search/status/tag filters only select rows; they do not write memberships or history. There is one index and no additional resume shelf. Existing import, source/split/translation, discovery/news/topics, accounts, model connections, settings and bibliography exports remain accessible.

Folders support nested creation, rename/move, cycle-safe parent choices, multiple paper memberships, tags, and descendant counts de-duplicated per paper. Folder removal uses the hub's tombstone API: immediate children move to its parent, only that folder's memberships disappear, and papers remain. Pre-existing orphan memberships survive editing. Periodic visible-library refresh includes cached reader files arriving through the hub.

The shared `Selector` supplies labelled combobox/listbox semantics, active-descendant focus, arrows/Home/End (also from a closed popup), Enter/Space, typeahead, Escape, Tab/outside closure, disabled/loading/empty choices, wrapped names, dynamic option identity, and viewport-contained popovers portalled outside clipping containers. It is used for index sort/status/tags, folder parents, settings model/effort, languages, and theme. Reader control adoption is deferred. Model saving is disabled while pending; errors restore the previous choice and remain visible.

The app, window/tray assets, Windows executable and NSIS installer use the final reviewed `design/assets/branch-master.svg` geometry. The in-app mark follows the theme ink; launcher/tray exports put the same geometry on a warm paper tile for contrast in either OS theme. Package changes are limited to icon asset inclusion and Windows/NSIS icon fields.

## Validation

All commands ran from the repository root on Windows. No dependencies or scripts were rewritten.

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Installed the locked dependencies in the isolated checkout. |
| `npm run build -w @fractal/shared` | Passed; required before UI typechecking in this fresh checkout. |
| `npm run typecheck -w @fractal/ui` | Passed on final source. |
| `npm run test -w @fractal/ui` | Passed: 7 files, 19 existing tests. |
| `npm run desktop:build` | Passed: shared, React UI, hub and embedded hub bundle. |
| `npm run build -w @fractal/ui` | Passed after final index/control changes. Existing large-chunk warning remains. |
| `node apps/desktop/tools/generate-icons.mjs` | Generated 16/24/32/48/64/128/256 px PNGs and a multi-size Windows ICO from unchanged master paths. |
| `node apps/desktop/tools/verify-selector.mjs` | Passed actual production-component dynamic-list, keyboard, disabled, loading/empty, focus, clipping and viewport checks. |
| `npx tsx apps/desktop/tools/stage1-verify.ts` | Passed real isolated hub, built React browser UI and Electron flows. |
| `npx electron-builder --win dir` | Passed; unpacked `Fractal.exe` produced. |
| `npx electron-builder --win nsis` | Passed, including a final build after the final React changes. |
| `node apps/desktop/tools/verify-packaged.mjs` | Passed actual packaged `Fractal.exe`/`app.asar` startup, bundled window/tray images, empty index and selector keyboard checks with fresh data/profile. |
| `npx prettier --write <changed UI/desktop sources>` and `git diff --check` | Formatting and whitespace checks passed. |

An initial typecheck could not find `tsc` before `npm ci`, then could not resolve the unbuilt shared package. Building the shared package resolved these environment prerequisites. Verification script setup errors (canonical identities, a one-page source, origin gate, PDF EOF, same-document reload, fixture annotation API, delayed route teardown and Electron evaluation imports) were corrected in the isolated harness. The final JSON reports below pass. The strengthened resume assertion verifies both a new persisted read timestamp and the actual PDF viewport page offset, rather than merely checking the old stored record.

### Behavior evidence

- [Verification results](stage1/verification.json): new ingestion is unsaved/unread; visible PDF reading records recent/progress; explicit save/unsave retains the exact PDF, history, memo and position; reopening restores the actual source page offset. Nested folders are created, renamed, moved and removed through product controls; self/descendant move options are absent, children are promoted, paper memberships survive, and search writes nothing. Electron also exercises save/unsave, reader routing and selector focus/keyboard.
- [Selector results](stage1/selector-verification.json): 60 long model options near the viewport bottom and inside an overflow-hidden container remain reachable. Reordering preserves the active value, removal keeps `aria-activedescendant` valid, disabled options cannot be chosen, and loading/empty updates disable/close the control. [Long-list capture](stage1/selector-long-list-bottom.png).
- [Native icon results](stage1/native-icons.json): vector paths/weights unchanged, copied transparent master byte-identical; Windows-extracted application and installer icons pixel-identical to the 32 px export. [Small-size inspection](stage1/icons-small-size.png), [application resource](stage1/packaged-exe-icon.png), [installer resource](stage1/installer-icon.png). At 16 px the strongest rendered stroke has 12.16:1 contrast against its tile; antialiased edges are naturally lighter.
- [UTF-8 check](stage1/utf8-check.json): new Korean copy and the reading-error notice contain Hangul, with no replacement characters or corrupted question-mark strings. The notice's initial shell-pipe encoding issue was corrected through UTF-8-safe patching.
- [Package artifacts/checksums](stage1/packaged-artifacts.json), [package build output](stage1/package-build.log), [flow completion](stage1/flow-run.log).
- [Packaged startup results](stage1/packaged-verification.json) and [packaged index capture](stage1/packaged-index-empty-en.png): the actual unpacked executable starts, serves the bundled UI, decodes its 256/32 px icon assets and runs the custom selector through keyboard controls. This test uses another fresh data/profile directory.

The harness sets a fresh `FRACTAL_DATA`, an empty `PAPERREAD_DATA`, a separate Electron profile, test mode, disabled real CLI probes, and disabled background feed refresh. It uses a generated three-page verification PDF and expressly illustrative bibliography records through the real persistent hub APIs/store. It never resets the user's library. Fixtures and evidence scripts are outside the packaged product file list. No prototype paper body, review toolbar, simulated publication label or invented reading position ships in the app. Actual AI generation and external discovery providers were not exercised in this stage.

## Product captures

All 18 index captures are the built React product served by the real isolated hub, with exactly the listed CSS viewport sizes. Every capture has zero horizontal document overflow, zero clipped titles, no review toolbar, and the expected language/theme. Long English and Korean titles appear first to make wrapping reviewable. [Electron capture](stage1/electron-index-en.png) is a real renderer capture; its window dimensions differ from the browser presets.

| Viewport | Korean light / dark / sepia | English light / dark / sepia |
| --- | --- | --- |
| 1280 × 800 | [Light](stage1/index-ko-light-1280x800.png) · [Dark](stage1/index-ko-dark-1280x800.png) · [Sepia](stage1/index-ko-sepia-1280x800.png) | [Light](stage1/index-en-light-1280x800.png) · [Dark](stage1/index-en-dark-1280x800.png) · [Sepia](stage1/index-en-sepia-1280x800.png) |
| 1440 × 900 | [Light](stage1/index-ko-light-1440x900.png) · [Dark](stage1/index-ko-dark-1440x900.png) · [Sepia](stage1/index-ko-sepia-1440x900.png) | [Light](stage1/index-en-light-1440x900.png) · [Dark](stage1/index-en-dark-1440x900.png) · [Sepia](stage1/index-en-sepia-1440x900.png) |
| 1920 × 1080 | [Light](stage1/index-ko-light-1920x1080.png) · [Dark](stage1/index-ko-dark-1920x1080.png) · [Sepia](stage1/index-ko-sepia-1920x1080.png) | [Light](stage1/index-en-light-1920x1080.png) · [Dark](stage1/index-en-dark-1920x1080.png) · [Sepia](stage1/index-en-sepia-1920x1080.png) |

Additional states: [Actual empty saved](stage1/empty-saved-en-1440x900.png), [filtered empty](stage1/filtered-empty-en-1440x900.png), [delayed loading](stage1/loading-en-1440x900.png), [injected service error with retry](stage1/error-retry-en-1440x900.png), [settings theme selector](stage1/settings-selector-en-1440x900.png). Empty states provide import/browse/filter-reset actions; loading retains an import action; the injected 503 recovers through Retry.

## Native observations and next stage

Both the development Electron main process and the actual packaged `Fractal.exe` reached normal renderer/tray startup with 256 px window and 32 px tray images, and both packaged executable and installer icon resources were extracted and inspected. The installer was built but not installed: Start menu/desktop shortcut creation, pinned taskbar and OS tray appearance have not been visually inspected. macOS packaging was not tested on this Windows host. Current reader behavior is retained; scanned-PDF availability, fine text selection, persistent panel history and positioned sticky notes belong to the coordinator's next dispatch. Request 14 remains excluded. No merge was performed.
