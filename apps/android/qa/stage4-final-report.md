# Android discovery, news and topics — final owner report

The Android implementation connects real Hub discovery, taxonomy/topics, news extraction/translation, related-publication and identity-preserving PDF association routes, with durable offline observations and mutation intents. Final product source is **`e690dcabfc150c7c83170a512cf2562166b3a014`**, following accepted discovery checkpoint `f81cd026b487ddc04883c185b304009d24734889`; both descend from the supplied clean `56da0caf17aab0e78bab1eef0e620237f00060c0`. Changes are restricted to owned Android paths, exclude common generated tokens and request14, and introduce no Hub/shared/desktop edits or merges.

## Delivered behavior

- Discover, Library, News and Topics are functional destinations with an adaptive phone bottom bar and tablet rail. Full English/Korean titles wrap; compact excerpts explicitly use ellipsis; complete dossiers/articles remain scrollable and selectable. Source Serif4 and Pretendard are the actual bundled fonts. Source/type/taxonomy/topic selectors expose their selected labels and use the accepted focus/keyboard/48dp interaction foundation.
- Feed observations, article blocks, translations and related evidence are cached by Hub scope/resource. Successful refreshes replace their observations; provider failure retains useful content with its original observation time and new failure/cooldown diagnostics. Related retry is bounded and local to that resource. Repeated provider labels can represent distinct field/topic observations: all are retained with unique LazyColumn keys rather than deduplicated or allowed to crash the list.
- Topic creation/follow/unfollow/delete and interest-field edits persist as scoped intents, coalesce later choices, and only acknowledge the exact sent receipt/body. Custom-topic POST is explicitly non-replayed by OkHttp; an ambiguous response reconciles against admitted topics before another POST. Existing followed author/topic/custom interests are preserved. An author-interest editing UI is outside this addition; existing author preferences still influence the actual feed.
- Saving publication metadata does not download a PDF or mark it read. Explicit PDF association uses the accepted stable catalog identity route, preserving folders, tags, retained history and annotations. Library, discovery and dossier state share the accepted metadata queues. Existing-record Save/Unsave attempts one bounded production sync after retaining the edit, alongside normal background retry; this avoids hiding a fresh action behind an older WorkManager retry head.
- The source/original article toggle always restores original text, including when only a translated feed title was available. A translated-title-only state is labeled as such. Translation cache identity includes the actual title/block content and selected target; retained display choice survives recreation/cold startup without interpreting translated offsets as original annotation anchors. Reported article site names remain intact; absent site names use a concise explicit Feed label, not a combined provider-domain list masquerading as a byline.
- Explicit Room migration3→4 adds only discovery observations/intents; the accepted1→2→3 chain remains registered. Old PDFs, annotations, reader positions, pending library/history edits and consumed pull cursor are preserved. Snapshot/block caching remains based on stable IDs and one-based physical `region.page`. No push head becomes a consumed pull checkpoint.
- Actual HTTP surfaced a legacy ink payload with absent optional `shape:null` rejected by the accepted schema. The wire projection omits absent optional ink fields while retaining original local JSON, points and compare-to-sent acknowledgements. A concurrent local edit remains dirty. Reader gesture handling itself was not broadened or changed in this stage.
- A mounted, initially uncached original text-layout failure can be explicitly retried on its verified page without changing paper geometry or losing complete memo text; the accepted range-selection/copy/quote path resumes. Accepted original/translation reader, pen/palm cancellation, sticky notes and retained history implementations remain intact.

## Current APKs and source

`stage4-artifact-manifest.json` records absolute paths, byte counts, SHA256 values, unit results and raw screenshot hashes. The local immutable delivery copies are ignored binary artifacts; their hashes match the build outputs:

| Artifact | Absolute delivery path | SHA256 |
| --- | --- | --- |
| Debug app | `C:\Users\Home\orca\workspaces\fractal\fractal-android\apps\android\qa\stage4-apks\app-e690dca-debug.apk` | `3597906a2d8aee3569ecf7a91510c22a51cc2b6e411172fb84ca585519d9999f` |
| Debug instrumentation | `C:\Users\Home\orca\workspaces\fractal\fractal-android\apps\android\qa\stage4-apks\app-e690dca-debug-androidTest.apk` | `00eb13f192d661a8d869b4fa0b5a031ac25d6f6067f237c64311be25fdc960ee` |

Current build output paths are respectively `C:\Users\Home\orca\workspaces\fractal\fractal-android\apps\android\app\build\outputs\apk\debug\app-debug.apk` and `C:\Users\Home\orca\workspaces\fractal\fractal-android\apps\android\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk`. Product source is the exact `e690dcabfc150c7c83170a512cf2562166b3a014` commit; the final evidence-only commit adds this report and proofs without changing the compiled product.

Build scope is Android debug only, package `app.fractal.reader`, version0.1/code1, minSDK29/target35/compile35, actual runtime API34. No release build or production signing is claimed. `stage4-apk-signing.txt` verifies Android Debug certificate DN `C=US, O=Android, CN=Android Debug`, SHA256 `62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f`. `stage4-apk-badging.txt` and the refreshed `stage4-apk-resources.json` inspect the same current APK; QA article text/title are absent from app DEX.

The actual manifest icon/roundIcon resolve to `@mipmap/ic_launcher`. Compiled resource dumps `stage4-launcher-resource-table.txt`, `stage4-launcher-adaptive.txt`, `stage4-launcher-foreground.txt` and `stage4-launcher-legacy.txt` show the adaptive background/foreground/monochrome and the same branch vector paths in foreground and legacy artwork. The min29 APK selects the adaptive26+ entry; the legacy vector is also packaged, while the unsupported pre26 mipmap alternative is compiled away. Actual font ZIP entries are `res/font/pretendard_variable.ttf` and `res/font/source_serif_four.ttf`.

## Exact verification and results

Commands ran in this worktree, using JDK17.0.2 and Android SDK at `C:/Users/Home/AppData/Local/Android/Sdk`. Build/install commands checked Gradle success before any installation; native results were read from JUnit, not adb's exit code alone.

```powershell
# cwd apps/android
$env:JAVA_HOME='C:/Program Files/Java/jdk-17.0.2'
$env:ANDROID_HOME='C:/Users/Home/AppData/Local/Android/Sdk'
./gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :data:testDebugUnitTest :sync:testDebugUnitTest :ink:testDebugUnitTest
./gradlew.bat :app:assembleDebugAndroidTest
```

Final full build (`stage4-final-build.log`) passed183 tasks. The final test-APK-only build (`stage4-final-test-apk-build.log`) passed after the narrowly adjusted native capture/profile helper. Unit XML inventory is **28 tests, zero failures/errors/skips**. Repository/identity/unit sources and all accepted library/migration checks remain present.

Actual5554 instrumentation command shape was:

```powershell
$adbPath='C:/Users/Home/AppData/Local/Android/Sdk/platform-tools/adb.exe'
& $adbPath -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
& $adbPath -s emulator-5554 install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $adbPath -s emulator-5554 shell am instrument -w -e class 'app.fractal.reader.DiscoveryNativeTest#liveNavigationMetadataSaveTopicsNewsOfflineAndReconnect' app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
```

The following method-specific evidence is retained. Mixed invocations are explicitly qualified; a passing method is not a claim that its whole historical invocation passed.

| Gate | Actual result and retained log |
| --- | --- |
| Live normal MainActivity navigation, metadata-only Save, topic creation/follow/unfollow, lost-response single admission, news article/quick translation, offline cached translated recreation/feed and reconnect | **PASS**, `stage4-native-http-final.log`, one test,17.205s. No fixture bodies are installed in the production APK. |
| Durable discovery races, scope isolation, identity conflict, lost admission reconciliation, related fallback, migration3→4, ink compare-to-sent concurrency; retained library CAS/retry/folder deletion/history/migration | **18 scoped tests PASS** in `stage4-http-foundation-final.log`: DiscoveryRepository8, LibraryFoundation9, ReaderMigration1. The additional historical native method failed on an offscreen target before the later passing log; whole19-test invocation is **not** labeled passing. |
| Mounted initially unavailable text-layout503 → explicit actual page retry → real original range/copy/quote | **Scoped method PASS**, `stage4-native-http-main-6.log`. Selection `[4,7)` copies exactly `iii`; memo JSON is unchanged; actual ink/page window stays `(0,442)-(1080,1840)`. Another method in that two-test invocation failed in the old click helper; overall invocation remains failed. Independent before/after rendered PNGs are retained under `stage4-screens/native/reader-text-unavailable-411x683-font1.0.png` and `reader-recovered-quote-411x683-font1.0.png`. |
| Real stable-key metadata→PDF association, folder/tag/pre-link settled history, memo, repeated identical link, independent Unsave/Save, cached original offline read/recreation | **Scoped method PASS**, `stage4-native-http-main-9.log`. Another historical repeated Save precondition failed; whole two-test invocation is not labeled passing. Actual public PDF2,215,244bytes, SHA256 `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`; stable key `pub-5ce41086a48328a9823f1948a07a7ac1729e8e5429f8124d44f4d3688f1aab53`. Native cached PDF screenshots are in `stage4-screens/native/reader-real-publication-offline-411x683-font1.0.png` and `reader-real-publication-recreated-411x683-font1.0.png`. |
| Related-provider real429 and actual abort timeout with retained useful rows/time, new status, identity invalidation | **Scoped method PASS**, `stage4-native-http-main-8.log`. Other historical methods failed a repeated-state admission precondition and an invalid QA memo UUID; the overall three-test invocation is failed. Corrected acquisition subsequently passes in main9. This case proves actual HTTP/cache/identity handling; related UI delegates to the same tested dossier/save/read actions rather than having a separate exhaustive navigation matrix. |
| Article unavailable503 while quick translation remains reachable, pretranslated feed title, truthful source/original toggle, KO→JA target change and offline cached JA recreation | **PASS**, `stage4-title-fallback-native.log`, one test,29.835s. Owned article cache was restored after the scoped test. Actual title-only PNGs are retained under `stage4-screens/native/`. |
| Process-cold Hub-offline launch, cached discovery, complete article and actual cached original PDF | **PASS**, `stage4-cold-offline-native.log`, one test,9.304s; Hub was offline before startup, no prefetch, new app process PID27941. Its separate capture directory was not copied before verified emulator closure; the JUnit proof is retained, and the earlier actual cached article/PDF offline/recreation PNGs are available. This is not described as merely Activity recreation. |
| Current concise article-source fallback and complete translated body at KO/font2 | **PASS**, `stage4-news-source-final.log`; actual current APK, ordinary MainActivity/finger scroll. Latest PNGs are `phone360-font2-ko/news-article-translated-source-final-360x744-font2.0.png` and `news-article-translated-body-final-360x744-font2.0.png`. |
| Owned default emulator/product profile restored | **PASS**, `stage4-resource-profile-restore.log`, actual MainActivity en/Light/font1; then verified process shutdown. |

Accepted stage3 input/range/retained-history gates remain evidence, not newly rerun claims: `stage3-main-restore-routing.log` passed ReaderInteraction12 + ordinary MainActivity lifecycle1, including finger-first/sole-stylus cancellation resolution, real cancellation, palm/pointer removal, side-button eraser, undo, maximum zoom and finger navigation. Accepted history and translated-copy evidence remains in `stage3-reader-final-report.md`. This stage does not modify those input/selection coordinate mechanisms; the affected missing-layout retry is independently exercised above. Unchanged owner matrices were not repeated merely for final artifact regeneration.

## Actual visual evidence

From the worktree root:

```powershell
./apps/android/qa/stage4-capture.ps1 -Profile phone360-portrait
./apps/android/qa/stage4-capture.ps1 -Profile phone360-landscape
./apps/android/qa/stage4-capture.ps1 -Profile tablet800-portrait
./apps/android/qa/stage4-capture.ps1 -Profile tablet800-landscape
./apps/android/qa/stage4-capture.ps1 -Profile tablet1280-portrait
./apps/android/qa/stage4-capture.ps1 -Profile tablet1280-landscape
./apps/android/qa/stage4-capture.ps1 -Profile phone360-font2-ko
./apps/android/qa/stage4-capture.ps1 -Profile tablet1280-font2-dark
```

All **eight profiles PASS**, each through the real current scholarly destinations, with recorded logs `stage4-capture-<profile>.log`. Requested window sizes at density160 are360×800,800×360,800×1280,1280×800,1280×1800 and1800×1280, plus phone KO/Sepia/font2 and1800×1280 Dark/font2. Actual PNG dimensions include system bars; filenames carry app configuration dimensions, which differ from the requested full display height. Default-phone proof includes a real selected taxonomy popup and DPAD_DOWN/ENTER selection updating the actual field/topic resource.

The six standard profiles and initial KO profile used app SHA256 `064567774c180cd784a8886ecfabafb2e14f8ecd2e4c08105aa1364a7cfda0ba`, preceding only the final concise article source/date label. Final dark tablet and targeted KO article/source/body used current app `3597906a…`. The manifest distinguishes these revisions and superseded image variants; unchanged six-profile layouts were not repeated solely for that label fix. Final review anchors are:

- `stage4-screens/tablet800-portrait/discover-index-800x1224-font1.0.png`
- `stage4-screens/tablet1280-portrait/discover-dossier-1280x1744-font1.0.png`
- `stage4-screens/tablet1280-font2-dark/discover-dossier-1800x1224-font2.0.png`
- `stage4-screens/tablet1280-font2-dark/news-article-body-1800x1224-font2.0.png`
- `stage4-screens/phone360-font2-ko/topics-index-360x752-font2.0.png`
- The latest current source/body-final KO360×744 images listed above.

Reported publication metadata is sourced from [Attention/arXiv](https://arxiv.org/abs/1706.03762), [NIPS2017](https://papers.nips.cc/paper_files/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html), [LoRA/arXiv](https://arxiv.org/abs/2106.09685), and [Scikit-learn/JMLR](https://jmlr.org/papers/v12/pedregosa11a.html). Historical publication years are displayed as historical, not current releases; unavailable exact journal publication dates remain unknown. The full author lists appear in dossiers, with explicitly counted compact index author summaries. Provider graphs, QA news article and translation output are controlled as documented in the harness protocol.

An actual800dp crash during review (`stage4-provider-key-crash.log`) exposed repeated provider labels sharing Lazy keys. This was repaired by preserving each observation with an independent index-prefixed key; all eight final profiles pass after that repair. Local intermediate build/driver diagnostics remain in ignored `stage4-work/`; meaningful mixed-run failures and the provider crash are retained as reviewable evidence.

## Native HTTP scope and final resource disposition

`discovery-http/PROTOCOL.md` documents the one D-owned actual Hub harness, accepted executable/source boundaries, private ignored credentials, opt-in Android tests and safe restart/close. Hub source/API/storage are accepted production code; only outbound providers are controlled. Explicit metadata/PDF association uses real HTTP and real SQLite/PDF extraction; public Attention PDF bytes were fetched outside the controlled provider boundary. No user library was read/reset and no active Hub generation was replaced with Android settled history. Prior D-only fixture PDFs/annotations were retained and explicitly admitted to the fresh QA profile rather than dropped from the push queue.

E's old native bridge was released through the coordinator. Final D flows were declared complete before shutdown; the coordinator explicitly requested scoped close rather than a handoff. `discovery-http/close-owned.ps1` revalidated executable, full command, start time, profile containment and all listener owners before requesting graceful close. Public evidence is `stage4-resource-disposition.json`; token-free actual route/storage evidence is `stage4-http-final-state.json`, with earlier continuous-helper traces `stage4-http-before-title-fallback.json` and `stage4-http-helper-8836.json` retained.

- D helper PID44380: `C:\Program Files\nodejs\node.exe`, start `2026-10-01T02:01:22.2782470Z`, command `node.exe apps/android/qa/discovery-http/server.bundle.mjs`; loopback7427/6274/6275 all owned by that PID. Graceful stop completed and all ports closed.
- Exclusive5554 launcherPID47840 and headless qemuPID37140: exact SDK executables, Pixel_2_API_34, `-port 5554 -read-only -no-window -no-audio -no-snapshot`, starts `2026-09-30T21:20:37.8108490Z` and `.9381340Z`; IPv4/IPv6 console5554/5555 owned by qemu. Restored physical1080×1920/density420/font1 and actual product en/Light, removed only5554 reverses6274/6275, then `adb -s emulator-5554 emu kill`; both verified exited.
- Current and prior D ports7427/6274/6275/5554/5555/5822/4919 closed at `2026-10-01T02:40:06.4459355Z`. Peer5560 was untouched. No global adb/Orca/server kill, AVD deletion, app-data reset or user-data cleanup occurred. Owned ignored QA SQLite/PDF/private credentials remain available.

## Remaining acceptance boundaries

No real Galaxy Tab/S Pen was used. Actual-window emulator injections and rendered page/ink evidence establish software regression observations, not physical palm/stylus behavior. API29 and API35 runtime, physical keyboard/device behavior and live third-party provider availability/translation quality remain independent system/device gates; this actual runtime is API34. The controlled native harness deliberately avoids external provider account limits and nondeterministic news content while exercising actual failure/storage/cache/routing code. Root integration and E's independent final QA remain coordinator-owned work.
