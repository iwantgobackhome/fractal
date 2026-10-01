# Provisional D4 integration diagnostics

Root `msg_c678db0488c1` explicitly authorized bounded read-only current D4 source inspection while owner execution continued. E read D's worktree `C:/Users/Home/orca/workspaces/fractal/fractal-android`, HEAD `56da0caf17aab0e78bab1eef0e620237f00060c0` plus uncommitted D4 source, around00:59UTC on2026-10-01. No peer edit, build, server, data or device operation occurred. These are source diagnostics, **not accepted-source executions or final product certification**. E's accepted review checkout remains clean source920d448 plus this owned report.

Observed file SHA256 at the review checkpoint:

| Source | SHA256 |
| --- | --- |
| sync/DiscoveryRepository.kt | `cd7b0b460e29d670dda3f560ee2e9d96350d564f08aaf63bea9a7681a4e405bb` |
| app/DiscoveryDetails.kt | `2d5b2e2348db0b0818b28963266e3c7cfaf107e2f3bfdd8710878b2b983c7484` |
| app/DiscoveryScreen.kt | `203420e47bd9f5ccfacd70aadad54f81353a27b32d34068f4839945dc8c75f6a` |

## E-D4-02: conflicting publication intents share URL identity

**P2, owner D; source-confirmed.** Reproduction: two distinct publication cards share a URL but have conflicting known DOI/arXiv, authors or year; retain an offline save for the first. Expected: the second retains its own Save action and accurate pending state, and both deliberate saves can be queued/replayed independently. Actual: `DiscoveryRepository.save` calls `enqueue("bookmark",paper.url,...)`; enqueue coalesces same kind/resource. Discovery index/detail pending matching also uses URL. One retained save therefore falsely disables the other card with “Save retained”; direct sequential repository saves replace the first publication intent with the second. The accepted backend's conservative bibliographic identities do not repair a dropped client intent.

Route receipt `msg_685cd40ee34d` requests a conservative bibliographic fingerprint for bookmark intents and all corresponding pending-state checks, preserving same-record replay without merging contradictory identifiers. This was not native-executed by E. Existing model identity tests check library matching, not this queue/pending identity.

## E-D4-03: related-row and dossier state keys collide

**P2, owner D; concrete source risk, native exception not reproduced by E.** For two legitimate related results with equal URL/title but contradictory identifiers, `PaperDiscoveryDetail` uses `key = { it.url + it.title }` in LazyColumn. Both keys are equal, risking duplicate-key failure when both rows participate in composition. The dossier `SaveableStateProvider(paper.url)` and URL-keyed saved detail state also share identity across those publications. Expected: distinct bibliographic records have distinct row/detail identities and retain their own navigation/control state. Route `msg_685cd40ee34d` includes these surfaces with E-D4-02 for one coherent owner correction; no arbitrary title-only collapse is suggested.

## E-D4-04: retained useful rows are relabelled as the newly failed provider

**P2, owner D; source-confirmed.** `DiscoveryRepository.refresh` retains old useful items/fetch time after an empty unavailable/stale/partial related response, but constructs `fresh.copy(items=old.items,fetchedAt=old.fetchedAt,status="stale")`, keeping `fresh.source`. `PaperDiscoveryDetail` prints that source beside the cached status. Existing `failedRelatedFallbackKeepsUsefulRowsAndTheirActualFetchTime` itself supplies old useful `semanticScholar` rows and a fresh empty `openAlex` failure, but asserts only items/time/status/HTTP429. Expected: cached rows retain their actual source/fetch time while fresh providerStatus/errorCode/retryAt describe the new failed refresh independently. Actual source falsely labels the retained S2 result OpenAlex. Route receipt `msg_95c77d9f3ca1` requests this distinction and a focused assertion. No E native execution is claimed.

## Recovery correction review boundary

The WIP `PdfPage` now adds a source/index-specific retry epoch and visible per-page Retry original text overlay, checks unchanged PDF identity before each attempt and hides/disables the retry while loading. This appears to address E-D4-01 without inserting reader rows or replacing paper state. It is provisional source reading only; root requires accepted final code and the actual uncached-first-failure/endpoint-recovery/MainActivity proof before closure. Current root also reports16 passing D4 migration/concurrency tests; final ordinary native discovery/recovery, rich captures and APK hashes remain pending.

No additional unaffected reader matrix, stale APK build or optional emulator image preparation was performed. Root had already routed raw UUID filter-summary cleanup, so it was not duplicated here. Final accepted review must explicitly resolve these diagnostics against the supplied accepted snapshot and current owner evidence.
