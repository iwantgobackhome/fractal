# Version 0.2.0 client thumbnail evidence

The paper/news client work is complete. Production source is `edd8019808c923c58f3964528bb57832f79b72d6`, based on coordinator-supplied integrated `93bdbaa17aab79a351d49953108f679f862ed0e0`; the documentation-only date fixture correction is `b90dc74`. Existing request 1–13 behavior is retained; request 14 was excluded.

## Source and behavior

Desktop and Android home, topic/field lists and dossiers use validated `/api/feed/images/<64 lowercase hex>` identities on the captured authenticated Hub. Paper figures use contain, news previews crop, and dossier images remain whole. Title and image open the same dossier, with separate Read/Save controls. Missing, failed or unsupported images leave compact text and controls usable.

The desktop loader deduplicates cancellable leases per HubApi, caps response bytes at 5 MiB and retained bytes at 16 MiB, bounds entries and requests, rejects redirects, and expires stalled bodies after 15 seconds. Android uses captured immutable credentials, cancellable OkHttp calls, credential/request/mounted checks before and after IO and decode, session-derived disk identities, sampled bounded bitmaps, an 8 MiB memory cache and bounded 24 MiB disk cache. AVIF joins the existing bounded raster MIME allowlist; Android codec availability still depends on the platform and decode failure falls back to text.

## Final APK identity

The frozen local APK is retained outside git at:

`C:\Users\Home\orca\workspaces\fractal\fractal-v020-thumbnails-clients\apps\android\qa\v020-thumbnails\Fractal-0.2.0-clients.apk`

| Field | Verified value |
|---|---|
| Application ID | `app.fractal.reader` |
| Version / code | `0.2.0` / `2` |
| Variant | debug, signature verified with apksigner |
| APK SHA-256 | `42dd1eda407ccc90abcd646b94cd1c2df363cf53634638ce3088ed7529dde64c` |
| Certificate SHA-256 | `62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f` |
| Production source | `edd8019808c923c58f3964528bb57832f79b72d6` |
| Toolchain | JDK 17.0.2, compile/target SDK 35, min SDK 29 |

The certificate matches the coordinator-verified previous published baseline. `apps/android/qa/v020-thumbnails/final-apk-evidence.json` contains the full APK identity and 406 individual `classes*.dex`, `resources.arsc`, `res/` and `assets/` entry hashes for independent CI comparison. The local APK was frozen before cleanup and was not rebuilt after documentation-only fixture changes.

## Checks and captures

- UI typecheck, production UI build and actual desktop backend build pass. Six focused transport tests pass, including unsafe routes, same-Hub auth/cache isolation, lease deduplication/cancellation, failed or oversized bodies, the 15-second deadline and AVIF MIME admission.
- Android app and instrumentation APK builds pass. On the frozen final APK, actual-metadata capture and captured-session cancellation tests pass: `OK (2 tests)`, 20.712 seconds. They verify actual public bytes through authenticated transport, unsafe route rejection, token/origin identity separation, prompt cancellation, no stale disk admission and no library/pending mutations.
- Final actual Electron 0.2.0 application captures cover paper/news indexes and dossiers at 1440×900. Same-origin requests, title/figure activation, Enter/Escape, explicit separate actions, zero JavaScript errors and empty library/history pass. This is a built application run, not an installer-installed distribution; `packaged=false` is recorded.
- Final ordinary native MainActivity captures cover paper/news indexes and dossiers at 360×800, density 160, font scale 1.0 on exclusive read-only API 34. Each of the four PC and four phone documentation captures was individually inspected. Figures are uncut, titles readable and controls remain distinct; the paper dossier shows its sourced publication date.

The prior `validation.md` and original screenshot manifest preserve 1440/1280 desktop, phone360, phone360/font2 and tablet1280 present/absent/broken-image acceptance evidence. Those earlier captures used version 0.1 builds with the accepted client source and are explicitly not relabeled as version 0.2 artifacts. The final transport MIME change did not repeat that matrix, as requested by the coordinator.

The first documentation invocation accidentally selected the absent/broken-fixture test against the two-item actual-metadata feed. That QA selection failed and is preserved in ignored trial data; selection was corrected to the intended documentation and boundary tests, which passed. This required no product change.

## Documentation images and public provenance

Use these source-grounded images for documentation rather than the controlled failure fixtures:

- `documentation-screens/desktop1440-papers.png`
- `documentation-screens/desktop1440-paper-dossier.png`
- `documentation-screens/desktop1440-news.png`
- `documentation-screens/desktop1440-news-dossier.png`
- `apps/android/qa/v020-thumbnails/documentation-phone360/paper-index.png`
- `apps/android/qa/v020-thumbnails/documentation-phone360/paper-dossier.png`
- `apps/android/qa/v020-thumbnails/documentation-phone360/news-index.png`
- `apps/android/qa/v020-thumbnails/documentation-phone360/news-dossier.png`

Paper metadata comes from the official [arXiv abstract page](https://arxiv.org/abs/2609.40325v1), including the actual title, eight citation authors, abstract and September 30, 2026 submission date. News metadata and actual body extraction come from the official [MIT News article](https://news.mit.edu/2024/ai-generates-high-quality-images-30-times-faster-single-step-0321), including Rachel Gordon's byline and March 21, 2024 date. `publication-metadata.json` retains the exact source-grounded metadata used by the documentation fixture.

| Selected public bytes | Content SHA-256 | Bytes |
|---|---|---:|
| arXiv Figure 1, `anomaly_taxonomy.png` | `c4b29afc943f6b8cd2ada156874b70e4967a8f3d5f2951ccb23ce94ca3fa2e84` | 3086692 |
| MIT first article content image, `MIT-DMD.png` | `ac64b89e3b693917a13f75d638e6c7ce5c6816bb3118d8b22b4d451abafd470c` | 678963 |

These are the backend worker's actual downloaded public bytes, selected from public HTML and independently proven through its authenticated Hub route. The client helper verifies hashes and places those identical bytes in a real FeedImageStore, served by the integrated production Hub. Documentation uses an isolated cached feed with real publication metadata; it is not a live-gathering or PDF success claim. No imagegen assets or seeded PDF success were used. Final desktop/native evidence and screenshot hashes retain exact source/runtime identities and empty library/history state.

## Resource lifecycle and practical limits

`resource-lifecycle.json` retains full launcher, QEMU, helper and listener identities. Only our read-only API 34 clone on `emulator-5572` (ports 5572/5573) and helpers 47252, 50660 and 38552 (ports 6294–6297) were used. Helpers stopped gracefully; clone size/density/font overrides and owned reverses were restored, private temporary configuration removed, then that exact emulator stopped through scoped adb. Recorded final checks show no remaining owned processes or listeners. No global adb reset, AVD edit, user device or user profile change occurred; prior artifacts and ignored isolated profiles remain preserved.

No physical Android device or installed desktop installer was exercised by this worker. Final CI distribution inspection and comparison with the frozen APK remain the coordinator's independent integration gate; this report makes no claim that those separate checks have already passed. No self-merge or external publication occurred.
