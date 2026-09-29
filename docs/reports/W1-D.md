# W1-D — Desktop, network binding, and pairing

## Summary

- Added the embeddable `startHub(options)` API, with port, data directory, bind address options, a URL, and `close()`. The `@fractal/hub` package now builds a Node 22 ESM entry and its PDF worker. The headless `npm run hub` entry still works.
- Added an Electron shell with a single-instance lock, secure BrowserWindow settings, hub-origin navigation, OS external links, Open / Pairing / Quit tray actions, minimize-to-tray, and `--headless` mode. The Windows NSIS installer was built successfully; macOS DMG configuration is present.
- Added persisted LAN/Tailscale binding settings, auto-detection, listener changes without process restart, five-minute one-time pairing, SHA-256-hashed device tokens, revocation, remote bearer enforcement, and per-IP failed-auth rate limits.
- Added Zod wire contracts, unit and in-process route tests, and API/architecture documentation.

## Endpoints

| Endpoint | Access | Result |
| --- | --- | --- |
| `GET /api/hub/ping` | Public | `{ok:true}` |
| `GET /api/hub/network` | Loopback | Settings and detected addresses |
| `PUT /api/hub/network` | Loopback | Update `{lan,tailscale}` and rebind listeners |
| `POST /api/pairing/start` | Loopback | One-time code, expiry, QR payload, session ID |
| `GET /api/pairing/qr.svg?session=` | Loopback | QR payload as SVG |
| `POST /api/pairing/claim` | Pairing code | Device and one-time plaintext token response |
| `GET /api/pairing/devices` | Loopback | Device metadata |
| `DELETE /api/pairing/devices/:id` | Loopback | Revoke token |

All other requests from non-loopback peers require a valid device bearer token, including GETs and static assets. The claim and ping routes are the deliberate exceptions. The local UI retains its startup token, Origin, and Host checks.

## Acceptance output

```text
> npm ci
added 372 packages, and audited 376 packages in 8s
2 moderate severity vulnerabilities

> npm run build
@fractal/shared: tsc -p tsconfig.json
@fractal/ui: vite build — ✓ built in 4.38s
@fractal/hub: tsc --noEmit -p tsconfig.json; node ../../scripts/build-hub.mjs
Exit code: 0

> npm test
@fractal/shared: Test Files 1 passed; Tests 1 passed
@fractal/hub:    Test Files 5 passed; Tests 8 passed
@fractal/ui:     Test Files 1 passed; Tests 2 passed
Exit code: 0

> npm run typecheck
@fractal/shared: tsc --noEmit -p tsconfig.json
@fractal/hub:    tsc --noEmit -p tsconfig.json
@fractal/ui:     tsc --noEmit -p tsconfig.json
Exit code: 0

> npm run hub
{"event":"service.ready","url":"http://127.0.0.1:17329","dataDirectory":".../data/w1d-hub-smoke"}
GET / -> HTTP 200 content_type=text/html; charset=utf-8
{"data":{"papers":[]}} HTTP 200
```

`npm run desktop` opened the UI at `http://127.0.0.1:6421`; [desktop screenshot](W1-D-desktop.png). The window was closed afterwards. `electron . --headless` logged `{"event":"desktop.ready","url":"http://127.0.0.1:7023","headless":true}` and `GET /api/papers` returned `{"data":{"papers":[]}} HTTP 200`; that process was closed. The packaged `Fractal.exe --headless` also served `GET /api/papers` with HTTP 200 and was closed.

LAN check on this PC's physical `192.168.55.80` interface, after enabling LAN and claiming a token:

```text
> curl.exe --noproxy '*' -sS -w '\nHTTP %{http_code}' http://192.168.55.80:17328/api/papers
{"error":{"code":"AUTH_REQUIRED","message":"A paired device token is required","retryable":false}}
HTTP 401

> curl.exe --noproxy '*' -sS -w '\nHTTP %{http_code}' -H 'Authorization: Bearer <redacted>' http://192.168.55.80:17328/api/papers
{"data":{"papers":[]}}
HTTP 200
```

The same manual run returned 401 for the remote static entry without a token, 200 for the unauthenticated ping, and 200 for a code claim. The temporary server was stopped.

Installer: `dist/installer/Fractal Setup 0.1.0.exe`, **113,472,202 bytes** (108.2 MiB). The generated installer is ignored by Git and remains in this worktree.

## Decisions

- Loopback is always bound. LAN mode binds detected RFC 1918 IPv4 addresses; Tailscale mode binds detected 100.64.0.0/10 addresses. Tailscale CLI output is a fallback when interface enumeration misses its address.
- The device record is isolated behind a tiny `DeviceStore` interface in `packages/hub/src/pairing/store.ts`; JSON is used until the storage worker's SQLite integration.
- A proxied request carrying a public Host is treated as a remote device request even if its TCP peer is loopback. This permits a local `tailscale serve` proxy without exposing the local UI startup credential.
- A new pairing session replaces the previous unclaimed session. Successful claim consumes its code immediately.
- The QR payload advertises enabled direct HTTP interface URLs. A client using optional `tailscale serve` HTTPS must switch to that HTTPS URL after claiming.

## Known gaps and integration notes

- Ordinary LAN HTTP exposes the bearer token and content to network observers. Tailscale carries the HTTP traffic inside WireGuard. The hub has no TLS terminator; optional `tailscale serve` setup is documented in `docs/API.md`.
- The UI worker should add pairing and network controls against these endpoints; no `packages/ui` files were changed. Until then, network settings can be changed through the loopback API, and the tray Pairing action opens the QR window.
- The storage worker can replace `JsonDeviceStore` with SQLite by implementing `DeviceStore`; preserve the existing `hubId`, metadata, SHA-256 hashes, and revocation semantics when migrating.
- The dependency install reported two moderate npm audit findings. They did not fail build or tests and were not changed as part of this domain task.
