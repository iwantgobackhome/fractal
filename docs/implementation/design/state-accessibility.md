# State and accessibility checklist — scholarly iteration 02

Status: coordinator accepted the visual direction. This checklist distinguishes browser-observed prototype behavior from requirements for native implementation.

## UI states

| Surface/state | Review control | Expected behavior | Evidence |
| --- | --- | --- | --- |
| Library ready | Review strip → 기본 | Saved/recent/cached views, long wrapping titles, source/year/type/authors/summary, memberships, tags and progress. | Desktop, tablet and phone PNGs; no horizontal page overflow. |
| Library empty | `state=empty` | No fake counts presented as loaded results; concise discovery/import action. Existing local data is not deleted. | `desktop-library-empty.png`; deterministic fixture. |
| Library loading | `state=loading` | Status announcement and static skeletons; controls remain available. Reduced motion needs no animation. | `desktop-library-loading.png`. |
| Reader loading | Review strip → 로딩 | Page-area loading state without changing toolbar/page origin. | Renderable fixture; not a live PDF loading check. |
| Reader error | `state=error` | Retryable page error; reading position and notes remain in local state. | `desktop-reader-error.png`. |
| Library/reader offline | `state=offline` | Cached work stays readable; uncached paper shows offline-unavailable; question submission is disabled while draft remains. | Phone offline PNG; local state only. |
| Translation absent | Reader → 빈 화면 | Source stays available; translation area provides Start action. | Renderable fixture; alternate-language generation is simulated. |
| Related busy | Related → 응답 지연 상태 보기 | Keep cached results, say refresh is delayed and expose Retry. | Passing related busy assertion. |
| Dark/sepia | Review theme selector or query | Coherent shell, text, reading sheets, rule/focus colors and sticky notes. | Dark phone and sepia tablet PNGs. Native PDF filtering remains unverified. |
| Selected context | T selection → 질문 or figure Explain | Quote/figure name and page remain visible in composer and shared history. | Figure provenance and explanation-history assertions. |

Empty/loading/error controls are review simulations rather than live API results. Before production, counts should come from known local data or be marked unavailable, never inferred from an empty network response.

## Browser checks performed

The authoritative run record is [renders/iteration-02/inspection.json](renders/iteration-02/inspection.json). The inspection script records each assertion's pass/fail result rather than relying on prose.

- [x] Seven saved papers include a paper in two folders; reading an unsaved paper does not save it.
- [x] Folder removal explains retention, retains paper count and promotes children to the parent.
- [x] Folder creation uses the entered name.
- [x] A new question archives the previous question; closing/reopening retains the active answer.
- [x] Changing paper and returning preserves that paper's active question and history.
- [x] Figure questions retain context; general questions and explanations share history and filter correctly.
- [x] Sticky collapse preserves content; all positioned notes anchor to original pages only.
- [x] Related-service busy state preserves visible cached results and a retry action.
- [x] Compact source/translation switches preserve a nonzero reading position and page.
- [x] Finger pointer input leaves ink empty; header and toolbar dimensions remain stable.
- [x] Phone bottom navigation stays within the viewport.
- [x] Custom selector exposes listbox/option roles and initial focus; Escape closes and restores its trigger.
- [x] Import dialog exposes modality and a labelled input.
- [x] Seventeen representative viewport renders have no horizontal page overflow or browser exceptions.
- [x] Phone publication/author/status/tag metadata is at least 12 px; 360 × 800 library and reader renders are included.
- [x] Translation has no copied original highlight or positioned-note implication.
- [x] Final dark and sepia layouts, long Korean/English titles and phone bottom navigation were visually inspected.

## Accessibility requirements and remaining checks

| Requirement | Prototype treatment | Native implementation acceptance |
| --- | --- | --- |
| Keyboard access | Visible 3 px focus outline; skip link; labelled inputs/buttons; Ctrl/⌘ K; Escape; popover arrows/Home/End; note-tab arrows; arrow-key sticky movement. | Verify complete keyboard order in Electron, focus restoration after async state updates and no lost focus when controls disappear. |
| Modal focus | Labelled dialog with `aria-modal`; Tab/Shift-Tab containment and Escape. | Native semantics and TalkBack/keyboard containment; move focus to relevant input; restore trigger. |
| Custom selectors | Listbox/options or menu/menuitems; selected state, keyboard focus and outside/Escape dismissal. | Screen-reader announcement of value, loading/error/no-options states; consistent Compose focus and selected semantics. |
| Touch targets | Major tablet/phone actions are 48 px high; horizontal pen strip scrolls when required. Some compact reader chrome is 40 px in HTML. | **All Compose interactive hit areas at least 48 × 48 dp**, including sticky collapse/drag/menu actions; icon drawing can remain smaller. Avoid adjacent overlapping targets. |
| Text scaling | Wraps full long titles; essential phone metadata enlarged to 12 px; summaries 13 px and panel body 14 px. | Test 200% desktop zoom and Android font scale 1.3/1.5/2.0; preserve controls and full source/author descriptions. No clipping labels to tiny fragments. |
| Contrast | 33 specified shared-token text/focus pairs pass the checks in `renders/token-checks.json`; active state includes rules/labels, not color alone. | Measure remaining widget/image/control boundaries and native rendering. Checked token pairs and browser renders are not a full accessibility certification. |
| Announcements | State/toast status regions and error alerts; labels on icons; form inputs labelled. | Polite answer-complete and archived-history announcements; busy status; no disruptive repeated streaming announcements. |
| Reading order | Semantic main/aside/navigation, logical title→metadata→summary→status; page citations are buttons. | TalkBack/VoiceOver/NVDA checks on real paper text, panes and notes; move focus to source citation location. |
| Motion | Reduced-motion media override; skeletons are static. | Honor Android animator scale/system preference; avoid viewport shifts during pen input and panel animation. |
| Native ink | SVG pointer simulation; finger does not write; control geometry fixed. | Galaxy Tab/S Pen writing at multiple zooms, edge strokes, palm/finger/pen switching, side-button erase, DeX and split resize. Reproduce and eliminate vertical jumping. |
| Selection | Explicit T tool and quote-aware menu; translation supports copy/question only. | Actual PDF text geometry and paragraph/line dragging; selection restoration after page scroll; touch handles and pen selection. |
| Sticky notes | Complete editable body, collapse marker/list, drag and keyboard move. | Persist anchor/body/quote/collapse separately; keep inside page; reopen after app restart/offline; no translated anchors. |
| Offline/errors | Cached view and retained local drafts/history; retry affordances. | Real offline launch, pending sync, API failure/rate limit, failed send without duplicate archives, unavailable model/language and cache misses. |

No physical stylus, native Android screen reader, Electron window, live service or production PDF test is claimed by this artifact. QA ownership should validate those scenarios after C/D implementation and integration.
