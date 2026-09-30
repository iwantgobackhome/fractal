# Screen and component specification — proposed scholarly iteration 02

This document is the coordinator-reviewed handoff for requests 1–13. The user's later preference for an enriched scholarly design supersedes the initial modern workspace choice. Representative review has completed and iteration 02 is accepted. Product components/contracts remain unchanged; the coordinator separately authorized the minimal common palette alignment recorded in `token-alignment.md`.

## Existing behavior and proposed extension

| Existing source read | Evidence and design consequence |
| --- | --- |
| `README.md` | Fractal is a paper reader, local library and discovery desk; desktop AI/discovery remains hub-owned and Android reads cached data. Preserve those roles in labels and offline states. |
| `docs/design/principles.md`, `docs/design/android.md` | Serif hierarchy, branching mark, one accent, hairlines, source prominence and pen/finger separation remain appropriate. Required custom controls, complete empty/error states, folders, positioned notes and mobile navigation are deliberate extensions. Existing documents are preserved. |
| `packages/ui/src/shell/LibraryScreen.tsx` | Current all/ready/processing shelves, recent/title sort, title/authors/source/page metadata and bibliography exports form the starting point. Proposed explicit saved/recent distinction and folder hierarchy require reviewed contracts. |
| `packages/ui/src/reader/ReaderBar.tsx` | Current source/split/translation, page/zoom, translation jobs, model choice and paper menu are retained and aligned in two compact toolbar levels. |
| `packages/ui/src/reader/NotesPanel.tsx` | Notes already sort by page and position. Extend to show complete memo text, selected quote, original-page anchor, collapse state and keyboard move. |
| `packages/ui/src/components/ChatPanel.tsx` | Existing composer preserves quotes/drafts, citations and answer status. Proposed archived history unifies general questions and selection/figure explanations instead of destructive new-conversation clearing. |
| `packages/ui/src/reader/RelatedPanel.tsx` | Similar, cited-by and references groups plus loading/unavailable/retry already exist. Keep useful results visible when a scholarly source is busy; expose retry and provenance. |
| `packages/ui/src/shell/FractalMark.tsx` | The same repeating branch geometry is the identity across in-app, launcher and Android icon. This artifact supplies a neutral SVG review master; native launcher/adaptive exports follow approval. |
| Android `MainActivity.kt` | Existing cached library, search/reading/offline filters, long-press paper actions and expanded detail panel inform the tablet index/detail view. Add discovery/news/topics without a desktop-specific account workspace. |
| Android `ReaderScreen.kt` | Current original/translation view and separate list states lack a wide split. Existing control visibility can change content height. Reserve toolbar space and keep page origin stable through pointer input. |
| Android `SidePanel.kt` | Notes/questions and model selection exist. Show memo bodies and retained selected context, then add the shared filtered history and related groups. |

## Visual grammar

- Neutral warm paper surrounds white/cream reading sheets. Light, dark and sepia are coherent variants; chart color and native PDF treatment require later verification.
- Serif titles and paper text establish scholarly character. Korean titles use a readable local serif fallback in the prototype. UI controls use a sans-serif stack. Production should reuse the existing bundled fonts after approval.
- A thin rule separates entries; a 2 px rule starts the research index. Broad content has no rounded card containers. Small borders/radii are reserved for selectors, inputs, sheets and sticky notes.
- Restrained proofreader red identifies the active index tab, links and page citations. Primary import/send actions use ink. Focus uses a distinct blue outline and never relies on color alone.
- Spacing follows 4/8/12/16/24/32 units. Index rows contain actual publication, author, summary, tag, membership and reading information. There is no duplicated resume-card section.
- One master branch mark supplies in-app and launcher identity. The review SVG is neutral on paper; shipping icons must retain shape/weight in dark mode and include transparent/adaptive variants as required by each platform.

## Screen layouts

| View | Anatomy and hierarchy | Proposed interaction |
| --- | --- | --- |
| Desktop library | 244 px sidebar; full research index; single index-tab row; restrained search and import. Each row has ordinal, publication/type/year, full title, authors, Korean summary, tags/folder names, progress and save/read actions. | Title reads immediately. Folder counts include descendants with de-duplication. Saved, recent and cached views remain distinct. Search never erases folders/history. |
| Tablet library | Compact rail; index plus 292 px detail pane at expanded width. Portrait drops the detail pane. | Selecting a title updates the detail; its explicit Read action opens the reader. Large source titles wrap without shrinking. Folder access on compact screens uses a sheet. |
| Desktop reader | Sidebar removed; 54 px title/context bar; concise toolbar; original/translation sheets; 306 px research panel when open. | Split/source/translation, linked scrolling, page/zoom, model/language, notes/questions/history/related, exports. Closing the panel does not end a conversation. |
| Expanded Android reader | Original and translation appear together with equal prominence; pen rail on original side; research panel overlays from right. | Keep source-page anchor and linked reading position. Panel opening does not auto-scroll a page. Drawing is restricted to original. |
| Medium Android reader | One active pane; pen rail retained; source/translation switch. | Preserve page/block/relative position when switching. Side panel overlays, leaving the page origin stable. |
| Compact phone | Single column; four destination bottom navigation for discovery/library/news/topics. Reader removes bottom navigation, uses horizontal tool strip and a note sheet. | Never squeeze two reading pages into a phone. Source/translation switch preserves position; sheet closing retains draft/history. Long titles wrap and list scrolling remains separate from bottom navigation. |

Prototype width boundaries are 600 and 840 CSS px, mirroring existing Compose size classes for review only. Implementation must use available-window dimensions and Compose dp/window-size classes, including split screen and DeX resizing.

## Behavioral contracts

**Save versus recent.** Opening a paper updates its recent/reading position without explicit saving. Save is a separate action. Removing a saved membership keeps recent records and conversation/notes. Cached is a device state, not a saved-library category synonym.

**Nested folders and multiple membership.** Papers can be members of multiple folders and have tags. A parent's count is the unique union of its own memberships and descendants. Creating a child expands the parent. Moving a folder cannot choose itself or its descendants. Removing a folder removes that folder membership, retains every paper and its annotations/history, and promotes immediate child folders to the removed folder's parent. Descendant hierarchy beneath those children remains intact. Removal wording explains these consequences before confirmation.

**Question and explanation history.** A new question archives the previous active exchange; closing a panel simply dismisses it. Record paper, timestamp, kind (general/selected explanation), original or translated text context, source page reference and answer/citations. An explanation launched from a figure or underlined passage appears in the same history, with a filter. Preserve quoted text and figure context in the composer and in stored history. Context should never disappear when the panel closes, a paper changes or an answer fails. A failed send retains its draft; retry must not duplicate the archived exchange.

**Positioned sticky notes.** Anchors refer to physical original pages with normalized coordinates. Notes have editable bodies and optional selected quotes; their list shows both without hiding the memo. Collapse closes the body while retaining the anchor/content. Reopen via the note marker or list entry; distinguish collapse from delete. Position with pen/mouse drag or keyboard arrows; constrain the note to the page. Tap/list jump returns to the source page and note position. Persist locally before sync. No translated anchored notes, remapping or cross-language coordinate promises are introduced.

**Ink and selection.** Stylus draws immediately by default; explicit T switches to text selection. Finger pans/zooms and never becomes a pen stroke. Resolve pointer type before page-scroll or ink ownership. Toolbar dimensions and page origin stay fixed when writing begins/ends; overlay control visibility must not change page coordinates. Native palm rejection, side-button eraser, gesture arbitration and real PDF text geometry require device tests. Translation text can be copied or used as question context; anchored ink/highlight/sticky actions belong to the original only.

**Wide and compact reading.** Expanded Android offers a real original/translation split. Compact switches restore an equivalent page/block position, not the top of the other pane. A semantic page/block anchor is the implementation goal; this static prototype approximates it by page plus normalized scroll fraction. Independent scrolling can be selected on wide views. Annotation positions never depend on translation layout.

**Discovery.** News, followed topics and paper discovery exist on both platforms. Conference, journal and preprint type labels explain origin; topic discovery is not limited to arXiv. Personal topics coexist with taxonomy fields. Cards/rows must identify why a paper is recommended and whether it is saved. Current live coverage remains dependent on backend source support; the prototype uses arXiv, NeurIPS/ICLR/NAACL and JMLR examples.

**Related-service reliability.** Similar/references/cited-by groups preserve their cached results during refresh or rate limiting. Busy is retryable, not an empty-results state. Show that another source or cached data is in use; keep citations and existing reading state usable. Do not claim an unverified live relationship or a successful service response.

## Request traceability

| Request | Review outcome | Implementation-stage handoff |
| --- | --- | --- |
| 1 | Scholarly index and concise reader; one branch SVG master. | Align packaged desktop/in-app icon assets after approval. |
| 2 | Panel closing retains history; general and selected explanations share filtered history. | Persist jobs/context/answers across restart and synchronize retained records. |
| 3 | Saved/recent/cached are separate; nested folders and multi-membership editor. | Use backend-reviewed membership and deletion semantics. |
| 4 | Custom model/language/sort/theme popovers with keyboard focus. | React/Compose components must keep labels and focus behavior. |
| 5 | Conference, journal and preprint publication metadata and discovery examples. | Show actual backend provenance/coverage; add source filters as supported. |
| 6 | Shared scholarly typography, tablet index/detail and compact phone navigation. | Verify real dp/type scaling and window classes. |
| 7 | Android discovery/news/topics and article/title-translation flows. | Connect actual hub endpoints and cached states. |
| 8 | Stable reader geometry; pen default; touch ignored by drawing. | Real S Pen/palm/scroll tests are mandatory. |
| 9 | Shared SVG master previews identity. | Produce/install Android adaptive foreground/background assets after review. |
| 10 | Explicit T tool; quote-aware selection menu. | Verify native PDF text drag/hit testing on both platforms. |
| 11 | Original-page sticky edit/move/collapse/reopen and note-list access. | Implement backend normalized anchors with complete memo and quote rendering. |
| 12 | Tablet split and compact position-preserving switch. | Real Compose original/translation scrolling and reading-anchor state. |
| 13 | Busy/cached/retry related state retains results. | Backend source fallback, provenance and rate-limit handling. |
| 14 | Excluded. | No translated annotation mapping or translated positioned anchors. |
