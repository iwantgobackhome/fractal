# Publication PDF acquisition acceptance

The backend implements `POST /api/publications/open` using the existing `PublicationBookmark` request and `PublicationPdfLinkResult` response. The HTTP response uses the existing `{data: ...}` envelope. A successful response contains a real stored PDF and extracted `paper`; failures use the existing `{error: {code,message,retryable}}` envelope and never return a success-shaped result.

This worker started at `d1311d3`, a descendant of the accepted `e82c0e4`. Changes are limited to `packages/hub/**` and this report directory. No UI, Android, desktop, root dependency manifest, selection, annotation mapping, user database, account, or peer helper changes were made. Root integration remains the coordinator's responsibility.

## Consumer contract and user state

- Opening creates new catalog metadata with `saved=false`, `savedAt=null`, `status=unread`, and `lastReadAt=null`. An unsuccessful acquisition can leave this unsaved metadata available for an explicit subsequent bookmark; it never saves or records a read automatically.
- Existing saved/unsaved state, nested memberships, tags, read history, user bibliography fields and stable catalog keys survive acquisition. The existing `/api/library/bookmarks` action still explicitly saves.
- Recent is recorded separately through `/api/papers/:key/read` after a client actually reads. Acquisition itself does not record Recent or change unread status.
- Existing local PDF bytes are used first. Otherwise acquisition tries reported PDF metadata, canonical arXiv PDF URLs (preserving an explicitly reported version), DOI provider links and grounded publisher/repository landing pages.
- The existing `linkPdf` path retains identifier conflict checks, concurrent link protection, changed-byte rejection, atomic persistence and legacy catalog provenance. Identical publication opens share acquisition and extraction work. Existing linked bytes are never refreshed implicitly.

## Network and discovery boundaries

Acquisition has at most six distinct source candidates and one 60-second network budget across provider calls, DNS, redirects and candidate downloads. Crossref/OpenAlex use the existing `ScholarlyClient`, including configured provider header credentials, allowlisted no-redirect requests, shared serialization/cooldowns, an eight-second per-provider timeout and its existing 5 MB metadata body limit. Optional Unpaywall is requested only with an actually configured valid contact email and uses a 2 MiB response limit. PDF/source transfers retain `publicGet` HTTPS/SSRF validation, DNS-pinned public addresses, five redirects, PDF signature checking, 50 MiB maximum PDF bytes and 2 MiB HTML maximum. The time budget covers network resolution; PDF identifier inspection/extraction uses the existing linker and extractor. Server shutdown aborts outstanding acquisition network work and drains active opens before closing services.

Passive discovery supports explicit `citation_pdf_url`, alternate `application/pdf` link metadata, and one unambiguous main-document PDF anchor. Relative/entity URLs are decoded. Grounded non-extension download endpoints are allowed. Scripts/comments, arbitrary title anchors, ambiguous main candidates and supplementary/supporting/appendix links are excluded. The existing HTTP-to-HTTPS upgrade of explicitly reported proceedings PDF links remains; no publisher path rewrites or guessed download paths are introduced.

Provider-reported links remain candidates. Crossref PDF links do not set OA availability to open. Unknown OA metadata stays unknown even after successful acquisition. OpenAlex alternative `locations[]` PDFs and grounded OA landing pages are retained; related-paper projections request `locations`, and structure enrichment reuses the shared candidate helper without changing its identity policy. No arbitrary title searches were added to acquisition. Optional provider failures do not prevent a grounded publisher source from succeeding. If all attempts fail, size, authorization, quota and retryable network failures retain meaningful distinctions.

## Real application HTTP and public publisher bytes

At 2026-10-01 05:10 UTC an isolated application server running archived accepted `e82c0e4` received the exact publication request in [live-case.json](live-case.json). `/api/publications/open` returned HTTP 404, `NOT_FOUND`, with zero catalog/PDF records. Controlled provider wire metadata also reproduced both omissions: an alternative OA location projected no PDF, and a no-email Crossref record with a reported PDF resolved `pdfUrl=null`.

At 2026-10-01 05:18:32–05:18:35 UTC a fresh isolated store running the final backend source received the same request through its authenticated real HTTP server. It returned HTTP 200 with one unsaved catalog record, one ready paper, ten text pages and 142 extracted blocks. Reading `/api/papers/:key/pdf` returned HTTP 200 with the real publisher PDF bytes, and an independent public source download matched the stored bytes:

| Evidence | Value |
| --- | --- |
| Publisher/title | PMLR, *Model-Independent Online Learning for Influence Maximization* |
| Landing page | `https://proceedings.mlr.press/v70/vaswani17a.html` |
| Downloaded final PDF | `https://proceedings.mlr.press/v70/vaswani17a/vaswani17a.pdf` |
| Publisher's citation PDF field | Same PDF path explicitly reported over HTTP; existing policy requested HTTPS |
| Bytes | 1,061,253 |
| SHA-256 | `46d910177e7c2fb91bee441ec2e36a70dba25e9b728e4b565a9f6abfa18c88bf` |
| Stable catalog/paper key for supplied body | `pub-23aa1a8ad11fd9c35be08eeac2a4075183358f30bb0e7eb29d4a7aa5f8b70810` |
| Catalog state after acquisition | `saved=false`, `savedAt=null`, `status=unread`, `lastReadAt=null` |
| PDF/extraction state | `ready`, 10/10 text pages, 142 blocks |

The page's actual citation authors are Sharan Vaswani, Branislav Kveton, Zheng Wen, Mohammad Ghavamzadeh, Laks V. S. Lakshmanan and Mark Schmidt. Its citation publication date is `2017/07/17` and conference is International Conference on Machine Learning; no DOI or arXiv citation identifier was present. The tested request deliberately omitted unprovided identifiers and retained unknown publication/OA fields; its exact body and publisher evidence are in the adjacent JSON. This is the influence-maximization proceedings paper, with no title inferred from its author slug. The page and source were read directly; see [PMLR publication](https://proceedings.mlr.press/v70/vaswani17a.html). Provider field semantics were checked against [OpenAlex locations](https://help.openalex.org/data/locations/) and [Crossref full-text access documentation](https://www.crossref.org/documentation/retrieve-metadata/text-and-data-mining/).

This live case validates actual public proceedings acquisition, storage, extraction and served bytes. Crossref/OpenAlex/Unpaywall availability for an arbitrary DOI remains provider-dependent; the provider fallback/auth/cooldown cases below are controlled regressions, not claims of live provider availability. The public PDF is retained only in ignored private QA runtime, never added as a production fixture.

## Focused checks

`npm run test -w @fractal/hub -- src/publication/open.test.ts src/scholarly/discovery.test.ts src/library/core.test.ts src/structure/structure.test.ts` passed **85 tests across four files**. The 35 acquisition tests exercise authenticated application HTTP for concurrent identical opens; actual stored/served fixture PDF bytes; separate read/bookmark semantics; saved false/true and legacy keys; nested folders/tags/history; direct, relative/entity and non-extension HTML discovery; rejected ambiguous/supplementary/ungrounded links; no-email Crossref and alternative OpenAlex locations; canonical/versioned arXiv; public/private/looping redirects; signatures/login HTML; HTTP 401/403/404/429/503 distinctions; total timeout with a non-cooperative request; declared and streamed bytes beyond 50 MiB; conflicting provider/publisher/own-PDF DOI and arXiv evidence; existing changed-byte refusal including a missing-local-PDF repair attempt; candidate caps/retry; configured provider authorization and shared quota cooldown; publisher success despite provider outages; and shutdown draining. Existing linking integrity/CAS, reference identity and upload/API compatibility checks also passed in the focused files.

`npm run build -w @fractal/shared`, `npm run typecheck -w @fractal/hub`, `npm run build -w @fractal/hub`, and `git diff --check` passed. No broad unaffected platform matrix was run by this worker.

## Resources and integration boundary

All owned application servers were closed through their exact `ApiServer.close()` handles and their isolated SQLite handles through `store.db.close()`. Test roots under the OS temp directory were removed by scoped fixture cleanup. The baseline/live helper processes exited with code zero: baseline PID 41492; live acquisition PID 43292; provenance verification PID 31900; final fresh-store verification PID 37980. No background helper/service was left running by this worker. Dependency/build/test commands also completed; their generated outputs are ignored.

Public original bytes are retained at `data/qa-pdf-acquisition/publisher-original.pdf` for bounded coordinator transfer. Detailed private runtime evidence is retained at `data/qa-pdf-acquisition/before.json`, `after.json`, the isolated `before-store*`/`after-store*` directories, archived baseline source and the private QA helper script. These paths are ignored. Existing ignored profiles, credentials, user stores and peer processes were preserved. Only the owned source and this public report/JSON are committed. Client navigation/PC/Android acceptance and root integration remain with the coordinator and their owners.
