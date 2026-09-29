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
| `POST /api/papers/open` | `{ "input": string }` | `{ "paper": Paper }`; download/extraction continue in background |
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
