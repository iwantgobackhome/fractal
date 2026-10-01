# Client thumbnail source checkpoint

Base: `8773926` on accepted `239e444`. Only the dispatched client source and root-authorized additive `HubClient.feedImage` transport changed.

PC now uses validated same-Hub image identities, authenticated `HubApi` fetch with redirect rejection, per-instance deduplication, bounded bytes/cache, lazy intersection admission and object URL cleanup. Papers use contain previews; title and image open the same scholarly dossier with separate Read PDF/Save controls. News home/field/topic cards and extracted article images use the same loader; absent and failed images produce no broken-image box.

Android now renders the existing `DiscoveryPaper.image` in home/field/topic/related lists and paper/news dossiers. The captured session method validates the exact image route, disables redirects, caps body bytes at 5 MiB, cancels OkHttp when the owning coroutine ends and has a 15 second budget. Caller credential/request/mounted checks surround transport, decode, disk and memory admission. Credential-derived one-way cache keys prevent sharing across accounts or Hubs; disk is 24 MiB and memory is 8 MiB with decode sampled to 1024 pixels per dimension.

Validation: UI typecheck passed; four focused PC scope/route/dedupe/cancellation/body tests passed; UI production build passed. Android `:app:compileDebugKotlin :app:assembleDebug :app:assembleDebugAndroidTest` passed with JDK 17. Existing build versions remain 0.1 and do not constitute final 0.2 artifacts.

Runtime screens, focused native delayed-session tests and final integrated-version rebuild remain pending. Public first-figure/news bytes must come from the backend peer route supply, not invented illustrations or seeded PDFs. No request14 work, physical-device test, final release claim, external publication or merge occurred.
