# Independent 0.2.0 QA

Status: **pending final integrated runtime and actual CI artifacts**. This is a coordinator-support review, not release approval. Request14, physical devices/stylus, installation of downloaded CI artifacts, remote operations and private signing material are outside this review.

## Exact reviewed checkpoints

- Initial accepted root: `6080532fe6fad7e40a8dfc262fcdc271a764e339`; accepted backend source is integrated here, with original proof source `d5cbccbd450f7ab1bfd0297b329eeb5c41d46ab2`.
- Coordinator declared combined client root `fa4304f6698dbdf28675dfe522dff8748ab50f66` at 07:58 UTC; its final 0.2.0 screenshots and actual release outputs are still pending.
- Preliminary peer client screenshots explicitly report unpackaged app `0.1.0` and source `b6323d1f4b3b00007c7e0f09e7a75545a87301c5`; they are not proof of final integrated 0.2.0 binaries.

## Reproduced release blocker

At initial accepted source, `scripts/packaged-release-probe.cjs` reads `(await api.json()).papers`. `packages/hub/src/api/index.ts` wraps JSON in `{data: result.data}`, and the papers route supplies `{papers}` inside `data`. An actual independently started isolated Hub returned HTTP 200 with `{data:{papers:[]}}`; the existing smoke expression was false and `Array.isArray(payload.data.papers)` was true. This would fail all four desktop smoke jobs after Hub startup. Routed to coordinator as `msg_5ebe108891af`; release owner correction pending review.

## Backend independent evidence

Run `node --import tsx docs/implementation/qa/v020/independent-boundaries.ts` after installing dependencies and building shared. [boundary-evidence.json](boundary-evidence.json) records the exact tested source, inputs and outcomes; the ignored isolated profile remains under this QA directory's `data/`.

Independently read actual backend archived public HTML, downloaded image bytes and served image bytes. The exact requested paper's first accepted candidate is `https://arxiv.org/html/2609.40325v1/anomaly_taxonomy.png`, SHA-256 `c4b29afc943f6b8cd2ada156874b70e4967a8f3d5f2951ccb23ce94ca3fa2e84`, 3,086,692 bytes, 1920 × 1150. MIT's first lazy content image is `https://news.mit.edu/sites/default/files/styles/news_article__image_gallery/public/images/202403/MIT-DMD.png?itok=oIzEyXxR`, SHA-256 `ac64b89e3b693917a13f75d638e6c7ce5c6816bb3118d8b22b4d451abafd470c`, 678,963 bytes, 900 × 600. Both archived served payloads match exactly, and SHA-256 of each source URL matches its opaque Hub route. This independently confirms archived actual byte evidence; no new live provider aggregation is claimed. Backend HTTP proof used controlled metadata seeds, especially the March 2024 news story.

Additional independently executed boundaries passed: captioned figure order and picture variants, equation/table/supplement exclusion, forbidden URL candidates, rejecting PDF discovery before reading its body, private redirect rejection before a second request, and cancellation during stalled DNS. Production public HTTP validates each redirect and uses pinned vetted IPv4 connections; discovery is capped at six candidates/four image attempts, 30 papers/40 news rows, four refresh workers and 20 seconds total; body deadlines/limits are 8 seconds, 2 MiB HTML and 5 MiB images. Disk bytes are capped at 300 MiB; discovery and failure TTLs are scoped to image policy rather than a global cache reset. Existing comprehensive Hub tests were not duplicated.

## Source release review

The embedding `startHub({port,indexHtml,allowRealCli,startBackground})`, returned URL and close API match the package probe. Optional PTY exports resolve to a platform `lib/index.js`; configuration includes the platform packages and unpacks their native binaries. Mac bundle traversal explicitly hashes symlink targets instead of skipping framework links. The workflow declares four native desktop hosts plus Android and produces Windows NSIS, Linux AppImage/deb, two Mac DMGs and Android debug APK. Only tag publication has write permission and creates a draft while refusing to replace an existing release.

Version guards cover root/shared/Hub/UI/lockfile and Android 0.2.0/code2. Android signature verification inspects the actual APK and compares the public expected old certificate when configured, requiring that value for tags. Missing stable key configuration fails before building; this review neither accessed nor exported a key or token. Mac signing/notarization claims remain conditional; ad-hoc signing is explicit. Config and source review do not qualify actual Mac/Linux packages or native runtime.

## Preliminary visual observations

Inspected existing 1440 desktop paper list, 1280 desktop paper dossier, native 360 phone with font scale 2, and 1280 tablet news list. Paper figures preserve proportions using contain/fit. Desktop Read PDF is visually primary and Save metadata secondary; failed/absent images leave readable rows. Native font2 title wraps within width and the two-row navigation remains visible; content requires scrolling. Tablet news image intentionally crops as a photo and its list/detail split is clear. Final serif/font/focus/nav corrections and final version correspondence remain to be reviewed against accepted captures.

## Remaining gates and cleanup

Pending: exact accepted final source; final desktop 1440/1280 and native 360/font2/tablet captures; all five successful actual native CI jobs and six downloaded distributions; independent payload/source/resource hashes, package versions/architectures, native PTY records and Android old/new certificate identity; source/resource correspondence between CI APK and accepted native captures. Static APK inspection will not be described as installation.

The independent Hub ran only inside a short-lived QA command, with real CLI and background refresh disabled and a new QA profile plus isolated legacy path. Its close completed before the command naturally exited. No persistent helper, terminal, emulator, user profile, library or peer resources were started, stopped or cleaned up by this worker.
