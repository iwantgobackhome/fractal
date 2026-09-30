# W6-N — topic news, article reader, quick translation

Measured on this PC on 2026-09-30 with a fresh temporary `FRACTAL_DATA` and `cs.AI` selected. The live script removed inherited `CODEX_HOME`, `ORCA_*`, and `CLAUDE*` variables before starting the Hub so Codex used the user's normal CLI home. Both Codex and Claude reported signed in; `/api/connection` and `/api/feed/refresh` returned 200.

## Topic feed

`GET /api/feed/topics?field=cs.AI` returned 10 curated seeds, 9 trending terms extracted from current headlines, and 8 weekly AI suggestions. The six default-followed curated topics and `newsByTopic` counts were OpenAI 15, Anthropic 15, Google DeepMind 15, ChatGPT 15, Codex 15, and Claude 15. The same refresh returned 30 `newsByField` items for `cs.AI` and 40 general news items. Trending examples were Gemini 4 (score 5), GPT-6 (4), Claude Sonnet 5.5 (4), and DevDay 2026 (3). Suggestions included Generative AI Licensing and RAGOps and AI Quality. Suggestions were generated after the feed response and did not hold up refresh.

## Article reader

`GET /api/news/article` extracted a Google News RSS item from CBS News, resolved its opaque Google News ID to the publisher URL `https://www.cbsnews.com/news/sam-altman-openai-dots-chatgpt-agents-safety/`, and returned 26 plain text blocks. A Bing item resolved to a `note.com` article and returned 114 blocks. The Google News resolver uses its public page parameters and an undocumented Google News endpoint, following the approach documented by [GoogleNewsDecoder](https://github.com/dbernheisel/google_news_decoder/blob/main/README.md); it can change. Publisher pages are still subject to the public HTTPS, redirect, and size guards, and blocked or paywalled pages return `ARTICLE_UNAVAILABLE`.

## Quick translation

A feed title was translated to Korean as `GPT-6 솔과 루나를 소개합니다`. `POST /api/translate/quick` translated an English title and paragraph to `새로운 AI 모델 출시` and `연구자들은 여러 연구에 걸쳐 결과를 비교했습니다.` with `engine: google-web` and status 200. No AI model was used for these translations. The endpoint splits long text, paces Google requests, retries 429, caches by text and language, and uses AI only when `allowAiFallback` is true.

## Verification

- Full `npm test`: 120 tests passed (shared 1, Hub 100, UI 19) after migration assertions were updated for versions 9 and 10.
- `npm run typecheck`, `npm run e2e`, and `npm run desktop:dist` passed. The installer build completed with the new article parser bundled.
- `npm run format:check` still reports two UI files inherited from the local-main merge: `packages/ui/src/i18n/ko.ts` and `packages/ui/src/shell/HomeScreen.tsx`. W6-N explicitly reserves `packages/ui` for Claude, so this Hub task left those files untouched after the merge. Hub, shared, and scripts formatting checks pass.
- Fixture tests cover news/blog/paywall extraction, opaque Google News resolution, cache, private redirect rejection, topic seeds/extraction/caps/dedupe, and quick translation splitting/cache/429/fallback.

Reproduce with `npx tsx scripts/w6-live.ts` and `npx tsx scripts/w6-article-live.ts`. Both use isolated temporary data and remove it afterward; run the first with `CODEX_HOME`, `ORCA_*`, and `CLAUDE*` unset when verifying the user's own CLI environment.
