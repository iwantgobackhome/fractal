# Desktop stage 3: discovery, publication identity and source context

The scholarly discovery desk now uses the accepted research index: paper, news and topic views; wrapped publication titles; reported journal/conference/preprint/unknown metadata; explicit metadata saves; and local PDF association with the existing catalog identity. Related results retain useful rows while refreshing or failing, with provider-specific status, cache time, cooldown and an explicit retry. New original reader actions declare the actual loaded PDF hash and rendered page frame, with exact layout offsets only when native endpoints, physical page, legal UTF-16 boundaries and the entire selected stream agree.

Current C implementation and browser evidence pass. **Final packaged certification is pending the coordinator's accepted Hub shutdown correction and the required subsequent current rebuild.** The package results currently recorded here are preliminary integration evidence. No Hub/shared/Android files, generated tokens, package dependencies or scripts were changed by C; review/prototype paper contents were not shipped.

## Accepted source boundary

- Reader source `02b77c3b551abaa468139bbc83eb742bb35faa79`, previously accepted by root.
- Discovery dependency supplied by root as `8554ab261589599a866f2d67692d54b0eea2cb6e` (B source `12db751`).
- C foundation checkpoint `b1625c54eae54a29e3c9955c64994d1b1ca9db3d`.
- Optional provenance/answer-language dependency supplied by root as `0bb7509c711bef95e858f8121c9b36babc510517` (B source `5dad1b3af05ca0ee979af358b8b0c67d25170fdc`).
- Final C implementation checkpoint and final artifact evidence commit are reported through Orca; C does not merge dependencies.

## Resulting behavior

Discovery source/type/search/sort and field/topic filters act on actual feed projections. Identity lookup recognizes normalized DOI prefixes/percent encoding and arXiv abs/pdf/version/case aliases, rejects contradictory IDs and ambiguous or short title-only matches, and removes repeated provider projections while retaining conflicting identities. Explicit save/unsave broadcasts catalog changes across discovery, related, library and reader; recent reads remain separate. Metadata-only records offer local PDF linking in the library as well as discovery/related. Source configuration uses the actual Hub settings API, retains existing settings, and exposes failed-save and retry actions.

News keeps the existing article extraction, machine translation, category/custom interests and following/topic management routes. Headline-language selection uses the shared custom selector and actual quick-translation endpoint. Discovery groups repeated source reports behind a compact disclosure; related displays actual provider failure/cache provenance directly. There is no frontend network retry timer or automatic related refresh loop.

New original highlights and positioned memos use `rendered-page-normalized-v1`, `textSource: original` and SHA-256 computed from loaded PDF.js bytes. A uniquely matched native selection records the authoritative layout version, physical page and legal exact UTF-16 range; uncertain/multiple-page offsets are omitted. Explicitly unrotated imported geometry rotates once for display, reverses user movement in its declared frame, and preserves exact raw coordinates for body-only edits. Untagged historical geometry and raw fields remain untagged. Invalid synchronized pages and unavailable individual geometry do not suppress valid annotations. Stale anchors retain their text in the list but are not painted against a mismatching source; unavailable layout verification retries on reconnect, focus or an explicit action, with layout requests shared per page.

The per-question answer-language selector supports Hub default, automatic, known languages and an explicitly validated custom BCP47 tag. An override persists in history and never changes global preferences. Reopened answers show durable selected-passage citations and localized source status; stale quote/draft context remains usable and visible. Translated copy/quote retains separate translated provenance without original coordinates or original offsets. Request 14 remains excluded.

## Executed checks

All data and browser/Electron profiles are temporary and isolated. The actual Hub, HTTP/SSE, SQLite, PDF association, extraction, native PDF.js rendering and application routes run normally; only outbound scholarly/news/translation/AI provider boundaries are controlled in the browser integration fixture. Fixture contents live in verification tools/evidence and are excluded from the packaged product.

| Command | Result and evidence |
| --- | --- |
| `npm run build -w @fractal/shared` | Accepted declarations rebuilt before optional-field integration. |
| `npm run typecheck` | Shared, Hub and UI pass; [typecheck log](stage3/typecheck.log). |
| `npm run typecheck -w @fractal/ui` | Current UI passes; [UI typecheck log](stage3/ui-typecheck.log). |
| `npm run test -w @fractal/ui` | 27 tests in 10 files pass, including identity collision/alias cases and declared-frame geometry; [UI test log](stage3/ui-tests.log). |
| `npm run build -w @fractal/ui` | Current production build passes; [build log](stage3/ui-build.log). |
| `$env:FRACTAL_VERIFICATION_OUTPUT='docs/implementation/desktop/stage3/reader-regression'; npx tsx apps/desktop/tools/stage2-verify.ts` | Existing full native selection/scan/sticky/history browser and Electron regression passes under stage-3 UI; [results](stage3/reader-regression/verification.json), [log](stage3/reader-regression.log). |
| `npx tsx apps/desktop/tools/stage3-verify.ts` | Real Hub/browser integration and Hub restart pass with no browser exceptions; [results](stage3/verification.json), [log](stage3/verification.log). |
| `npm run desktop:dist` | Current source produced Windows unpacked exe and NSIS installer; preliminary build before required lifecycle dependency; [log](stage3/package-build.log). |
| `npx tsx apps/desktop/tools/stage3-packaged.ts` | Actual packaged exe, isolated persisted Hub/profile, discovery, cached original reader, text layer, selector keyboard and bundled icons pass; [results/hashes](stage3/packaged-verification.json), [log](stage3/packaged-verification.log). |
| `python apps/desktop/tools/stage3-icons.py` | Native executable/NSIS RT_GROUP_ICON and RT_ICON bytes match accepted ICO at 16/24/32/48/64/128/256 px; [results](stage3/native-icons.json), [log](stage3/native-icons.log). |

The reader regression uses the actual five-page PDF geometry fixture and a real image-only PDF through the Hub. It verifies proportional partial-character selections, columns, reverse dragging, pages with bounded rendering/auto-scroll, zoom, cropped/intrinsically rotated and angled text, Unicode boundaries, selections over highlights, keyboard range changes and native Electron clipboard copy. It also covers real translated selection/copy/quote, pending/final/failed explanation history across close/paper change/restart, complete note editing/keyboard movement/collapse/color/autosave/delete and retained scanned-page notes.

The stage-3 fixture verifies actual OpenAlex/Crossref parsing and repeated-result deduplication, publication kinds and unknown values, source/type/topic filters, metadata-only save with no read/PDF, save/unsave consistency, local chooser PDF association preserving folders/tags, repeat association and replacement-409 retaining annotations/history, exact native `[1,7)` original range, English and custom `zh-Hant` overrides without preference mutation, durable citation/source state, legacy raw round-trip, unrotated body/movement round-trip, offline layout recovery, invalid-page isolation and stale quote/draft restoration. Actual related provider 429 and separate timeout retain rows during refresh and in stale results, disable cooldown retry, remain saveable, and emit no automatic request storm. Hub restart retains language, provenance, citations, stale history and untagged legacy fields.

## Product renders

[Verification manifest](stage3/verification.json) lists 29 current product captures, including 18 discovery combinations at 1280×800, 1440×900 and 1920×1080 in light/dark/sepia and English/Korean. Long original Korean and English titles are measured for clipping. Reader regression provides the corresponding 18 reader combinations plus native Electron captures.

Representative current renders: [1280 light English](stage3/discovery-1280-light-en.png), [1440 dark Korean](stage3/discovery-1440-dark-ko.png), [1920 sepia Korean](stage3/discovery-1920-sepia-ko.png), [topics](stage3/discovery-topics.png), [translated headlines](stage3/discovery-news-translated.png), [actual extracted article](stage3/discovery-article-source.png), [loading](stage3/discovery-loading.png), [error with retry](stage3/discovery-error.png), [empty filter](stage3/discovery-filter-empty.png), [retained related refresh](stage3/related-refresh-retained.png), [429/timeout stale rows](stage3/related-stale-429-timeout.png), [original provenance/language](stage3/reader-original-provenance-language.png), [reopened stale draft](stage3/reader-reopened-stale-history.png), [Hub restart history](stage3/reader-hub-restart-history.png), [packaged discovery](stage3/packaged-discovery.png), [packaged cached original](stage3/packaged-cached-original.png).

## Packaging boundary and remaining limits

Package paths are `dist/installer/win-unpacked/Fractal.exe`, `dist/installer/Fractal Setup 0.1.0.exe` and `dist/installer/win-unpacked/resources/app.asar`; their exact absolute paths, sizes and hashes are in the package verification manifest. Accepted branch master/ICO hashes are recorded there too. The actual executable is packaged, named Fractal and runs from app.asar; its 256/32 window/tray asset sizes and native executable/installer resources were checked. The installer was not installed, and no taskbar pin, user-data reset, macOS or physical Android/pen claim is made.

Immediate preseed Hub shutdown after local PDF association exposed background `StructureService.schedule` work resuming against closed SQLite (`structure/service.ts:67`, `ERR_INVALID_STATE`). Root confirmed and routed the narrow lifecycle fix to E. The preliminary packaged fixture settles real structure work before stopping its seed Hub; **the final artifact rebuild/certification must wait for root's accepted correction**.

Provider protocol/status/caching fixtures do not prove live provider quota or production credentials. Native exact ranges remain conditional on uniquely matched/legal authoritative runs; ambiguous offsets stay omitted. Positional layout glyph metrics and their citation envelopes remain approximate as defined by B. SQLite experimental-feature and Vite large-bundle warnings remain. Independent E performs final cross-platform QA after root integration.
