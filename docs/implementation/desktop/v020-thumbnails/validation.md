# Thumbnail client validation checkpoint

The source checkpoint `f66ba73` contains the client implementation, the final 15-second PC deadline, readable serif title correction, full dossier image sizing and large-font phone navigation adjustment. The screenshots were captured from the same production source bytes before the commit was stamped; they are layout evidence on existing desktop `0.1.0` / Android `0.1` builds and are **not** final version 0.2 release artifacts.

## Acceptance evidence

- UI typecheck and production build pass. Five focused image tests cover unsafe routes, same-Hub auth/cache isolation, lease deduplication/cancellation, HTML/oversize rejection and a stalled-body deadline.
- Android debug app and instrumentation APK compile. The native boundary test passes on exclusive read-only API 34 emulator `emulator-5572`: route rejection, token/origin cache identities, cancellation of a delayed captured session and no stale disk admission.
- Actual Electron application captures pass at 1440?900 and 1280?900 for papers, paper dossier, news, news dossier and topics. Both title and figure activate the same dossier; keyboard Enter/Escape and separate Read PDF/Save controls were exercised without invoking Read/Save. Same-origin requests only, no JavaScript errors, zero library and history mutations.
- Native ordinary MainActivity captures pass at phone360, phone360/font2 and tablet1280. Paper/news images appear in lists and dossiers; absent and unregistered/404 image paths preserve readable text. Read/Save remain visible and scrollable at font2; navigation uses two rows without reducing font size. Tablet retains its two-pane research layout.

## Public byte provenance

Only layout metadata and failure titles in this checkpoint are controlled. The actual public PNGs supplied by backend checkpoint `1cb2b6db9496c1c19627dc87ec1857e4f140330d` were selected from downloaded public HTML and validated again by that worker's live authenticated Hub route proof:

| Image | Source | Public content SHA-256 | Bytes |
|---|---|---|---:|
| Paper Figure 1 | https://arxiv.org/html/2609.40325v1/anomaly_taxonomy.png | c4b29afc943f6b8cd2ada156874b70e4967a8f3d5f2951ccb23ce94ca3fa2e84 | 3086692 |
| MIT first article image | https://news.mit.edu/sites/default/files/styles/news_article__image_gallery/public/images/202403/MIT-DMD.png?itok=oIzEyXxR | ac64b89e3b693917a13f75d638e6c7ce5c6816bb3118d8b22b4d451abafd470c | 678963 |

The isolated helper caches these identical public bytes in a real FeedImageStore and serves them through the real authenticated Hub image route. News dossier body text is extracted from actual public HTML by backend `extractArticleHtml`. This is not a live-gathering or PDF-acquisition success claim. No imagegen assets, seeded PDF bytes or user data were used.

## Review and limits

Root reviewed initial desktop/phone/font2/tablet screens. The worker individually inspected final paper/news previews and dossiers: scientific figures remain whole with contain; news index photos crop; dossier images preserve the full image; absent and broken media produce no blank image card or browser broken-icon. Dense metadata and warm paper/rules remain intact.

The runtime used an independently launched `Pixel_2_API_34` with `-read-only -no-window -no-audio -no-snapshot` on exclusive ports 5572/5573. `resource-lifecycle.json` records exact launcher/QEMU/helper identities and listeners; the helper uses 6294/6295. Existing profiles/public-byte supply are retained ignored. No physical Android device, installer installation or final 0.2 package was tested here. Integrated backend/version source, final APK rebuild and actual-metadata documentation hero capture remain coordinated with root; no self-merge or external publication occurred.
