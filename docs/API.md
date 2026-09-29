# Current HTTP API

The hub listens at `http://127.0.0.1:7327` by default. `GET /` and `GET /index.html` serve the UI with its startup token on loopback; `GET /assets/:name` serves built assets. All JSON responses are `{ "data": ... }` or `{ "error": { "code": string, "message": string, "retryable": boolean } }`. `GET /api/hub/ping` is the minimal unauthenticated readiness check.

For state-changing loopback requests, send `Origin: http://127.0.0.1:7327`, `x-paperread-token: <token from page meta>`, and `Content-Type: application/json`. Loopback origin and host checks remain in place. Login-attempt reads also require the token header. When LAN or Tailscale binding is enabled, every non-loopback request, including reads and static assets, requires `Authorization: Bearer <deviceToken>`, except `GET /api/hub/ping` and the one-time `POST /api/pairing/claim`. Failed remote authentication is limited to ten attempts per IP per minute. The route and response types below are defined in `packages/shared/src/contracts`.

## Desktop pairing and network

| Method and path | Request JSON | `data` response |
| --- | --- | --- |
| `GET /api/hub/ping` | — | `{ "ok": true }` |
| `GET /api/hub/network` | — | `{ "settings": { "lan": boolean, "tailscale": boolean }, "addresses": [{ "address", "kind", "enabled", "url" }] }` |
| `PUT /api/hub/network` | `{ "lan": boolean, "tailscale": boolean }` | Updated network status; listeners change without restarting the hub |
| `POST /api/pairing/start` | `{}` | `{ "session": UUID, "expiresAt": ISO date, "payload": { "v": 1, "name", "hubId", "urls", "code" } }` (201) |
| `GET /api/pairing/qr.svg?session=UUID` | — | Raw SVG QR encoding the payload JSON |
| `POST /api/pairing/claim` | `{ "code": string, "name": string, "platform": string }` | `{ "device": PairedDevice, "deviceToken": string }`; the token appears only in this response |
| `GET /api/pairing/devices` | — | `{ "devices": PairedDevice[] }` |
| `DELETE /api/pairing/devices/:id` | — | `{ "revoked": boolean }` |

Network settings and pairing management routes are loopback only. A pairing code expires after five minutes and is consumed by its first successful claim. `PairedDevice` contains `id`, `name`, `platform`, `createdAt`, and nullable `lastSeen`; the stored record holds only a SHA-256 token hash. The QR advertises enabled LAN and Tailscale URLs. Pairing needs at least one enabled remote interface for another device to connect.

Android v1 uses plain HTTP with a bearer token over LAN or Tailscale. Tailscale traffic is encrypted by WireGuard. On an ordinary LAN, a party able to observe traffic can read the bearer token and API content; use a trusted network or Tailscale. For optional HTTPS through Tailscale, use [`tailscale serve`](https://tailscale.com/kb/1312/serve) to proxy the local hub, then configure the client to use the Serve HTTPS URL after claiming the token. The QR currently advertises direct HTTP interface URLs. The hub does not terminate TLS itself.

| Method and path | Request JSON | `data` response |
| --- | --- | --- |
| `GET /api/connection` | — | `Connection` (`status`, `modelIds`, `defaultModelId`, `limits`) |
| `POST /api/connection/login` | `{}` | `LoginStartResult` (`attempt`, `loginUrl`) |
| `GET /api/connection/login/:id` | — | `LoginAttemptResult` (`attempt`) |
| `POST /api/connection/login/:id/cancel` | `{}` | `LoginAttemptResult` |
| `POST /api/connection/logout` | `{}` | `LogoutResult` (`connection`) |
| `GET /api/papers` | — | `PaperListResult` (`papers: Paper[]`) |
| `POST /api/papers/open` | `{ "input": string }` | `{ "paper": Paper }` after acquisition and extraction |
| `GET /api/papers/:key` | — | `Snapshot` (`paper`, `blocks`, `translations`, `job`) |
| `DELETE /api/papers/:key` | — | `{ "deleted": true }` |
| `GET /api/papers/:key/pdf` | — | Raw `application/pdf` bytes when available |
| `POST /api/papers/:key/translation` | `{ "modelId": string }` | `{ "job": Job }` |
| `POST /api/papers/:key/translation/restart` | `{ "modelId": string, "requestId": UUID, "expectedJobId": string }` | `{ "job": Job }` |
| `GET /api/papers/:key/highlights` | — | `Highlight[]` |
| `POST /api/papers/:key/highlights` | `{ "page": number, "rects": Region[], "text": string, "color"?: "yellow" \| "green" \| "blue" \| "pink" }` | `Highlight` (201) |
| `PATCH /api/papers/:key/highlights/:id` | `{ "note"?: string \| null, "color"?: string }` | `Highlight` |
| `DELETE /api/papers/:key/highlights/:id` | — | `{ "deleted": true }` |
| `GET /api/papers/:key/chat` | — | `ConversationResult` (`conversation`) |
| `POST /api/papers/:key/chat` | `{ "question": string, "modelId": string, "retry"?: boolean }` | `ConversationResult` (202; answer continues in background) |
| `POST /api/papers/:key/chat/cancel` | `{}` | `ConversationResult` |
| `DELETE /api/papers/:key/chat` | — | `ConversationResult` |
| `GET /api/jobs/:id` | — | `{ "job": Job, "translations": Translation[] }` |
| `POST /api/jobs/:id/pause` | `{}` | `{ "job": Job }` |
| `POST /api/jobs/:id/resume` | `{}` | `{ "job": Job }` |

`Paper` includes source identity, title, authors, extraction status, page count, and coverage. `Region` stores page-relative rectangle coordinates. `Job` includes state, progress, pause reason, and usage. IDs in paths are percent encoded by the client. Opening a paper or asking a question may return before its background work finishes; poll the corresponding paper, job, or chat read route.

## AI providers and reading assistance

These routes use the same loopback, Origin, and token guard as the rest of the API. `GET` responses use `{ "data": ... }`. The four generated-answer routes return `text/event-stream`: each frame has `event: delta|done|error` and a JSON `data:` object matching `AiSseEvent`. `delta.text` is appended to the answer; `done.answer` includes text, provider, model, token counts when reported, and duration in milliseconds. Token counts remain `null` when unavailable.

`GET /api/ai/providers` returns exactly this nesting (one entry per provider):

```json
{
  "data": {
    "providers": [
      {
        "status": { "id": "codex", "installed": true, "loggedIn": true, "version": "codex-cli 0.159.0", "detail": "subscription" },
        "models": [{ "id": "gpt-6-sol", "label": "gpt-6-sol", "efforts": ["low", "medium", "high", "xhigh"] }]
      }
    ],
    "settings": { "default": { "provider": "codex", "model": "gpt-6-sol" }, "overrides": {} }
  }
}
```

`status.version` may be `null`; `status.detail` and each model's `efforts` may be absent. The `providers` array also contains a `claude` entry with the same shape. `settings.overrides` may hold `chat`, `translate`, `explain`, and `digest` selections.

| Method and path | Request JSON | Response |
| --- | --- | --- |
| `GET /api/ai/providers` | — | `{ providers: ProviderInfo[], settings: AiSettings }` |
| `PUT /api/ai/settings` | `{ default?: { provider, model, effort? }, overrides?: { chat?, translate?, explain?, digest? } }` | `AiSettings` |
| `GET /api/ai/usage` | — | `{ totals: UsageRecord[], limits: { codex?, claude? } }` grouped by UTC day, provider and model |
| `POST /api/papers/:key/ask` | `{ question, selectedText?, page?, rect?, selection? }` | SSE answer with `[p.N]` page citations |
| `POST /api/papers/:key/explain` | `{ kind: "equation"\|"figure"\|"table"\|"text", page, bbox, croppedPngBase64?, surroundingText?, selection? }` | SSE explanation; `done.latex` when an equation contains `$$...$$` or `\\(...\\)` |
| `POST /api/library/ask` | `{ question, selection? }` | SSE answer using library hits with `[paper:KEY p.N]` citations |
| `POST /api/papers/:key/glossary` | `{ selection? }` | SSE `done.terms` with `{ term, page, definition }[]`; cached by paper content and selection |

`selection` is `{ provider: "codex"|"claude", model: string, effort?: "low"|"medium"|"high"|"xhigh" }`. It overrides the saved feature selection for one request. Normalized boxes use `x`, `y`, `width`, `height` in `[0,1]` and must fit on the page. The provider adapters currently use extracted page text for explanation; `croppedPngBase64` is accepted but not sent to the CLI. Claude model aliases are `opus`, `sonnet`, and `haiku`; full `claude-*` model IDs are also accepted. The legacy `/api/papers/:key/chat` and translation endpoints select their provider through the same registry using their `modelId`.
Explain responses and glossary definitions are requested in concise Korean, with LaTeX formulas, English technical terms in parentheses on first use, and page citations. Paper and library questions are answered in the language of the question.
`Paper` includes source identity, title, authors, extraction status, page count, and coverage. `Region` stores page-relative rectangle coordinates. `Job` includes state, progress, pause reason, and usage. IDs in paths are percent encoded by the client. Questions may return before their background work finishes; poll the chat read route.

## Library, ingest, export, and sync

The same loopback origin and startup token apply to mutations below. `POST /api/papers/upload` additionally accepts `application/pdf` or `multipart/form-data` with one PDF part (maximum 100 MB); the token and Origin headers are still required. Library records contain structured authors, year, venue, DOI, arXiv ID, URL, abstract, tags, collections, timestamps, reading status, and BibTeX key. PDF files are content addressed under the Fractal data directory.

| Method and path | Request | Response `data` or body |
| --- | --- | --- |
| `GET /api/library` | — | `LibraryRecord[]` |
| `GET /api/library/:key` | — | `LibraryRecord` or `null` |
| `PATCH /api/library/:key` | `LibraryPatch` JSON | Updated `LibraryRecord` |
| `DELETE /api/library/:key` | — | Local deletion report |
| `GET /api/library/search?q=&limit=20` | — | `SearchHit[]` with paper key, page, block ID, snippet, BM25 score |
| `GET /api/library/tags` | — | Tag names |
| `POST /api/library/tags` | `{ "name": string }` | Created tag |
| `PATCH /api/library/tags/:name` | `{ "name": string }` | Renamed tag and paper references |
| `DELETE /api/library/tags/:name` | — | Removes tag and paper references |
| `GET /api/library/collections` | — | `{id,name}[]` |
| `POST /api/library/collections` | `{ "id": string, "name": string }` | Created collection |
| `PATCH /api/library/collections/:id` | `{ "name": string }` | Updated collection |
| `DELETE /api/library/collections/:id` | — | Removes collection and paper references |
| `POST /api/papers/upload` | Raw PDF or multipart PDF | `{paper}` (201) |
| `POST /api/papers/open` | `{ "input": arXiv ID, DOI, or URL }` | `{paper}` after acquisition and extraction |
| `GET /api/library/export?format=bibtex\|csl-json&key=:key` | Repeat `key` for selection; omit for all | BibTeX or CSL-JSON bytes |
| `GET /api/papers/:key/export/:format` | `format` is `bibtex`, `csl-json`, or `markdown` | Export bytes; Markdown includes highlights, memos, and completed AI answers |
| `GET /api/papers/:key/annotations` | — | Synced highlight, memo, and ink records |
| `POST /api/papers/:key/annotations` | `Annotation` JSON | `{id, applied, rev}` |
| `GET /api/papers/:key/annotations/:id` | — | `Annotation` or `null` |
| `DELETE /api/papers/:key/annotations/:id` | — | Tombstone result |
| `GET /api/sync/pull?since=0` | Decimal change cursor | `{cursor,papers,annotations}` changed since cursor |
| `POST /api/sync/push` | `{annotations: Annotation[]}` up to 1,000 | `{results:[{id,applied,rev}],cursor}` |
| `GET /api/papers/:key/pdf` | Optional `Range` or `If-None-Match` | PDF bytes, `ETag`, `Accept-Ranges`; 206 partial or 304 cached response |

Annotation conflicts compare `updatedAt` and then `deviceId`; each accepted write increments `rev`. Deletions are tombstones and appear in sync pulls. The cursor is an append-only integer sequence encoded as decimal text. DOI lookup uses Crossref and Unpaywall; set `FRACTAL_CONTACT_EMAIL` to enable the Unpaywall request and identify the client politely.

Malformed input and request schemas return 400 `INVALID_INPUT` with a short Korean message; unsupported upload media returns 415, oversized bodies return 413 `TOO_LARGE`, and failed Crossref or Unpaywall requests return retryable 502 `NETWORK`. Opening a paper waits for acquisition and extraction; the reader shows a busy state until the response arrives.

## Discovery feed

The discovery feed uses the same `{data}` envelope and local mutation guard. `week` is an ISO week such as `2026-W40`; omitted weeks select the current UTC week. A refresh stores a snapshot in SQLite. One failed source leaves the other sections available, and `sourceStatus` reports each source and feed outcome (`ok`, `cached`, `error`, or `disabled`).

| Method and path | Request JSON | `data` response |
| --- | --- | --- |
| `GET /api/feed?week=YYYY-Www` | — | `{week, generatedAt, sections, sourceStatus, digest?}` |
| `GET /api/feed/interests` | — | `{interests, suggestions: [{category, count}]}`; suggestions come from saved arXiv papers' metadata |
| `PUT /api/feed/interests` | `{categories: string[], topics: string[], authors: string[]}` | Saved interests |
| `GET /api/feed/settings` | — | Current feed settings |
| `PUT /api/feed/settings` | `{sources: {arxiv, huggingFace, news, recommendations}, customRssFeeds: string[], digestEnabled: boolean, refreshIntervalHours: number}` | Saved settings; custom feeds require HTTPS, interval is 1–168 hours |
| `POST /api/feed/refresh` | `{}` | Refreshed feed snapshot |
| `GET /api/feed/digest?week=YYYY-Www` | — | `{week, generatedAt, text}` or `null`; opt-in only |
| `POST /api/feed/items/:id/save` | `{}` | `{paperKey}` (201), after the existing URL/DOI/arXiv ingest succeeds |

`sections` contains `top: Item[]`, `byField: {field, items}[]`, `rankings: Item[]`, `news: Item[]`, and `recommended: Item[]`. Each item has `id`, `kind`, `title`, `authors`, trimmed `abstract`, `source`, `url`, nullable `arxivId` and `doi`, `categories`, `publishedAt`, numeric `score`, Korean `reason`, `inLibrary`, and numeric `popularity`. `rankings` lists Hugging Face daily papers by upvotes; `recommended` omits items already saved in the library. Digest generation is off by default and uses the AI provider registry's `digest` selection only when enabled. Schemas are in `packages/shared/src/contracts/feed.ts`.
## Paper structure and references

The hub extracts page-relative figure, table, and display-equation boxes after PDF text extraction. A structure read starts extraction if the saved version is missing or stale. While it runs, the response is HTTP 202 with `status: "running"`; completed and failed reads are HTTP 200. Refresh returns HTTP 202. IDs are stable for one extraction version. Boxes use top-left coordinates in `[0,1]`.

| Method and path | Response `data` |
| --- | --- |
| `GET /api/papers/:key/structure` | `{version,status,items,references,markers}` |
| `POST /api/papers/:key/structure/refresh` | Same shape; starts background re-extraction |
| `GET /api/papers/:key/references/:n` | `{entry,enrichment}`; enrichment is fetched lazily and may be `null` |
| `POST /api/papers/:key/references/:n/add` | `{paper}` (201) via existing DOI, arXiv, or public PDF ingestion |

An item is `{id,kind,page,bbox,label,caption,confidence,latex?,sourceLabel?}`. `kind` is `figure`, `table`, or `equation`; `bbox` has `{x,y,width,height}`. `latex` and `sourceLabel` appear when arXiv source matching succeeds. A reference is `{n,raw,title?,authors?,year?,doi?,arxivId?}`. A marker is `{id,page,bbox,text,references}` where `references` lists linked reference numbers, including expanded numeric ranges. Enrichment has `{title,abstract,year,venue,externalIds,citationCount,openAccessPdf,provider}`. The provider is `semantic-scholar` or `openalex`; nullable fields represent unavailable metadata. Unknown paper keys and reference numbers return 404. Invalid reference numbers and references without an ingestible identifier return Korean `INVALID_INPUT` errors.
Equation LaTeX is attached only when the source math and PDF row pass a similarity threshold; numbered PDF equations also prefer matching source numbers. Reference enrichment is accepted only for a matching DOI or arXiv ID, or for a close title with a compatible year and author. If no candidate passes, enrichment is `null`.
