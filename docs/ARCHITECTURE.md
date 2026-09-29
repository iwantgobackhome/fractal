# Architecture

Fractal is an npm workspaces monorepo. The current app is a loopback-only Node hub and a React browser UI. The desktop and Android app directories are reserved for later tasks.

| Path | Responsibility |
| --- | --- |
| `packages/shared` | TypeScript contracts and Zod schema entry point; domain files under `src/contracts` and future design tokens under `tokens` |
| `packages/hub` | Node HTTP service, paper acquisition, PDF extraction, file storage, translation jobs, Codex CLI session, and chat |
| `packages/ui` | React reader, PDF display, annotations, translation and chat UI; Vite builds `dist` |
| `apps/desktop` | Future personal desktop shell for the hub and UI |
| `apps/android` | Future Kotlin client |

## Current data flow

1. `npm run build` builds shared declarations and the UI, then typechecks the hub. `npm run hub` starts the hub on `127.0.0.1:7327` and serves `packages/ui/dist` directly.
2. The hub injects a startup token into the UI HTML. The browser calls `/api/*` on the same loopback host. State-changing calls carry the token in `x-paperread-token` and a loopback `Origin`.
3. The hub resolves arXiv IDs or public publication URLs, downloads and extracts the PDF, then stores the paper and blocks in the existing PaperRead data directory. The UI polls paper and job state and reads the saved PDF.
4. Translation and questions use the official Codex CLI app server with an app-owned `.codex-home`. The hub persists translations, highlights, chat, and job state. Credentials stay in that app-owned directory.

`npm run dev` starts the hub and Vite together. Vite proxies `/api` to the hub and receives the hub's startup token for its dev page.

## Planned connections

The desktop shell will host this personal hub. A native Android client will later use pairing to receive connection details and a bearer credential, then sync library data and annotations over LAN or Tailscale. The `pairing`, `sync`, `ink`, `feed`, and `structure` contracts are typed placeholders for their future owners; they are not live APIs yet.

The original PaperRead file storage path and HTTP credential names remain in use so existing local data and browser behavior remain compatible.
