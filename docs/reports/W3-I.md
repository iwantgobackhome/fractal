# W3-I integration report

## Changes

- The shared ink schema now preserves optional Android `brush`, `shape`, and point-aligned `tilt` values. A SQLite route test writes a stroke through `POST /api/papers/:key/annotations` and reads those fields through both the annotation GET route and `GET /api/sync/pull`.
- PDF reads now compare `If-Range` with the current ETag. Matching ETags return the requested 206 range; stale ETags return 200 with the complete PDF. Route tests cover both cases.
- The SQLite paper-open route now recognizes an existing stored paper key. This was necessary for the library and direct `#/paper/<key>` reader flow after PDF upload; DOI and URL inputs still use ingestion.
- Added `npm run e2e` using `playwright-core` and the installed Microsoft Edge (`channel: 'msedge'`, headless). It starts an isolated in-process hub, uploads a generated PDF over HTTP, and uses fake provider and chat implementations. No CLI or external service is called.
- Replaced the root README with concise Korean setup, data, Android pairing, privacy, and troubleshooting instructions. Updated architecture and API documentation to reflect Android, feed, FTS search, ink metadata, and `If-Range`.

## Acceptance output

Windows 11, Node 22.23.1. Commands ran from `w3-integration`; the build was repeated after the final code edit.

```text
> npm ci
added 376 packages, and audited 380 packages in 16s
2 moderate severity vulnerabilities
exit 0

> npm run build
@fractal/shared: tsc -p tsconfig.json
@fractal/ui: vite build, 84 modules transformed, built in 4.54s
@fractal/hub: tsc --noEmit -p tsconfig.json; build-hub.mjs
exit 0

> npm test
@fractal/shared: 1 test passed
@fractal/hub: 57 tests passed
@fractal/ui: 15 tests passed
exit 0

> npm run typecheck
@fractal/shared, @fractal/hub, @fractal/ui: tsc --noEmit
exit 0

> npm run e2e
PASS home renders
PASS library lists uploaded paper
PASS reader draws page 1
PASS drag opens selection menu
PASS highlight is visible and persisted through API
PASS memo saves and appears in notes
PASS question renders stub answer and page reference
PASS settings providers and dark theme
exit 0
```

The UI build emitted its existing large chunk warning. Node emitted its existing experimental SQLite warning. The e2e closes Edge and the in-process hub in `finally`, and removes its temporary data directory.

## Desktop and installer

`npm run desktop -- --remote-debugging-port=19433` opened the current Electron UI with isolated temporary Fractal data. The home screenshot was captured through Electron; the reader screenshot was captured from the same Electron window after uploading a generated PDF. Both images were inspected. The app was stopped afterward, and its CDP port closed.

- [Home screenshot](W3-desktop.png)
- [Reader screenshot](W3-reader.png)
- Installer: `dist/installer/Fractal Setup 0.1.0.exe`, **116,673,027 bytes** (111.3 MiB), built by `npm run desktop:dist` from the final code.
- Installer SHA-256: `9A6AFBF2F9FF555CDC9AA396CD7A30A76E19D71443C0B9FC52028919EA6C48A2`.

The installer is ignored by Git and remains in this worktree. Screenshots and this report are committed.

## Decisions and remaining checks

- The e2e starts the API with SQLite storage and built UI assets. It omits the live discovery feed, so home exercises its empty state without external network requests. Fake Codex and Claude provider entries populate settings; a fake legacy chat answer supplies `[p.1]` for the citation check.
- A Windows user should install the generated NSIS package and verify the actual Codex or Claude login flow. The fake provider tests deliberately do not exercise real accounts. macOS packaging and physical Galaxy Tab pen behavior were outside this Windows integration run.
