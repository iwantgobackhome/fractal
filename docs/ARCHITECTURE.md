# Architecture

Fractal is an npm workspaces monorepo. The Node hub and React browser UI run inside the Electron desktop shell or as a headless service. The Kotlin Android app pairs with the hub for reading and sync.

| Path | Responsibility |
| --- | --- |
| `packages/shared` | TypeScript contracts, Zod schemas, and shared design tokens |
| `packages/hub` | Node HTTP service, paper acquisition, PDF extraction, SQLite library storage, sync, translation jobs, Codex CLI session, and chat |
| `packages/ui` | React reader, PDF display, annotations, translation and chat UI; Vite builds `dist` |
| `apps/desktop` | Electron window and tray, embedding the hub in-process |
| `apps/android` | Kotlin reader, PDF cache, ink, pairing, and sync |

## Current data flow

1. `npm run build` builds shared declarations and the UI, then typechecks the hub. `npm run hub` starts the hub on `127.0.0.1:7327` and serves `packages/ui/dist` directly.
2. The hub injects a startup token into the UI HTML. The browser calls `/api/*` on the same loopback host. State-changing calls carry the token in `x-paperread-token` and a loopback `Origin`.
3. The hub resolves arXiv IDs, DOI links, or public publication URLs, or accepts a PDF upload. It extracts the PDF and stores metadata and blocks in SQLite under the Fractal data directory. The UI reads paper and job state and the saved PDF.
4. Translation and questions use the official Codex CLI app server with an app-owned `.codex-home`. The hub persists translations, highlights, chat, and job state. Credentials stay in that app-owned directory.

`npm run dev` starts the hub and Vite together. Vite proxies `/api` to the hub and receives the hub's startup token for its dev page.

## Desktop, pairing, and transport

`startHub()` embeds the hub in Electron and returns its URL and a close method. The desktop process owns the hub lifetime; minimizing or closing the window hides it in the tray. `--headless` starts the same hub without a window. The local UI retains its startup token and loopback origin guard.

The network manager stores interface settings in `network-settings.json`, discovers private LAN and Tailscale IPv4 addresses, and adds or removes HTTP listeners without restarting jobs or storage. Loopback always remains available. The pairing manager mints a one-time five-minute code and QR payload; `JsonDeviceStore` persists device metadata and SHA-256 hashes of 32-byte bearer tokens in `paired-devices.json`. This narrow store interface can be replaced with SQLite during integration. Remote requests are authenticated before routing, including static files, with the ping and claim exceptions described in the API document.

Android v1 uses HTTP with a bearer token. Tailscale provides WireGuard encryption; ordinary LAN HTTP exposes the token and content to observers on that network. `tailscale serve` can provide an optional HTTPS proxy. TLS is not implemented in the hub.

## Android connection

The Android client claims a pairing code, stores its bearer credential with Android Keystore protection, caches PDFs, and syncs library and annotations over LAN or Tailscale. Ink strokes preserve optional brush, shape, and tilt data through the hub's annotation and sync routes. The HTTP credential header name remains compatible with PaperRead; PaperRead files are imported into the Fractal data directory on first startup.

## AI provider routing

The hub's `ai/` layer wraps the isolated Codex app-server question path and a headless Claude CLI process behind one streaming provider interface. `ProviderRegistry` resolves saved defaults and per-feature overrides, records UTC daily usage in `ai-usage.json`, and exposes best-effort provider limits. `settings.json` holds the small provider settings record. Both files live in the hub data directory, separate from paper records. `RegistryLegacyAdapter` keeps existing chat and translation endpoints on the same selection path: Codex calls delegate directly to their original methods, while Claude uses the same Korean translation prompts and validators from `translation/prompt.ts`. The AI route module performs input validation and streams SSE frames; production library questions use SQLite FTS search over stored papers and blocks.

The HTTP credential name remains compatible with the browser. PaperRead data is imported once into the new Fractal directory without altering its source files.

## Paper structure

`structure/` turns PDF.js extraction blocks into caption-paired figure and table boxes, display-equation boxes, bibliography entries, and in-text numeric citation markers. `StructureDetector` is the implementation boundary; `PdfJsStructureDetector` currently supplies it. A later Docling adapter can implement the same `detect(bytes, paperKey, blocks?)` method, invoke the configured Python environment from a bounded child process, and convert Docling coordinates into top-left normalized boxes. The Node hub has no Python dependency today.

The SQLite migration adds versioned structure state, items, references, markers, and two enrichment caches. Saving extracted blocks schedules detection without holding up ingest. Reads can also schedule it, and refresh forces a new pass. arXiv source enrichment downloads at most 20 MB, reads only `.tex` members from a tar/gzip archive in memory, and caches fragments per revision. Reference details are fetched only when requested, first from Semantic Scholar and then OpenAlex, with a shared request interval and cached results. No archive member is written or executed.

Equation matching joins right-margin PDF equation numbers, source environment numbering, and normalized math-symbol similarity. It only attaches a one-to-one source match above the confidence threshold. Reference candidates from both providers are validated against identifiers or title, year, and author metadata before caching; cache versions isolate earlier unvalidated results.

## Library storage and sync

The hub opens `%LOCALAPPDATA%/Fractal` on Windows or `$XDG_DATA_HOME/fractal` on Unix; `FRACTAL_DATA` overrides it. `node:sqlite` holds paper snapshots, blocks, translations, jobs, bibliography, collections, tags, annotations, conversations, a migration ledger, and an append-only change log. PDFs are files named by SHA-256 under `pdfs/`. On first startup it imports verified records from the old PaperRead directory, including highlights. FTS5 indexes bibliography fields and extracted block text.

The API has separate library, annotation, and sync route modules. URL and upload ingestion converge on DOI, arXiv ID, or PDF hash to merge existing papers. A sync pull reads the change log after a cursor; pushes use last-writer-wins by timestamp and device ID while retaining tombstones. Reader routes still call the same store methods, now backed by SQLite.

## Discovery feed

`feed/` owns the weekly discovery pipeline. Injectable source adapters read arXiv Atom, Hugging Face Daily Papers, RSS/Atom news, and Semantic Scholar recommendations. A SQLite HTTP cache sends `If-None-Match` and `If-Modified-Since` for conditional GETs. Source and subfeed failures are recorded without discarding successful results. The service deduplicates by arXiv ID, DOI, or normalized title, then ranks with interest term frequency, category/author matches, recency, and popularity. SQLite migration 3 adds interests/settings metadata, weekly items, fetch state, and digests. A refresh starts when the current week is stale and repeats at the configured interval; shutdown waits for an active refresh. The optional Korean digest uses the provider registry's `digest` feature once per week and is never called while opt-in is off. `api/routes/feed.ts` exposes the stored snapshot and mutations; saving an item goes through existing ingest.
