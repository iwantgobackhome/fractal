# Current HTTP API

The hub listens at `http://127.0.0.1:7327`. `GET /` and `GET /index.html` serve the UI with its startup token; `GET /assets/:name` serves built assets. All JSON responses are `{ "data": ... }` or `{ "error": { "code": string, "message": string, "retryable": boolean } }`. There is no separate health endpoint; `GET /api/papers` is a safe readiness check.

For state-changing requests, send `Origin: http://127.0.0.1:7327`, `x-paperread-token: <token from page meta>`, and `Content-Type: application/json`. The hub only accepts loopback hosts and origins. Login-attempt reads also require the token header. The route and response types below are defined in `packages/shared/src/contracts`.

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
