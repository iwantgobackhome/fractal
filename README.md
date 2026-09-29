# Fractal

Fractal is a local paper reader built from [PaperRead](https://github.com/nkjunbc/PaperRead). It shows the source PDF beside a Korean translation and supports questions about the paper through the user's Codex CLI subscription.

## Run

Requires Node.js 22.12 or newer and npm. Install the Codex CLI for account, translation, and question features.

```sh
npm ci
npm run build
npm run hub
```

Open <http://127.0.0.1:7327/>. The hub keeps existing PaperRead data in `%LOCALAPPDATA%\PaperRead` on Windows or `${XDG_DATA_HOME:-~/.local/share}/paperread` elsewhere. Set `PAPERREAD_DATA` to choose another data directory. Sign in through the page's account menu.

For development, run `npm run dev` and open <http://127.0.0.1:5173/>. `npm test` and `npm run typecheck` check all workspaces.

See [architecture](docs/ARCHITECTURE.md), [HTTP API](docs/API.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
