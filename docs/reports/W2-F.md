# W2-F — Discovery feed

## Summary

- Added feed interests (arXiv categories, topics, followed authors), library category suggestions, and settings for sources, HTTPS RSS feeds, digest opt-in, and refresh interval.
- Added injectable arXiv Atom, Hugging Face Daily Papers, RSS/Atom, and Semantic Scholar recommendation sources. Conditional GETs persist ETag and Last-Modified state. Per-source and per-subfeed status keeps partial results visible.
- Added arXiv ID/DOI/title deduplication, interest and recency ranking, Hugging Face upvote and Semantic Scholar citation-per-year signals, and library membership detection.
- Added SQLite migration 3 for feed items, settings, fetch cache, and weekly digests. A stale snapshot refreshes on hub start; a timer repeats at the configured interval. Digests use the provider registry's `digest` selection once per week only when enabled.
- Added an offline 12-test feed suite covering Atom, RSS, curated field feeds, Hugging Face, recommendation request shape, caching, deduplication, ranking, staleness, partial failure, digest gating and persistence, and routes.

## Endpoints added

`GET /api/feed?week=YYYY-Www`, `GET/PUT /api/feed/interests`, `GET/PUT /api/feed/settings`, `POST /api/feed/refresh`, `GET /api/feed/digest?week=YYYY-Www`, and `POST /api/feed/items/:id/save`. Details and response shapes are in [API.md](../API.md), with Zod schemas in `packages/shared/src/contracts/feed.ts`.

## Acceptance output

```text
> npm ci
added 374 packages, and audited 378 packages in 10s
2 moderate severity vulnerabilities
exit code 0

> npm run build
@fractal/shared: tsc -p tsconfig.json
@fractal/ui: 74 modules transformed; built in 4.34s
@fractal/hub: tsc --noEmit -p tsconfig.json; build-hub.mjs
exit code 0

> npm test
@fractal/shared: 1 test passed
@fractal/hub: 40 tests passed
@fractal/ui: 11 tests passed
exit code 0

> npm run typecheck
@fractal/shared: passed
@fractal/hub: passed
@fractal/ui: passed
exit code 0
```

The UI build emitted its existing large-chunk warning. Node 22.23.1 emitted the existing experimental `node:sqlite` warning; no launch flag was needed.

## Live feed and hub smoke

On 2026-09-30 KST, started an isolated in-process hub with interests `cs.CL` and `cs.CV`, called the real `POST /api/feed/refresh`, and received HTTP 200. The response week was `2026-W40`. Section counts: `top` 20, `byField` 2 fields, `rankings` 30, `news` 25, `recommended` 0 (the isolated library had no seed papers). All arXiv categories, seven Hugging Face days, five default news feeds, and the top-level sources reported `ok`.

Top five items (title — reason):

1. **How Far Are We from Removing the Visual Encoder? Scaling Laws for Encoder-Free Multimodal Pretraining** — 관심 분야 cs.CV
2. **Improving Test-Time Scaling with Adaptive Looped Transformers** — 관심 분야 cs.CL
3. **Learning Native Reflection in Unified Models with Interleaved Reinforcement Learning** — 관심 분야 cs.CV
4. **FuseReg: Regularizing Layer Fusion Mitigates the Reconstruction-Generation Gap in Representation Autoencoders** — 관심 분야 cs.CV
5. **TraceDance: An Automated System for Building Agent Behavior Benchmarks from Real-World Agent Deployment Traces** — 관심 분야 cs.CL

The in-process hub returned 200 for the UI and `GET /api/papers`. A separate `npm run hub` process on port 7346 also returned 200 for both routes. It was stopped, and the port had no listener afterward.

## Decisions

- Feed snapshots use UTC ISO weeks, with current-week reads re-ranked against current interests and library membership.
- Curated defaults map computing fields to Google Research, DeepMind, OpenAI, BAIR, and The Gradient; mathematics, biology, and physics use matching Nature subject feeds. Users can add HTTPS RSS/Atom feeds.
- `POST /api/feed/refresh` waits for the current refresh when one is already running. Source failures reuse that week's stored items for the failed source when available.
- Hugging Face `submittedOnDailyAt` sets daily-feed recency, while `paper.upvotes` supplies the ranking signal. Semantic Scholar recommendations use its POST endpoint with saved arXiv IDs as positive seeds and optional `SEMANTIC_SCHOLAR_API_KEY`.
- Saving uses existing arXiv/DOI/URL ingest, then copies feed metadata into the bibliography. The feed does not create metadata-only library records.

## Known gaps and integrator notes

- A recommendation with no obtainable PDF can fail to save because existing ingest requires a PDF. The route returns the existing ingest error; metadata-only saving needs a separate library product decision.
- arXiv fetches the latest 500 submissions per selected category before applying the seven-day filter. Very busy categories may omit older papers from the week.
- Curated defaults cover broad field families; more specialized fields can use custom feeds.
- Claude's home UI can consume `sections` and `sourceStatus` directly. The digest remains absent until the user enables it and a refresh generates that week's text.
