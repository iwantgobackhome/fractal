# Final 0.2.0 release documentation checkpoint

The four README languages now use the coordinator-accepted final desktop and native Android discovery captures, with meaningful localized alt text and captions. Scholarly typography, multilingual navigation, reading features and distribution tables are preserved. Linux x64 and separate macOS arm64/x64 release links remain visible; the documentation states that 0.2.0 availability follows successful platform CI and review.

## Accepted source and visual evidence

The coordinator accepted production client source `edd8019808c923c58f3964528bb57832f79b72d6` integrated at root `fa6c40ab2955c5f517394726794851bf9785858d`. This worker individually inspected the desktop paper list, desktop news dossier, native paper index and native news index supplied from that source. The paper captures show actual WorldAuditBench metadata and its scientific figure; the news captures show the actual MIT News title, author, date and content image. The desktop hero is the top-of-screen paper list, without technical fixture titles.

The four supplied PNGs were copied without cropping, editing or regeneration into `docs/assets/readme/`. The retained in-app PDF reader illustration was also copied unchanged from earlier accepted evidence. [The screenshot manifest](../../../assets/readme/v020-screens.json) records original paths, complete source commits, PNG dimensions, byte counts, SHA-256 hashes and runtime provenance. The producer's final capture artifact commit was pending when the coordinator authorized this documentation checkpoint; the manifest records that explicitly rather than inventing a commit.

| Evidence | Actual scope |
| --- | --- |
| Desktop paper/news captures | Electron source application version 0.2.0, `packaged:false`; producer runtime PID 45360 and process identity recorded in the manifest. |
| Native paper/news captures | Producer's debug APK version 0.2.0/code 2, SHA-256 `42dd1eda407ccc90abcd646b94cd1c2df363cf53634638ce3088ed7529dde64c`, on read-only API 34 emulator profile 360×800 at 160 dpi. The public certificate matches the stable prior release certificate. These are attributed producer results, not execution by this worker. |
| Retained PDF reader illustration | Earlier accepted packaged version 0.1.0/source `239e444c12c59e1c8752cffb422e086c012ba405`; demonstrates reader layout and does not prove final 0.2.0 packaged execution. |

The captures use isolated examples with actual public metadata and original public image bytes, rather than proving live provider aggregation. The manifest also records the underlying image URLs and hashes. No physical-device or API 35 runtime verification is claimed.

## Capability and native smoke accuracy

The README, desktop/Android guides, changelog and release notes describe the implemented discovery path: first suitable captioned paper HTML figure or article content image, later suitable candidates and source thumbnails on failure, verified local raster caching, and usable text/reading actions when images are unavailable. Image coverage depends on sources; local PDF figure extraction is not claimed.

The earlier follow-up commit `75dd001e2b08b559454bdb0d41fbf1a3fba7d2a6` corrected the packaged smoke's actual production HTTP envelope to `data.papers`. [The native smoke review](native-smoke-review.md) records installed optional PTY module/binary layout, shipped-module resolution, actual spawn requirements, ASAR handling and scoped cleanup. [The built-Hub evidence](built-hub-envelope.json) proves the focused production bundle HTTP response, not packaged desktop startup. No further product-source or packaging change was needed for this documentation checkpoint.

The coordinator verified the public 0.1.0 APK and actual stable local keystore certificate as SHA-256 `62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f` and configured the required private Actions secret plus public certificate variable. Strict matching and failure when the key is absent remain intact. This worker neither read nor copied private key material.

## Focused checks and remaining release work

The final gates check all four languages' accepted image hashes/dimensions/alt text, all local documentation links, navigation, version/branch/tag rejection cases, artifact names, workflow permissions and native host/architecture matrix, stable signing failure, preserved icon bytes, JavaScript syntax and electron-builder configuration schema. Actionlint checks the release workflow, and `git diff --check` checks changed text. Results are recorded in [the gate log](final-docs-gates.log). No broad runtime matrix or duplicate final packaging was started.

The coordinator owns final combined-source CI, every actual packaged Windows/Linux/macOS Hub/PTY smoke, artifact download and checksum review, release availability, and any draft publication decision. Prepared targets and static checks are not treated as successful native builds. No remote push, job, tag, release or published artifact was changed by this worker.

The focused built-Hub probe closed its own Hub process and removed its isolated review data directory. Screenshot review/copying started no app, emulator or browser process; it did not touch existing profiles, app data, signing keys or peer processes. Only ignored `dist/` review/tool outputs remain outside the committed documentation and scripts.
