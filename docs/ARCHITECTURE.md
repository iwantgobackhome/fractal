# Architecture

Fractal is an npm workspaces monorepo. The Node hub and React browser UI run inside the Electron desktop shell or as a headless service. Android is reserved for a later task.

| Path | Responsibility |
| --- | --- |
| `packages/shared` | TypeScript contracts and Zod schema entry point; domain files under `src/contracts` and future design tokens under `tokens` |
| `packages/hub` | Node HTTP service, paper acquisition, PDF extraction, file storage, translation jobs, Codex CLI session, and chat |
| `packages/ui` | React reader, PDF display, annotations, translation and chat UI; Vite builds `dist` |
| `apps/desktop` | Electron window and tray, embedding the hub in-process |
| `apps/android` | Future Kotlin client |

## Current data flow

1. `npm run build` builds shared declarations and the UI, then typechecks the hub. `npm run hub` starts the hub on `127.0.0.1:7327` and serves `packages/ui/dist` directly.
2. The hub injects a startup token into the UI HTML. The browser calls `/api/*` on the same loopback host. State-changing calls carry the token in `x-paperread-token` and a loopback `Origin`.
3. The hub resolves arXiv IDs or public publication URLs, downloads and extracts the PDF, then stores the paper and blocks in the existing PaperRead data directory. The UI polls paper and job state and reads the saved PDF.
4. Translation and questions use the official Codex CLI app server with an app-owned `.codex-home`. The hub persists translations, highlights, chat, and job state. Credentials stay in that app-owned directory.

`npm run dev` starts the hub and Vite together. Vite proxies `/api` to the hub and receives the hub's startup token for its dev page.

## Desktop, pairing, and transport

`startHub()` embeds the hub in Electron and returns its URL and a close method. The desktop process owns the hub lifetime; minimizing or closing the window hides it in the tray. `--headless` starts the same hub without a window. The local UI retains its startup token and loopback origin guard.

The network manager stores interface settings in `network-settings.json`, discovers private LAN and Tailscale IPv4 addresses, and adds or removes HTTP listeners without restarting jobs or storage. Loopback always remains available. The pairing manager mints a one-time five-minute code and QR payload; `JsonDeviceStore` persists device metadata and SHA-256 hashes of 32-byte bearer tokens in `paired-devices.json`. This narrow store interface can be replaced with SQLite during integration. Remote requests are authenticated before routing, including static files, with the ping and claim exceptions described in the API document.

Android v1 uses HTTP with a bearer token. Tailscale provides WireGuard encryption; ordinary LAN HTTP exposes the token and content to observers on that network. `tailscale serve` can provide an optional HTTPS proxy. TLS is not implemented in the hub.

## Planned connections

A native Android client will use pairing to receive connection details and a bearer credential, then sync library data and annotations over LAN or Tailscale. The `sync`, `ink`, `feed`, and `structure` contracts remain typed placeholders for their future owners.

The original PaperRead file storage path and HTTP credential names remain in use so existing local data and browser behavior remain compatible.
