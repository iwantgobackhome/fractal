# News Papers for Android — screen specification

Target: Galaxy Tab with S Pen first (11"–14.6", portrait and landscape, split screen, pop-up window, DeX), phones second. Kotlin + Jetpack Compose. The same principles as the desktop apply (`principles.md`): the paper leads, hairlines instead of boxes, one accent, type does the hierarchy, no explanatory sentences. Colours, sizes and spacing come only from `FractalTokens` (generated from `packages/shared/tokens/tokens.json`); themes are light, sepia and dark, following the system by default.

## Window size classes

Use `WindowSizeClass` (width) and react to every resize (split screen and DeX resize freely):

| Width | Layout |
| --- | --- |
| Compact (< 600dp) — phone, narrow split | One column. Library → reader full screen. Notes/questions open as a bottom sheet (half → full). Pen toolbar horizontal at the top. |
| Medium (600–840dp) — tablet portrait, half split | Reader full width; the side panel slides over from the right (≈ 360dp) and dims nothing. Pen toolbar vertical on the left edge. |
| Expanded (≥ 840dp) — tablet landscape, DeX | Library: list + detail side by side. Reader: page + a docked 360–420dp side panel that can be closed. Pen toolbar vertical on the left edge. |

Never hard-code pixel positions; the page is laid out from its aspect ratio and the available width. Test at 360×800, 800×1280, 1280×800, 1848×2960 and while dragging the split-screen divider.

## Screens

### 1. Connect (first run, and Settings → 허브)

- Serif wordmark, one line: "PC의 News Papers와 연결합니다".
- Primary action: **QR 스캔** (CameraX + ML Kit). Secondary text link: "주소와 코드 직접 입력".
- After a successful claim: hub name + address in muted text, "연결됨". Store the device token in EncryptedSharedPreferences / Keystore; never log it.
- If the hub is unreachable later, the app keeps working offline; a thin top line in `muted` says "허브에 연결되지 않음 · 마지막 동기화 3분 전" — no banners, no dialogs.

### 2. Library

- Top: large serif title "보관함" + search field (hairline underline, like desktop). Shelf filters as text tabs: 모든 논문 · 읽는 중 · 오프라인 저장됨.
- Rows exactly like the desktop list: serif title (17sp, 2 lines max), authors "Vaswani, Shazeer 외 6명", meta line in `muted` small: source · pages · added date · a small "↓" glyph when the PDF is cached offline. Hairline between rows. No cards, no thumbnails in v1.
- Pull to refresh = sync now. Long-press a row → 오프라인 저장 / 저장 해제 / 삭제 (bottom sheet menu).
- Expanded: selecting a row shows a detail pane (title, full authors, venue/year, abstract, tags, "읽기" as the one primary button).

### 3. Reader

- The page fills the width (fit-width by default, pinch to zoom 50–400 %, double-tap to toggle fit-width/100 %). Pages scroll vertically with 12dp gaps on the `sunken` background; the page itself is `surface` with a hairline border.
- Top bar (auto-hides while writing or scrolling down, returns on scroll up or tap on the margin): back, serif title (1 line), page "3 / 15", and on the right: 보기(원문/번역 when a translation exists), 질문, ⋯. Height 48dp, `paper` background, bottom hairline.
- **Pen always writes** (stylus), **fingers always scroll/zoom**. No pen mode toggle. With the S Pen side button held the pen erases (H2 engine).
- Text selection with a finger long-press (or pen with the side button + drag? no — keep pen = ink). The selection menu matches desktop: four highlight dots · 메모 · 질문 · 복사, dark `ink` pill above the selection.
- Highlights and memos use the same colours as desktop (`hl*` tokens). A memo shows as a small ink dot at the right edge of the highlight; tapping opens the note in the side panel.
- Dark/sepia: render the page bitmap and then recolour text via a colour matrix only for text-like pixels is out of scope — v1 uses the PDF as is in light, and for dark/sepia draws the page on `surface` with an inverted-luminance filter that keeps hue (figures stay recognisable). Document the limitation.

### 4. Pen toolbar (from H2, reviewed here)

- Vertical rail on the left edge (48dp wide, `paper` background, right hairline) on Medium/Expanded; horizontal strip under the top bar on Compact.
- Order: 볼펜 · 만년필 · 연필 · 형광펜 | 지우개 · 올가미 · 도형 | colour swatches (current + 4 recent) | undo · redo.
- Active tool: a 2dp `ink` bar on the rail side, icon in `ink`; inactive icons `inkSoft`. Tapping the active tool again opens its popover (widths, slider, eraser mode). Swatches are 20dp circles; active has a 2dp ring.
- The rail can be collapsed to a single current-tool button by dragging it to the edge.

### 5. Side panel: 노트 · 질문

- Two text tabs at the top: 노트 (highlights and memos of this paper, in page order, each with its quote in serif and the note below; tap → jump to the spot) and 질문 (the same conversation as desktop, answers as margin notes with the 2dp left rule, `[p.N]` links jump to pages).
- The composer is a single field with a send arrow; model name shown small above it; no suggested prompts.
- Asking about handwriting: lasso → "질문" sends the lasso's page crop image with the question (when the hub supports images; otherwise the lasso action is hidden).

### 6. Settings

Sections separated by hairlines: 허브 (connection, re-pair, forget), 동기화 (Wi-Fi only, auto-download PDFs of opened papers), 필기 (S Pen button: 지우개 / 획 지우개 / 끄기; palm rejection info), 보기 (theme), 정보.

## Sync behaviour (what the UI shows)

- Annotations (highlights, memos, ink) are saved locally first and pushed in the background; nothing in the UI waits for the network.
- Conflicts resolve by the hub's LWW rules silently. If an annotation was deleted elsewhere it disappears without a dialog.
- A paper opened while offline and not cached shows its title and "오프라인 — PC와 연결되면 열 수 있습니다" in the page area (the only explanatory sentence allowed, because it is a state, not a tutorial).

## Do not

Bottom navigation bars with icons+labels, floating action buttons, Material "cards" with elevation, coloured app bars, snackbars for routine success ("저장됨"), emoji, onboarding carousels, gradient or sparkle AI icons.
