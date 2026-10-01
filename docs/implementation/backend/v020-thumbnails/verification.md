# Version 0.2 feed thumbnails: backend verification

Backend implementation is complete at `d5cbccbd450f7ab1bfd0297b329eeb5c41d46ab2`, following source checkpoint `1cb2b6db9496c1c19627dc87ec1857e4f140330d`. The exact user paper and an actual public news image were discovered, fetched, cached, and served with matching bytes. Root integration, client rendering verification, release builds, and independent final QA remain coordinator-owned.

## Audit and change

The original refresh gave a provider `imageCandidate` precedence over a paper's HTML figure, extracted only literal `src` from `<figure>`, tried only OG for news, and abandoned the row after a failed candidate. Publisher figures without arXiv IDs received no HTML discovery. Failed image URLs were retried on later requests, and per-field news selection had no aggregate ceiling.

The existing `FeedItem.image` / `FeedImage` schemas and `/api/feed/images/{64hex}` route remain unchanged. No shared contract, migration, UI, Android, manifest, or release file changed. Paper discovery now tries captioned arXiv or publisher figures in document order before a suitable provider/existing thumbnail; explicit arXiv URL revisions remain pinned. News discovery tries article content images, then suitable lead/OG images, then source candidates. Lazy attributes, relative URLs, `<picture>` and srcset variants are supported. Logos, icons, avatars, tracking pixels, placeholders, equation contexts, supplementary contexts, related-story images, SVGs and PDF candidates are excluded. Raster signatures/dimensions are checked before caching.

Production article/image GETs reuse the existing public HTTPS, redirect-validating, DNS-pinned `publicGet`. Its only change is optional internal `acceptedContentTypes`, checked before reading a response body; omitted defaults preserve the acquisition path. Discovery therefore rejects a PDF response without downloading its body. There is no PDF acquisition or cover/logo extraction for thumbnails. Missing paper HTML falls back to a suitable existing provider/cache image or `null`; local PDF figure extraction was not added.

## Bounds, cache, and invariants

- Optional enrichment has a 20-second total refresh deadline, interleaves at most 30 papers and 40 news rows, and uses four workers.
- Each row retains at most six candidates and attempts at most four images. Article/image GETs have eight-second deadlines and 2 MiB / 5 MiB body limits.
- The existing disk cache remains capped at 300 MiB. Image requests coalesce by source hash, with at most four active image downloads and 32 queued downloads; each waiting caller honors its own deadline.
- Discovery results persist for 24 hours, unavailable HTML for one hour, and failed images for one hour. Cache keys include the image policy version and original URL/arXiv/source candidate, so old transformed discovery is not reused. Existing feed snapshots and other caches are not globally cleared.
- Aborted enrichment commits metadata with text-only rows, does not turn successful provider metadata into a source error, and cannot later mutate committed feed rows. The controlled deadline regression also proves no negative discovery entry is written for a canceled attempt.
- Bibliography/catalog keys, Saved, Recent, PDF bytes/hash, annotations, memos, folders, provider authentication/cooldowns and publication provenance use their existing paths. Controlled integration preserves existing publication metadata and an old-week feed row, preserves library records across refresh, and verifies repeated Save has stable identity.

## Actual public byte proof

`probe-public.ts` fetches real public HTML and first candidates. `prove-hub.ts` uses controlled metadata seeds for those URLs, actual production public HTML/image discovery, and the existing production Hub HTTP routes in a new isolated profile. This is not a claim that the full live provider aggregation returned the two probe rows: the news story is from March 2024. Raw HTML, image bytes, profiles and logs remain ignored under `data/`; durable facts are recorded in `live-evidence.json`.

| Evidence            | Exact paper                                                                         | News article                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Article             | [arXiv 2609.40325v1](https://arxiv.org/html/2609.40325v1)                           | [MIT DMD news](https://news.mit.edu/2024/ai-generates-high-quality-images-30-times-faster-single-step-0321)                                       |
| First genuine image | [Figure 1](https://arxiv.org/html/2609.40325v1/anomaly_taxonomy.png)                | [First content image](https://news.mit.edu/sites/default/files/styles/news_article__image_gallery/public/images/202403/MIT-DMD.png?itok=oIzEyXxR) |
| Source/final URL    | Same Figure 1 URL; no redirect                                                      | Same first content URL; no redirect                                                                                                               |
| Type                | `image/png`                                                                         | `image/png`                                                                                                                                       |
| Bytes               | 3,086,692                                                                           | 678,963                                                                                                                                           |
| Dimensions          | 1920 × 1150                                                                         | 900 × 600                                                                                                                                         |
| Byte SHA-256        | `c4b29afc943f6b8cd2ada156874b70e4967a8f3d5f2951ccb23ce94ca3fa2e84`                  | `ac64b89e3b693917a13f75d638e6c7ce5c6816bb3118d8b22b4d451abafd470c`                                                                                |
| Cached route        | `/api/feed/images/734f8081f3e1980309cce54586072b22a95053ee1c0d8c3e89971b13fbaabab0` | `/api/feed/images/bc175c6d20a54ddc9589ed4d2ca6032a2ba78dc14159b8e59a3a7b71dd74c861`                                                               |

The paper HTML's first three images are an arXiv announcement SVG, arXiv logo SVG, and a 17 × 17 uncaptioned WorldAuditBench logo; the fourth is `<figure id="S0.F1">` with the Figure 1 caption and `anomaly_taxonomy.png`. The selected image was visually inspected as the scientific anomaly taxonomy figure. The exact requested version was used, with no substitute paper.

The MIT article's first image is a 900 × 600 lazy content image: `src` points at a placeholder and `data-src` points at `MIT-DMD.png`. The selected real image was visually inspected; the placeholder and subsequent related-story images are excluded, and OG remains a later candidate. The initially attempted Schwarzman College mirror returned HTTP 404 and was not used as evidence; its original MIT News article supplied the successful proof.

On final source, both Hub image GETs with the startup credential returned HTTP 200 and matched the separately captured public bytes exactly; repeat GETs also matched. Existing loopback GET policy permits credentialless read requests (observed 200), while credentialless Save remains 403. The first harness had incorrectly expected 403 for credentialless GET and was corrected to match the existing guard; application authorization was not changed.

Actual feed refresh did not change the isolated library. Repeated Save retained catalog key `pub-32fc1d3ce5ab760587b23fe492bdf6abf032f3adcc5f8a1e0ae8f7e01d18f01f` and left library JSON unchanged. Recent remained empty and no PDF was downloaded.

## Checks and process cleanup

The final source passed Hub typecheck/build, 38 focused feed tests, and the complete Hub suite (234 tests across 28 files). The focused publication/acquisition suite also passed, including existing cached-PDF byte integrity and provider authentication/cooldown coverage. New tests use controlled PNG header fixtures and fake HTML/network responses; these are explicitly separate from the actual public-byte proof above.

The final proof process was PID 44800, executable `C:\Program Files\nodejs\node.exe`, started `2026-10-01T07:42:52.9592230Z`, command `node.exe --import tsx docs/implementation/backend/v020-thumbnails/prove-hub.ts`, with only listener `127.0.0.1:13790`. Full PID/executable/start/command/listener evidence was captured before creating its verified in-profile stop marker and closing it gracefully. Its profile is `data/hub-profile-1790840574525`. The earlier successful proof PID 45676 / port 13342 was also captured and closed gracefully; the initially failed short-lived harness PID 29944 had self-closed and was not killed. No user/peer/prior preview process, profile or device was touched.

Raw artifacts remain locally available for the client worker and root QA. Source and precise paper/news routes were sent early through Orca orchestration; the worker will send one final lifecycle completion after the report commit and final inbox check.
