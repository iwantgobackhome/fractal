# W1-B — Hub core

## Summary

- Added the production SQLite store in `%LOCALAPPDATA%/Fractal` (or XDG data home), with `FRACTAL_DATA` override, two recorded schema migrations, content addressed PDF files, and a transactional, non-destructive import of verified PaperRead JSON records and highlights.
- Added FTS5 search over bibliography metadata and extracted blocks. Added bibliography, tags, collections, raw or multipart PDF upload, DOI/Crossref/Unpaywall resolution, arXiv and publication URL ingest, and DOI/arXiv/PDF hash deduplication.
- Added BibTeX, CSL-JSON, and Markdown exports; synced highlights, memos, and ink; append-only sync cursors with timestamp/device conflict resolution and tombstones; PDF ETag and Range responses.
- Kept the reader's snapshot, highlights, translation, job, and chat store methods available on SQLite. Added unit and route handler tests for import, search, DOI mocks, generated PDF metadata, dedupe, export, sync conflicts, and ranged PDF reads.

## Endpoints added

`GET/PATCH/DELETE /api/library/:key`, `GET /api/library`, `GET /api/library/search`, `GET /api/library/export`, CRUD routes under `/api/library/tags` and `/api/library/collections`, `POST /api/papers/upload`, `GET /api/papers/:key/export/:format`, `GET/POST /api/papers/:key/annotations`, `GET/DELETE /api/papers/:key/annotations/:id`, `GET /api/sync/pull`, and `POST /api/sync/push`. `POST /api/papers/open` accepts DOI input and uses the merged ingest path. `GET /api/papers/:key/pdf` now returns `ETag` and supports 206, 304, and 416.

Request and response shapes are in [API.md](../API.md) and Zod contracts in `packages/shared/src/contracts`.

## Acceptance output

```text
> npm ci
added 70 packages, and audited 74 packages in 5s
19 packages are looking for funding
2 moderate severity vulnerabilities
exit code 0

> npm run build
> @fractal/shared@0.1.0 build: tsc -p tsconfig.json
> @fractal/ui@0.1.0 build: vite build
✓ 59 modules transformed.
✓ built in 4.57s
> @fractal/hub@0.1.0 typecheck: tsc --noEmit -p tsconfig.json
exit code 0

> npm test
@fractal/shared: 1 test passed
@fractal/hub: 11 tests passed
@fractal/ui: 2 tests passed
exit code 0

> npm run typecheck
@fractal/shared: tsc --noEmit -p tsconfig.json
@fractal/hub: tsc --noEmit -p tsconfig.json
@fractal/ui: tsc --noEmit -p tsconfig.json
exit code 0
```

`node:sqlite` loaded and FTS5 worked on Node 22.23.1 without a launch flag; Node printed its experimental API warning. The UI build printed its existing large chunk warning. `npm ci` reported two moderate audit findings.

## Manual smoke

Started `npm run hub` on port 7339 with an isolated `FRACTAL_DATA`. `GET /` returned 200 and `GET /api/papers` returned 200. Used curl with the startup token, loopback Origin, and `Content-Type: application/pdf` to upload a generated one-page PDF; the response was 201 with a ready paper titled **Smoke Test Paper**. Used curl to open arXiv ID `1706.03762`; the response was 200 with **Attention Is All You Need**, revision `v7`, ready, 15 pages. `GET /api/sync/pull?since=0` returned cursor `3` and both paper keys. Stopped the server and verified port 7339 was no longer listening.

## Decisions

- The production service uses `SqlitePaperStore`, which preserves the existing `PaperStore` method surface for reader paths. The legacy JSON implementation remains available to existing tests; production does not write new paper records there.
- URL open waits for acquisition and extraction so the response names the canonical paper after deduplication. The UI's response shape remains `{paper}`.
- Paper uploads use a local HTTPS-shaped source URL inside the legacy `Paper` snapshot contract; the bibliography record carries independently editable citation fields.
- Completed assistant chat answers are exported as AI notes in Markdown. The current app has no separate persisted AI note type.
- Unpaywall lookup is enabled when `FRACTAL_CONTACT_EMAIL` is set. DOI input without a free PDF returns an error; metadata alone is not added as a paper.

## Known gaps and integrator notes

- The live sync API remains behind the current loopback guard. Worker D must wire Android pairing and network binding before a device can call it remotely; this task did not edit `api/guard.ts`.
- PDF metadata inference examines the info dictionary and first page. Scanned or unusual PDFs may need manual bibliography edits.
- The data import skips corrupt legacy paper records with a stderr warning and leaves their source untouched.
- Worker C can import `searchLibrary(query, {limit})` from `packages/hub/src/library/search.ts`; the service calls `configureLibrarySearch(store)` at startup.

## Review fixes

- The upload, DOI, library, annotation, and sync routes now return Korean user-facing `INVALID_INPUT` responses for malformed input. Unsupported upload media returns 415; requests over the size limit return 413 `TOO_LARGE`. Crossref and Unpaywall failures return retryable 502 `NETWORK`. Request schema errors use a short message and do not expose raw Zod output.
- Added an in-process HTTP route test for bad DOI, DOI without a free PDF, non-PDF upload, invalid cursor, malformed push, and failed Crossref, plus a route-level oversized upload check. A SQLite trigger test proves that a failed change-log insert rolls back the annotation and highlight mirror together.
- Annotation upserts and legacy highlight updates now use savepoints, so the annotation row, highlight mirror, and change-log row commit together.
- `POST /api/papers/open` continues to block until acquisition and extraction finish for v1; the UI shows its busy state meanwhile.
- Re-ran `npm ci`, `npm run build`, `npm test` (1 shared, 11 hub, 2 UI tests), and `npm run typecheck`; all exited 0. A fresh `npm run hub` smoke on port 7340 returned 200 for `/` and `/api/papers`, 400 for a bad DOI, 201 for local PDF upload, and 200 for arXiv `1706.03762`. `sync/pull?since=0` returned both papers (cursor `3`). The server was stopped and port 7340 had no listener.
