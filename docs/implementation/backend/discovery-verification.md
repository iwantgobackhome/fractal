# Discovery backend verification

Backend owner B, run `run_7b1cfd9aece2`, task `task_92b54f69d95a`. Validation completed on September 30, 2026 UTC, on Windows with Node's real SQLite implementation. This stage adds discovery/related reliability to the accepted foundation and geometry commits; it excludes request 14 and production UI edits.

## Contract and migration

Exact routes, types, error states, date/identity semantics and bounds are in [discovery-contract.md](discovery-contract.md). Publication metadata is optional in existing library/feed/related records. New feed sources are enabled when omitted from old settings; existing explicit switches, categories, custom interests, news and followed topics retain their behavior.

Migration 13 only creates `related_provider_cache` and its migration receipt. It changes no old paper, blob, conversation, annotation, history, folder or bibliography row. Existing v10 fixture coverage in `store/foundation.test.ts` ran against a real SQLite database through migrations 11–13 and retained original PDFs, user metadata, memberships, conversations and annotations; old PDFs still extract geometry on demand. Legacy related cache rows remain intact and may provide stale results when their identity has not subsequently been edited.

Metadata bookmarks do not invoke acquisition. A local PDF link retains the catalog key with explicit `Paper.catalogKey` provenance; it checks own-document metadata identifiers, extracts before writing and commits reader/bibliography/block changes atomically. Incidental cited page-text identifiers are not treated as the PDF's own identity. On transaction failure an unreferenced new blob can remain, but old user rows and PDF references are unchanged. Unsave retains the PDF/history/annotations. Creating new annotations still requires an actual reader, preserving prior annotation semantics.

## Final commands and actual results

All commands below exited 0 on the final revision:

| Command                                | Actual result                                |
| -------------------------------------- | -------------------------------------------- |
| `npm run build -w @fractal/shared`     | TypeScript build passed                      |
| `npm run typecheck -w @fractal/shared` | Passed                                       |
| `npm test -w @fractal/shared`          | 10 tests, 4 files passed                     |
| `npm run build -w @fractal/hub`        | Hub typecheck and bundle build passed        |
| `npm test -w @fractal/hub`             | 166 tests, 24 files passed, about 12 seconds |
| `git diff --check`                     | Passed                                       |

The 28 deterministic discovery regressions cover real field/custom/topic/author queries; journal/conference/preprint coverage; provider/date/OA unknowns; DOI/arXiv/Unicode and transitive dedup; contradictory identifiers/authors/year; ambiguous title/author lookup; metadata-only feed saves; stable bookmark identity; safe legacy/no-ID catalog linking; concurrent PDF dedup and restart; preserved annotations/history/tags/folders; traversal/reserved keys; explicit conflicting document identifiers versus incidental citations; transaction rollback; actual metadata CAS read-event pairing/replay/progress-only edits, equivalent ISO spellings and micro/nanosecond precision; source failure details and stale feed rows; provider serialization/independence; bounded Retry-After and daily reset; caller abort/service shutdown and other-paper related lookup after actual HTTP paper deletion; independent timeout budgets; DOI-miss title fallback; multiple citation/reference/similar edges; empty first-provider cache fallthrough; stale versus fresh empty fallback; provider-specific errors and identity-isolated cache; optional recommendation authentication failure with useful references.

Foundation's 19 tests and original geometry's 12 tests passed within the same full hub run. The repository emits Node's existing experimental SQLite warning; it did not cause failures. Migration-count assertions were updated to include version 13. Existing ingestion metadata tests now use real `Response` fixtures to exercise bounded body reading and shared Crossref throttling.

## Current provider documentation and limited public checks

No paid service or mandatory key was used. Optional `OPENALEX_API_KEY` uses an allowlisted Bearer header, `SEMANTIC_SCHOLAR_API_KEY` uses x-api-key, and `FRACTAL_CONTACT_EMAIL` provides Crossref contact information. Secrets are absent from settings/sync/cache keys/status messages. API redirects are rejected.

OpenAlex currently permits basic anonymous access, with an optional free key increasing the daily budget tenfold; its documented hard rate cap is 100 requests/second. [Current authentication documentation](https://help.openalex.org/api/authentication/) supersedes older announcements implying a mandatory key. The documented daily budget is $0.10 without a key and $1 with a free key; keyword searches consume $1/1,000 calls and list/filter calls $0.10/1,000. [Current example costs](https://help.openalex.org/access/example-costs/) describe singletons as free, but this run's DOI singleton response reported one credit/$0.0001; the implementation respects actual exhaustion/reset headers rather than assuming unlimited singleton access. The current vocabulary includes conference-paper, conference-abstract, reviews and preprints; searches do not require the obsolete proceedings filter. [Current work types](https://help.openalex.org/data/work-types/), [filter syntax](https://help.openalex.org/api/filtering/).

Crossref public metadata needs no credential; mailto enables the polite pool. [Access documentation](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) and its [newer rate-limit announcement](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/) specify public singleton/list limits of 5/1 requests per second and one concurrent request, versus polite 10/3 with three concurrent requests. Fractal conservatively serializes its discovery/related/Crossref-ingest provider traffic at one request/second. Live list and author-query responses reported one request/second, one concurrent request. The older GitHub REST documentation explicitly marks itself deprecated; live query.author and bibliographic queries were verified against the current service.

Semantic Scholar states that most graph endpoints are public under a shared anonymous rate pool, with possible additional throttling, and some endpoints need a key. [Official API overview](https://webflow.semanticscholar.org/product/api), [graph documentation](https://api.semanticscholar.org/api-docs/graph), [recommendation documentation](https://api.semanticscholar.org/api-docs/recommendations). Anonymous graph lookup succeeded here; recommendation permission/outage is handled separately and does not erase useful references. No recommendation success is claimed from the graph-only live check.

[discovery-live-check.json](discovery-live-check.json) records eight anonymous requests at 20:23 and 20:44 UTC: OpenAlex work-types, keyword search, author lookup, author works filter and encoded DOI singleton; Crossref bibliographic and author searches; Semantic Scholar graph lookup. All returned HTTP 200. The file includes request URLs, timestamps, quota headers and small public metadata samples, never credentials. Deterministic fixtures exercise the unavailable/429/auth/timeout conditions; the live service results are a bounded observation, not an availability guarantee.

## Limits and integration

Unknown dates retain null publicationDate; the legacy feed timestamp is marked observed when it is only an observation time. OA PDF URLs are metadata only and are never downloaded by discovery/save/link operations. Provider-reported OA status does not promise access rights or successful future downloads. Crossref links/licenses alone do not invent OA availability.

Title lookup requires ordered normalized title and compatible known identifiers/authors/year, rejects multiple remaining candidates and reports unresolved identity honestly. Author-name following is likewise a bounded lookup, without inventing a unique person from ambiguous results. Related results are bounded samples of references/citations/recommendations rather than an exhaustive citation graph. Query caps and anonymous quotas can limit coverage; provider status retains the actual cause and retry/reset time. Optional recommendation failure returns partial graph data. Stale data keeps the successful cache timestamp, and empty first-provider cache evidence never suppresses a useful fallback.

Desktop C and Android D integrate the published contracts independently. This branch contains only shared/hub/backend documentation changes and is not merged; the final owned commit SHA is reported through the live dispatch completion.
