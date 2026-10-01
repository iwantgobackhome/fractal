# Actual 0.2.0 native CI and final release documentation

The coordinator confirmed [public release v0.2.0](https://github.com/iwantgobackhome/fractal/releases/tag/v0.2.0), ID `400840376`, with `draft:false`, `prerelease:false` and publication timestamp `2026-10-01T10:12:52Z`. All 26 uploaded assets remained intact. The four README languages, desktop/Android guides, changelog and release notes now describe actual availability and link the six payloads and aggregated checksum manifest. This is a documentation-only follow-up after the immutable tagged build; it changes neither build source, versions nor published artifacts.

## Source, actual CI and artifacts

The immutable tag and final [Actions run 36845792076](https://github.com/iwantgobackhome/fractal/actions/runs/36845792076) use exact source `c75ea15f806382f88e7a26e03da17a7f4f505b56`. All five native jobs, aggregate verification and draft publication succeeded. The coordinator downloaded final artifacts under its isolated `tag-36845792076` review directory and checked all 25 aggregate checksum rows plus all 26 GitHub uploaded names, sizes and digests. Independent QA reviewed final source/resource/native/package/APK evidence before the coordinator promoted the draft.

[Published evidence](published-evidence.json) records exact source/run records, actual desktop native startup flags/binary hashes, Android certificate facts, release metadata and six payload hashes/sizes. [The copied aggregate manifest](published-SHA256SUMS.txt) preserves the exact reviewed bytes; the public [SHA256SUMS.txt](https://github.com/iwantgobackhome/fractal/releases/download/v0.2.0/SHA256SUMS.txt) is the download verification entry point. This worker read those actual public artifact records and reports their origin; it did not execute the foreign-platform jobs or mutate the release.

| Actual native host | Published payload and verification scope |
| --- | --- |
| Windows 2025 x64 | Unsigned NSIS; shipped Electron, bundled Hub/UI/library API and native PTY spawn passed. |
| Ubuntu 24.04 x64 | AppImage and Debian amd64 package; shipped Electron, Hub/UI/library API and native PTY spawn passed. Both release filenames use the documented `linux-x64` convention. |
| macOS 15 Apple Silicon | arm64 DMG; ad-hoc signed and unnotarized; actual bundled Hub/UI/library API/native PTY passed. |
| macOS 15 Intel | x64 DMG; ad-hoc signed and unnotarized; actual bundled Hub/UI/library API/native PTY passed. These are separate architecture apps. |
| Ubuntu Android build host | JDK 17/SDK 35 debug APK; actual app ID `app.fractal.reader`, version 0.2.0/code 2, minSdk 29/targetSdk 35, valid debug signature and prior public certificate match. |

The final APK SHA-256 is `dc65d977bbd31d70f390ae648f4dbe9e2e326c9d8f406249663d5e0c16c5f549`, exactly matching the accepted successful branch CI APK. Its public certificate remains `62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f`. The existing v0.1.0 tag, release, artifacts and signing identity were preserved.

## Concrete corrections and evidence boundaries

First actual run [36837312879](https://github.com/iwantgobackhome/fractal/actions/runs/36837312879) exposed the removed Android SDK `tools` package, empty Mac signing variables interpreted as a certificate path, and Linux target architecture aliases that broke manifest filenames. Owned correction `cace60f5c76ede1a50d05cc2ee4229dcda9f3b5b` fixed those exact causes; [repair 01](ci-repair-01.md) records the actual logs and focused Bash/installed-builder checks. Windows and Linux had already proved native packaged startup in that first run.

Second run [36839666433](https://github.com/iwantgobackhome/fractal/actions/runs/36839666433) passed all four desktop jobs but rejected the APK's different signer. Owned correction `014a91b76a6f0b0dbd1bd7e78ba9d7db2a7e7d20` bound restore and Gradle to one explicit CI path, added prebuild public-certificate validation and preserved the final APK guard. [Repair 02](ci-repair-02.md) records actual AGP path inspection and disposable-key/configuration-only Gradle proof. Third branch run [36842896212](https://github.com/iwantgobackhome/fractal/actions/runs/36842896212) passed all five native jobs and aggregate checksums before the same accepted source was tagged. No gate was weakened and no private source key or repository secret was inspected by this worker.

The retained client capture APK is a different binary from the release APK. Independent comparison found 461/462 non-META application entries identical; the remaining DEX difference concerns three generated ResearchDesk Compose methods, while 794 other classes and all resources match. Read-only crosschecks confirmed identical final ReaderApplication class bodies with `$stable=8`, SDK/application identity equality, and the generated comparison/flag specialization. The coordinator accepted independent semantic/source correspondence; no byte-identical-APK or new installation claim is made. The final tagged APK matches the accepted branch APK exactly.

[Screenshot provenance](../../../assets/readme/v020-screens.json) remains unchanged: four accepted discovery captures from client source `edd8019808c923c58f3964528bb57832f79b72d6`, producer artifact commit `54b4d1ee2c297187d307c7bc7f06750b9093875e`, source Electron version 0.2.0 and native debug APK on API 34. The retained reader illustration is earlier accepted version 0.1.0 evidence. Those visuals are qualified separately from native CI, and their original PNG bytes are preserved.

Actual bundled startup is not a full installation or interactive GUI certification on every OS. No physical-device, API 35 runtime, paid Apple signing/notarization or live provider-wide qualification is claimed. Discovery still has source-dependent image/PDF coverage and readable text fallback.

## Final checks and cleanup

Focused final checks verify coherent versions, unchanged accepted screenshot bytes/alt text, navigation, all local links and exact six-file public download URLs in all four languages. [The final gate record](published-docs-gates.log) records results. No final package was rebuilt after the tag and no remote GitHub mutation was performed by this worker. The coordinator retains release-body update and documentation integration ownership.

The focused restore tests created only disposable synthetic keys in unique ignored directories and removed them on completion; the configuration-only Gradle helper processes exited naturally. No user keystore, app profile, AVD, published artifact or peer process was changed or cleaned up. Ordinary ignored Gradle/review/tool output remains, and all assigned source/documentation changes are committed.
