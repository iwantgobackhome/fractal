# W4-H — Hub CLI login, language preferences, and desktop PDF bridge

## Delivered

- Codex app-server now inherits the user's CLI `CODEX_HOME` selection (or its default), so its `account/read` reflects `codex login`. The former app-owned `.codex-home` is untouched. The Hub no longer exposes login, login polling, cancel-login, or logout routes, and no longer constructs `AccountAuthenticator`. Provider status includes `loginCommand` for Codex and Claude.
- The Codex launch sanitizes the environment, disables each discovered MCP server with verified CLI overrides, disables app and plugin features, web search, shell, hooks, multi-agent behavior, memories, goals, and skill instructions, and selects the OpenAI provider. It refuses a user `config.toml` that declares custom instructions. Generation still requires the existing structural `runtimeSafety` proof: an empty scratch cwd, read-only sandbox, no approvals, `environments: []`, `dynamicTools: []`, and ephemeral threads. Translation threads now supply their own `baseInstructions`; question threads already did. Tool or file activity still fails with `UNSAFE_RUNTIME`.
- Added SQLite migration 6 and guarded `GET/PUT /api/preferences`. UI, translation, and answer languages plus onboarding completion persist. Translation prompts preserve the Korean rules and add faithful rules for other BCP 47 languages. The language is part of the translation identity; switching back reuses completed results in either language. AI answers and weekly digests follow `answerLanguage`; errors and feed reasons follow `uiLanguage`, with stable error codes and feed `reasonCode`/`reasonParams`.
- Electron preload exposes `window.fractalDesktop.savePdf({ suggestedName })`. The main process prints the calling window with backgrounds and CSS page sizes, shows a PDF save dialog, and writes the chosen file. Renderer sandboxing and context isolation remain enabled.
- Updated [API documentation](../API.md). The old `<data>/.codex-home` can be removed by the user after upgrading; Fractal leaves it untouched.

## Live Codex evidence on this PC

Ran `npx tsx scripts/w4-live.ts` against a temporary Hub data directory and a locally seeded excerpt of *Attention Is All You Need* (arXiv 1706.03762v5). This uses the user's CLI login without reading credential files. The script exercises the HTTP endpoints and removes its temporary data afterward.

| Check | Observed result |
| --- | --- |
| `codex login status` | `Logged in using ChatGPT` |
| `GET /api/ai/providers` | Codex `loggedIn: true`, `detail: subscription`, `version: codex-cli 0.159.0` |
| `POST /api/papers/1706.03762v5/ask` | HTTP 200 SSE completion with model `gpt-6-sol`: “The Transformer consists of an **encoder** and a **decoder**. [p.1]” |
| `POST /api/papers/1706.03762v5/translation`, then job polling | `completed`, model `gpt-6-sol`; the page paragraph was translated into Korean, beginning “트랜스포머(Transformer)는 적층된 자기 주의(self-attention) 계층과 완전 연결 계층(fully connected layers)을 사용하는 인코더-디코더(encoder-decoder) 구조를 따른다.” |

## Verification

- `npm ci` — pass
- `npm run build` — pass
- `npm test` — pass (shared 1, Hub 65, UI 15 tests)
- `npm run typecheck` — pass
- `npm run e2e` — pass (8 browser checks)
- `npm run format:check` — pass
- Added tests for CLI home and unsafe user configuration with MCP/custom instructions, preference HTTP and SQLite round trips/defaults, language-aware prompt identity and cache reuse, and localized errors.
