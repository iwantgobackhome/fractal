# Disposable native QA Hub protocol

Owner: E native bridge dispatch `ctx_15e644efb575`. Production source is accepted
`56230ad52493bff69f6905cd87caaa5a6743b8b2`, including B correction `5dad1b3`.
This harness adds no production routes. Its proxy forwards real HTTP requests to
the real accepted `createApiServer`, SQLite store, provider registry and history
service. Only the separate loopback control listener supplies test controls.

- API base: `http://127.0.0.1:6174`.
- QA control base: `http://127.0.0.1:6175`.
- D fixture: `D-reader-catalog`, title `D native lifecycle fixture`, five pages.
- E fixture: `qa-reader-catalog`, title `Reader HTTP bridge fixture`, five pages.
- PDF bytes: accepted `packages/hub/test/fixtures/text-layout.pdf`, SHA256
  `f79b45a88b17b236ade1298edf4cafdceae6a9f19907eb29126332a7c9037b96`.
- D credentials: ignored absolute file
  `C:/Users/Home/orca/workspaces/fractal/fractal-reader-qa/docs/implementation/qa/native-bridge/runtime/D-private.json`.
  Fields: `baseUrl`, `port`, `controlPort`, `deviceId`, `deviceToken`, `paperKey`,
  `pdfSha256`. Never print or commit credentials. E has its separate `E-private.json`.

D owns device 5554 and sets its own reverse. E issues adb commands only with
`-s emulator-5560`. D may write only its designated D fixture and release only
its D-prefixed flights; E exclusively owns server lifecycle and E controls.
Each fixture has extracted stable blocks plus completed translations with model
`gpt-6-sol` and the accepted English translation prompt version. Translated text
is ordinary text; this harness creates no translated coordinate anchors.

Root clarification `msg_da8210e82a5e` also authorizes D to create/delete uniquely
`D-` prefixed folders through D's own paired native queue, with memberships only
on `D-reader-catalog`. D must not edit E folders, E fixture or other papers.
The passed E bridge supplies the foundation folder matrix; D need only exercise
remaining reader integration risks.

Normal Bearer requests use the accepted routes and envelopes:

- `GET /api/papers/D-reader-catalog`: `{data:{paper,blocks,translations,job}}`.
- `GET /api/papers/D-reader-catalog/pdf`: actual PDF bytes.
- `GET /api/papers/D-reader-catalog/text-layout?page=2`: `{data:PdfTextLayout}`;
  layout `extractionVersion` is separate from `paper.extractionVersion`.
- `POST /api/papers/D-reader-catalog/ask`: question, physical `page`, optional
  `selectedText`, `rect`, provider/model, and immutable `requestId`.
- `POST /api/papers/D-reader-catalog/explain`: `kind`, physical `page`, `bbox`,
  `surroundingText`, provider/model and `requestId`.
- Generation returns SSE `delta`/`done`/`error` event JSON with `historyId`.
- `GET /api/papers/D-reader-catalog/history`: `{data:{history:[...]}}`.
- `GET /api/papers/D-reader-catalog/history/:id`: `{data:{history:entry}}`.
- `POST /api/papers/D-reader-catalog/history/:id/cancel`, JSON `{}`: explicit
  durable cancel. Closing an observer does not cancel generation.

For deterministic provider behavior, include a unique marker such as
`D-FLIGHT-reopen-1 QA_WAIT` in the question or explanation `surroundingText`.
The provider emits a prefix, then waits. Add `QA_ERROR` to make it throw a
retryable NETWORK fixture error after release; omit `QA_WAIT` for immediate
success/error. Never reuse a flight ID for another generation. Model selection
uses `gpt-6-sol`; no real provider CLI or account is invoked.

`GET http://127.0.0.1:6175/D/state` returns
`{data:{flights,providerCalls,library,history}}`. Waiting flights have
`{id,status:"waiting"}`. Release exactly one through
`POST http://127.0.0.1:6175/D/release`, JSON
`{"flightId":"D-FLIGHT-reopen-1"}`. Wrong owner or absent waiting flight returns
400. Control calls require no Bearer token and are bound only to loopback.

E-only controls `POST /E/drop-next-push` and `POST /E/conflict-next-push` use `{}`.
The first commits one real E paper push, then drops its response; OkHttp may
transparently retry. The second introduces a concurrent server tag mutation
after the next pull response snapshot, forcing a real stale-revision conflict.
These controls do not change D fixtures or D flight controls.

E writes `runtime/stop` only after D finishes or an explicit clean ownership
handoff. The server then closes accepted Hub flights, both listeners and SQLite,
and writes `runtime/final-state.json`. Before reuse/cleanup check
`runtime/server-identity.json` and the exact process executable, start identity,
command line and listener ownership. A numerical PID alone is insufficient.

At this bridge settlement root explicitly accepts interim lifecycle ownership
under `msg_be89ebafd93b`, then transfers it to the next independent QA dispatch.
The current E worker leaves the Hub running for D; it already stopped only its
own verified5560.
