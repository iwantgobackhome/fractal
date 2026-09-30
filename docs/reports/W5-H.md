# W5-H live verification

Checked on this PC on 2026-09-30 (Asia/Seoul). The reproducible probe is `npx tsx scripts/w5-live.ts <limits|claude-limits|feed|related>`; it uses a temporary Hub data directory and removes it afterward. It never opens CLI credential files.

## CLI and quota evidence

Installed CLIs: `codex-cli 0.159.0` and Claude Code `2.1.285`. `codex login --help` confirms `--device-auth`; `claude auth login --help` confirms the subscription login command. Setting `CLAUDE_CONFIG_DIR` to an empty temporary path made `claude auth status` report that path as `configDirectory` and `loggedIn: false`, confirming managed home isolation.

`GET /api/ai/limits` returned HTTP 200 for the logged-in system accounts:

| Provider | 5-hour used | 5-hour reset (UTC) | Weekly used | Weekly reset (UTC) | State |
| --- | ---: | --- | ---: | --- | --- |
| Codex | unavailable (`null`) | `null` | 15% | 2026-10-06 15:57:33 | `ok` |
| Claude Pro | 20% | 2026-09-30 06:50:00 | 28% | 2026-10-03 13:00:00 | `ok` |

Codex's `account/rateLimits/read` provided a weekly window but no 300-minute window at the time of the observation, so the API retained `fiveHour: null`. Its `resetsAt` epoch seconds were converted to ISO UTC. A Fractal Claude call completed with `delta`, `delta`, `done` SSE events and did not emit a `rate_limit_event` in the CLI stream. The official interactive `/usage` screen, driven through a Windows PTY, showed “Current session” 20% used and “Current week (all models)” 28% used, with the reset times above. The screen reported 0 input and 0 output for that PTY session, so the quota read itself did not spend a model turn. The Hub first accepts passive `rate_limit_info` events when present and falls back to this screen; if the Node PTY or the screen is unavailable, the API reports `unavailable` rather than inventing numbers.

## Feed evidence

With category `cs.LG` and custom interest `{id: "w5-custom", label: "Graph neural networks", query: "graph neural networks"}`, `POST /api/feed/refresh` returned HTTP 200 for `2026-W40`. The custom `byField` section contained 20 papers. `newsByField` contained 20 `cs.LG` items and 11 `custom:w5-custom` items. The displayed `top` and `news` sections held 50 items; 46 had proxied Hub image URLs. arXiv category and custom searches, five AI lab feeds, Google News searches in Korean and English, and Bing News searches all reported `ok`; Hugging Face and recommendations were intentionally disabled for this probe.

The official [arXiv category taxonomy](https://arxiv.org/category_taxonomy) had 146 dotted categories plus nine standalone physics archives when checked, for 155 exported categories. Google News RSS, Bing News RSS, and Nature's physics RSS returned HTTP 200 on this PC. Bing RSS included `News:Image` thumbnails; Google News search broadened field coverage. The Hub also uses arXiv HTML figures and article `og:image` when available. Image bytes are served from the local proxy after public HTTPS, DNS, media type, and size checks.

## Related paper evidence

`GET /api/papers/1706.03762v1/related` returned HTTP 200, `source: "semanticScholar"`, and 30 merged items: 15 references (`cites`) and 15 citations (`citedBy`). The single-paper recommendations endpoint returned an empty `recommendedPapers` list for this paper on this PC; the [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs) supplied references and citations. The result is cached in SQLite for seven days.

## Implementation choices

Custom labels with an empty search query fall back to the label itself; users can edit the English query. The Hub uses the requested `{field, label?, items}` section shapes and assigns stable custom IDs. There is no general AI usage event stream in this Hub, so the UI polls `/api/ai/limits` every 60 seconds. A managed Codex account uses `CODEX_HOME`; a managed Claude account uses `CLAUDE_CONFIG_DIR`. System accounts preserve existing CLI login behavior. Account switches abort translation work, wait for registry calls to settle, and close the Codex runtime before activating the new home.

## Verification

`npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run e2e`, and `npm run format:check` all passed. Tests cover quota window mapping and absent windows, fake CLI account lifecycle and environment selection, legacy interests and custom query building, news image formats, public image proxy guards, and related-paper merge and cache behavior. The unchanged desktop e2e stubs passed.

## PTY packaging review (2026-09-30)

The Claude `/usage` reader now uses `@lydell/node-pty` with its Windows prebuilt native binary. It sends only `/usage` to the interactive CLI and parses the two subscription windows; it does not send a model prompt. The Hub preserves the `unavailable` state when the PTY or screen fails. Codex maps primary and secondary windows by duration ranges: 240–360 minutes for five hours and 9000–11000 minutes for weekly.

`npm run desktop:dist` produced the NSIS installer and `win-unpacked` app. The archive contains the PTY JavaScript package and the Windows native binary is in `app.asar.unpacked`. I launched only `win-unpacked/Fractal.exe --headless` with a temporary `FRACTAL_DATA` and a separate `--user-data-dir`; the existing Fractal process was left running. `GET /api/ai/limits` returned HTTP 200:

| Runtime | Provider | 5-hour used | 5-hour reset (UTC) | Weekly used | Weekly reset (UTC) | State |
| --- | --- | ---: | --- | ---: | --- | --- |
| `npm run hub` | Claude Pro | 23% | 2026-09-30 06:50:00 | 28% | 2026-10-03 13:00:00 | `ok` |
| `npm run hub` | Codex | `null` | `null` | 16% | 2026-10-06 15:57:33 | `ok` |
| Unpacked Electron | Claude Pro | 21% | 2026-09-30 06:49:00 | 29% | 2026-10-03 12:59:00 | `ok` |
| Unpacked Electron | Codex | `null` | `null` | 16% | 2026-10-06 15:57:33 | `ok` |

The values are live CLI snapshots and can differ between launches. Each account entry also carried `active: true` and `kind: "system"`. No five-hour Codex window was reported by the CLI. The isolated Electron test process was stopped after the read.

## Packaged review follow-up (2026-09-30)

The reported merged installer returned Claude `unavailable` without a message. The missing message was a Hub response bug: the refresh stored a failure reason, but `limits()` omitted `observed.message`. The earlier packaged probe launched from a previously trusted cwd and therefore did not exercise Claude's workspace safety dialog. The PTY resolves the Claude executable to an absolute path from the inherited Windows PATH (with a `.cmd` fallback), loads the native module inside the probe so a load failure remains recoverable, and gives a short reason for executable, native module, startup, prompt, exit, or `/usage` failures. The probe times out after 30 seconds and still sends only `/usage`.

`npm run desktop:dist` succeeded. The unpacked Electron app launched by `scripts/probe-packaged-limits.mjs` from Git Bash returned Claude `ok` (session 25%, weekly 30%) and Codex `ok` (weekly 17%). The script copied the user's data into a temporary `FRACTAL_DATA`, used a separate Electron profile, and closed only its own process. The prior running Fractal instance was untouched.

For `2609.29233v1`, one Semantic Scholar Graph call returned HTTP 200 with 15 reference papers through the Hub route in 280 ms. The related service no longer calls the recommendations endpoint or retries 429 with long sleeps. A Semantic Scholar 429 immediately tries OpenAlex; if both are limited or OpenAlex has no related items, the API returns HTTP 429 with `RELATED_RATE_LIMITED`, `retryable: true`, and a source-specific message. Empty fallback results are not cached. A shared 9.5-second deadline bounds the lookup. OpenAlex DOI lookup and `filter=cites:` were checked live on this PC; the mocked 429 test covers the full fallback response.

A live feed refresh returned HTTP 200 with 30 news items, no item whose source was `news.google.com`, and no repeated displayed image URL. 19 of the 50 displayed paper and news items had an image after excluding Google redirect logos and shared images. Field news now requires a title or description match to the selected category's English or Korean name or custom query terms, with more matches ranked higher. The regression test specifically excludes the WISE brown-dwarf story from `cs.CV`.

## Claude workspace trust follow-up (2026-09-30)

Running the Node PTY from a newly created empty cwd reproduced Claude Code's `Accessing workspace` safety dialog. Its default selection was `No, exit`, and the dialog text contained `Claude Code`; the old readiness test sent `/usage` into that dialog and the CLI exited with code 1. The probe now uses an empty directory under `<FRACTAL_DATA>/claude-usage/<accountId>/`, confirms the safety dialog only when it names that exact directory, waits for Claude's version banner and command input prompt, and then sends `/usage`. Other first-run screens produce a short title in the unavailable message. A regression test classifies the recorded safety dialog, a dialog for another folder, the real input prompt, and a theme-selection screen.

`npm run desktop:dist` succeeded again. From Git Bash, Playwright Electron launched `win-unpacked/Fractal.exe` with a new temporary cwd Claude had never seen, a temporary copy of the user's Fractal data, and an isolated `--user-data-dir`. `GET /api/ai/limits` returned HTTP 200: Claude Pro `ok`, five-hour 28% resetting 2026-09-30 06:50:00 UTC, weekly 30% resetting 2026-10-03 13:00:00 UTC; Codex `ok`, weekly 17%. The probe closed only its own packaged process and removed its temporary data.

After this change, `npm test` (97 tests), `npm run typecheck`, `npm run e2e`, and `npm run format:check` all passed.
