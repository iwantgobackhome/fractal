# Fractal design review — scholarly iteration 02

Status: **iteration 02 accepted by the coordinator for implementation handoff** after representative visual review against the user's clarified direction. Production React/Compose components and shared contracts are unchanged. The coordinator subsequently authorized common palette alignment in `packages/shared/tokens/tokens.json` and its two generated platform files; see [token-alignment.md](token-alignment.md). Scope is requests 1–13; translated-to-original annotation mapping (request 14) is excluded. Acceptance covers the design direction; native behavior and shipping quality still need implementation verification.

The user first chose a modern workspace, then rejected iteration 01 after seeing it. Their clarified preference is the earlier newspaper/academic identity with richer information and less empty space. Iteration 02 follows that clarification: serif titles, warm neutral paper, fine rules, publication details, research-index rows, restrained red actions and compact reading controls. Existing `docs/design` files are preserved as historical context; [specification.md](specification.md) records the proposed extensions and behaviors.

## Open locally

From the repository root:

```powershell
node docs/implementation/design/prototype/serve.mjs
```

Open **http://127.0.0.1:47831/**. The server binds to loopback only and has no dependencies. If the port is unavailable, pass another one, for example `node docs/implementation/design/prototype/serve.mjs 47833`. Windows denied ports 4178 and 4179 in this run, so the checked server uses 47831. Stop the server with Ctrl+C.

Alternatively open [prototype/index.html](prototype/index.html) directly in a browser. Local storage and clipboard permissions may differ for `file:` URLs; the loopback route is the verified path. Assets and fonts require no external service. Text uses available local fonts; production should use the existing bundled type stack after review.

The dark top strip is a **review tool**, outside the proposed product UI. It selects representative screens, themes and deterministic states. Add `&chrome=hide` to hide this strip when evaluating only the product.

| Representative view | Local URL | Checked viewport, CSS px |
| --- | --- | --- |
| Desktop library | `/?view=desktop-library` | 1440 × 1000 |
| Desktop reader | `/?view=desktop-reader` | 1600 × 1000 |
| Tablet library | `/?view=tablet-library` | 1280 × 900 |
| Tablet reader, original/translation split | `/?view=tablet-reader` | 1280 × 900 |
| Portrait tablet reader | `/?view=tablet-reader` | 800 × 1280 |
| Compact phone library | `/?view=phone` | 390 × 844 |
| Compact phone reader | `/?view=phone&screen=reader` | 390 × 844; dark at 360 × 800 |

Desktop/tablet presets establish navigation treatment; resize the browser to the listed dimensions to evaluate the intended viewport. Phone adaptation activates below 600 CSS px. Below 840 CSS px the reader uses one source/translation pane. The URL can also include `theme=dark`, `theme=sepia`, `state=empty`, `state=loading`, `state=error`, `state=offline`, or `screen=discover`, `screen=news`, `screen=topics`.

## Review the interactions

1. **Library identity:** switch between saved, recently opened and cached papers using the index tabs. An unsaved recent paper has a Save action; reading it does not save it. Search Korean/English titles or authors. A long Korean title and a long English title wrap visibly.
2. **Folders and tags:** expand 언어 모델; open a folder's `⋯` menu to create, rename, move or remove it. Removing a folder explicitly preserves papers and promotes its immediate children to its parent. A paper's `⋯` → 폴더로 이동 opens a multi-select folder editor and editable tags; Attention starts in two folders. Counts de-duplicate papers across nested membership.
3. **Paper reading:** choose a title or 이어 읽기. Tablet selects the paper in the detail panel first. Change page, zoom and source/split/translation view; toggle linked scrolling on wide views. Compact source/translation switches preserve reading position.
4. **Questions:** the default reader has a Korean answer with page citations. Close/reopen the panel; history remains. Send another question or choose 새 질문; the previous question moves to 기록. Change paper and return; its history remains. The history filter separates general questions and explanations.
5. **Selected context:** choose the T tool, select a source passage, then 질문. The composer shows the selected quote and page. Scroll to the figure and select 이 그림 설명하기; the question records the figure context. After sending and starting another question, the explanation appears in the shared history filter.
6. **Notes and pen:** positioned sticky notes are on the **original page only**. Edit their text, collapse/reopen them, drag their heading, or focus the heading and use arrow keys to reposition. The note button adds a source note even when the translated view was active. Pen is the default drawing tool; mouse can simulate strokes. Finger pointer input is ignored by drawing and leaves scrolling available. T enables text selection. Undo/redo are local review interactions.
7. **Selectors:** model, language, sort and theme use custom popovers. Arrow keys and Home/End move focus; Escape closes and restores focus. The note-panel tabs also support arrow keys.
8. **Discovery on Android:** use the tablet rail or phone bottom navigation for discovery, field news and topics. Conference, journal and preprint examples share the same grammar. Translate a news title, open its plain-text example, or manage topic following.
9. **Unavailable services:** choose offline/error/loading/empty in the review strip. Related → 응답 지연 상태 보기 keeps cached related items visible and offers retry. This is a local simulation of busy scholarly services, not a live Semantic Scholar result.

Review edits are stored in this browser's local storage under `fractal-scholarly-review-v2`. For clean fixtures, clear that key in browser storage or run the inspection command below, which creates an isolated temporary browser profile. Nothing is synced to the hub.

## Evidence and limits

Run a loopback server first, then:

```powershell
node docs/implementation/design/prototype/inspect.mjs
```

This uses an isolated headless Microsoft Edge process through CDP. It does not mutate an Orca browser tab. Override `FRACTAL_REVIEW_BROWSER` with a compatible Chromium executable if needed. [renders/iteration-02/inspection.json](renders/iteration-02/inspection.json) records actual dimensions, overflow observations, browser exceptions and interaction assertions. PNGs are viewport screenshots, not native Electron or Android captures.

Orca navigation succeeded, but its snapshot/screenshot commands closed the RPC connection while status and orchestration stayed healthy. No app or worker was restarted. Isolated Edge was used for reliable evidence. There has been no physical S Pen, TalkBack, native PDF selection, Electron window or Compose emulator verification; those are implementation-stage checks.

The reader uses a paraphrased, code-native Attention example with a redrawn diagram, not PDF.js or a real PDF bitmap. Other library titles exercise navigation and layout using the same sample reading body. Answers, news, related relationships, translation progress and remote reconnection are deterministic fixtures. Model/language selectors demonstrate focus and selection; alternate-language content, AI generation and export files are not implemented. Highlight creation is an affordance plus an existing sample highlight. Topic creation/refresh and paper import are demonstrative local flows. The pen engine is a simple SVG interaction, not the production Android ink engine.

See [state-accessibility.md](state-accessibility.md) for checked behaviors and remaining native verification. See [visual-values.json](visual-values.json) for intended colors, type and dimensions, and [assets/branch-master.svg](assets/branch-master.svg) for the reusable transparent branch master. See [revision-history.md](revision-history.md) for the rejected iteration and the rationale behind the revision.
