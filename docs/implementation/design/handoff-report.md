# Design owner A — implementation handoff

Outcome: the coordinator accepted **scholarly iteration 02** after reviewing all five representative views against the user's clarified preference for a newspaper/academic feel with more useful information. Rejected green/card iteration 01 is preserved; its visuals are not the implementation target. The accepted artifact is executable locally and includes desktop library/reader, tablet library/reader and compact phone layouts.

## Open and inspect

From repository root, run `node docs/implementation/design/prototype/serve.mjs` and open **http://127.0.0.1:47831/**. Direct file opening also works for layout. Use the review strip for representative views, light/dark/sepia and ready/empty/loading/error/offline. Exact routes and interactions are in [README.md](README.md). Hide the review strip with `&chrome=hide` for product-only inspection.

Checked dimensions: desktop library **1440 × 1000**, desktop reader **1600 × 1000**, tablet library/reader **1280 × 900**, portrait tablet reader **800 × 1280**, phone library/reader **390 × 844**, compact phone library/dark reader **360 × 800**. [renders/iteration-02/inspection.json](renders/iteration-02/inspection.json) and seventeen PNGs record viewport renders, zero horizontal page overflow and zero browser exceptions. Final phone metadata was visually inspected at 360 px and essential publication/author/status/tag text is at least 12 px.

The final browser run has **23 passing interaction assertions**: multi-folder membership; reading without saving; folder-retention/promotion wording and action; folder creation; archive on new question; retained answers after closing and changing papers; figure provenance; shared filtered explanation history; sticky collapse; original-only anchors; no translated highlight implication; cached related results/retry; compact position retention; finger/ink separation and stable toolbar geometry; visible phone navigation; legible phone metadata; selector focus/Escape; labelled modal dialog.

Orca navigation succeeded, but snapshot/screenshot RPC calls failed while runtime/orchestration remained available. Evidence uses an isolated headless Edge/CDP process, without restarting Orca or touching the coordinator's separate page. The inspection script uses a temporary profile and cleans up only its own profile/process.

## Artifacts for C/D and QA

- [specification.md](specification.md): source-grounded anatomy, behaviors, contract invariants and request 1–13 traceability.
- [visual-values.json](visual-values.json): exact reviewed palette, type/spacing/rules/radii, panel widths and touch requirements.
- [assets/branch-master.svg](assets/branch-master.svg): reusable transparent identity master for in-app/desktop/Android exports.
- [state-accessibility.md](state-accessibility.md): state matrix, checked interactions and native acceptance checklist.
- [token-alignment.md](token-alignment.md): coordinator-authorized common palette diff and verification.
- [revision-history.md](revision-history.md): rejected baseline diagnosis and clarified design direction.

Desktop implementation should start with the research-index rows, readable nested folders, custom selectors and concise reader hierarchy. Android should share that identity while implementing 48 dp hit areas, discovery/news/topics, wide split and compact reading anchors. Native ink QA must reproduce the vertical-jump issue on S Pen hardware and verify fixed page-origin geometry through pen/finger/control transitions.

## Production scope exception and verification

After prototype acceptance, the coordinator explicitly granted ownership for `packages/shared/tokens/tokens.json`, generated `FractalTokens.kt` and generated UI `tokens.css`. The minimal common palette alignment changes paper/surface/sunken, ink/muted/rules, accent/wash and distinct focus colors across themes. The original token names, fonts and all size/space/radius/motion groups remain unchanged; the generator, components, shared contracts, root coordination files and backend files were not edited.

`npm run tokens` completed. `node docs/implementation/design/prototype/verify-tokens.mjs` confirms deterministic CSS/Kotlin regeneration, scalar/font compatibility and **33 passing contrast pairs**. Sepia secondary text was darkened after the initial 4.35:1 ratio failed; the final paper ratio is **4.75:1**. `git diff --check` passes. No broad product test suite was needed for documentation/prototype assets and generated palette values; native integration QA remains necessary.

## Practical limits

This artifact uses paraphrased HTML sample paper content, deterministic answers/news/related examples and simple SVG pointer interactions. It is not a PDF.js/Compose/S Pen engine or a live AI/discovery service. Translation language/model changes demonstrate selection; only Korean sample content is supplied. Export/import/topic-refresh flows are demonstrative rather than shipping integrations. Highlight creation shows the intended affordance and existing sample highlight. Some compact HTML reader controls are 40 px; Compose must use 48 × 48 dp hit areas, moving optional controls into overflow when necessary.

The positioned-note schema is physical **original-page normalized coordinates only**. Translation has no positioned-note/highlight mirroring; request 14 is excluded. The prototype preserves page plus relative scroll; implementation should use page/block anchors. No native Electron, Compose emulator, physical pen/palm rejection or screen-reader certification is claimed. Product components and behavior changes remain for C/D, with independent QA afterward.

The commit SHA is supplied in the worker completion message. This worker does not merge its own changes.
