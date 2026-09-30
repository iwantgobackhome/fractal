# Design direction and review history

## Iteration 01 — rejected

The initial brief permitted a modern workspace with layered surfaces and cards. That direction was implemented as an interactive local artifact and reported early. The user rejected the resulting feel and clarified that the earlier research/newspaper identity was preferable; the original problem was excessive emptiness rather than the editorial character itself.

Preserved executable assets: [iterations/01/index.html](iterations/01/index.html). Baseline evidence: [renders/iteration-01/inspection.json](renders/iteration-01/inspection.json), with ten PNGs. The baseline is rejected context, not a recommended alternative.

Observed issues in the renders:

- Saved/recent navigation appeared both in the sidebar and content tabs. Resume cards repeated the same papers shown below.
- Nested folder names broke into fragments in a narrow sidebar, while content cards reserved more space than their metadata needed.
- Green rounded panels, a profile/workspace footer and evenly sized boxes shifted attention toward a generic dashboard identity.
- Reader sidebar, title bar, toolbar, pen rail and pane labels created several persistent navigation layers before the paper.
- Phone adapted the boxes but did not establish a coherent scholarly index. Bottom navigation needed containment within the visible viewport.

## Iteration 02 — proposed after clarified steering

The user asked for the newspaper/academic character enriched with more useful information. The prototype therefore uses full-width serif research-index rows, publication metadata, authors, meaningful Korean summaries, tags/multiple-folder names, reading progress and note counts. A single set of saved/recent/cached tabs replaces duplicated shelf/resume structures. The library sidebar has readable folder labels and topic shortcuts, with no profile/workspace framing.

The reader drops persistent destination navigation, shortens its toolbar layers, retains two reading sheets in wide layouts and restores notes/questions/history/related on demand. Android shares the same visual grammar with touch-sized controls and compact source/translation switching. Original-only positioned annotations follow the coordinator's confirmed backend contract; the early translated-note fixture was removed.

The old `docs/design` documents remain unchanged. Iteration 02 is broadly compatible with their serif hierarchy, hairlines, branch mark, restrained accent and pen/finger distinction, while documenting required extensions for nested folders, custom selectors, persistent filtered history, complete unavailable states and compact navigation.

The coordinator reviewed all five representative views and **accepted iteration 02 for implementation handoff**, confirming that existing implementation authorization persists. Phone metadata was then enlarged and translated highlight/anchor implications were removed. The coordinator extended ownership to the source token JSON and its two generated files for a minimal common palette alignment, retaining existing names and all font/type/spacing scalars. Browser evidence validates dimensions and local interactions, not native ink quality, accessibility certification or live service reliability.
