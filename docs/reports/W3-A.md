# W3-A — Android design polish

## Changes

- Replaced the reader's title bar plus page/zoom row with one 48dp bar containing back, a one-line serif title, page count, View, Notes, Questions, and overflow. Fit width moved to overflow. Scrolling down or starting a stylus gesture hides the bar; scrolling up or tapping its top margin restores it. The page stays in place during an active stylus gesture.
- Made the reader bar select the Notes or Questions tab in the existing side panel. View shows Original and, when the hub snapshot contains completed translations, Translation. The translated view uses completed text with source text for pending blocks; page links in the side panel return to the original PDF.
- Empty-text region highlights in Notes show muted `p.N 영역` and a crop from the cached PDF page, capped at 64dp high. The crop is rendered in the background and omitted if the page is unavailable.
- Shortened library row authors to two family names plus `외 N명`. Expanded layouts now keep the library list full width until a paper is selected. The selected pane shows full authors, venue/year, abstract, tags, and Read when those fields exist. The detail pane scrolls.
- Corrected the dark PDF color matrix offset, which had made pages nearly black, added a warm sepia PDF filter, and fixed default text colors in Settings and the Notes panel.

The expanded layout uses **full-width list until selection**. This avoids an empty detail column on first open and lets the first paper remain an explicit user choice.

## Verification

From `apps/android`, with `JAVA_HOME=C:\Program Files\Java\jdk-17.0.2` and `ANDROID_HOME=C:\Users\Home\AppData\Local\Android\Sdk`:

```text
.\gradlew.bat test assembleDebug --console=plain
BUILD SUCCESSFUL in 5s
380 actionable tasks: 9 executed, 371 up-to-date
```

`git diff --check` passed. Emulator: `Galaxy_S23_Ultra_API_33`, resized to 1440×3088/480 dpi for phone and 2560×1600/240 dpi for expanded tablet. The existing cached *Attention Is All You Need* PDF and annotations were used. The phone Notes capture shows the existing 61-point ink stroke on the page, a textless page-1 region highlight, its `p.1 영역` label, and its crop. The reader bar, author shortening, expanded layout, and dark/sepia PDF rendering were checked visually.

| Layout | Capture |
| --- | --- |
| Phone library, light | [W3-A-phone-library.png](W3-A-phone-library.png) |
| Phone reader, light | [W3-A-phone-reader.png](W3-A-phone-reader.png) |
| Phone reader with ink and region highlight in Notes | [W3-A-phone-reader-notes.png](W3-A-phone-reader-notes.png) |
| Phone library, dark | [W3-A-phone-library-dark.png](W3-A-phone-library-dark.png) |
| Phone reader, dark | [W3-A-phone-reader-dark.png](W3-A-phone-reader-dark.png) |
| Phone library, sepia | [W3-A-phone-library-sepia.png](W3-A-phone-library-sepia.png) |
| Phone reader, sepia | [W3-A-phone-reader-sepia.png](W3-A-phone-reader-sepia.png) |
| Expanded library before selection | [W3-A-tablet-library-unselected.png](W3-A-tablet-library-unselected.png) |
| Expanded library with detail | [W3-A-tablet-library-detail.png](W3-A-tablet-library-detail.png) |
| Expanded reader and Notes | [W3-A-tablet-reader-notes.png](W3-A-tablet-reader-notes.png) |

## Limits

- The sample paper has no completed translation, so the conditional Translation item could not be exercised on the emulator. Original PDF reading was exercised both online and from its cache.
- The dark filter inverts colors, so colored PDF figures can change hue; the sepia filter warms colors. Both keep this test PDF legible. Check figure fidelity and S Pen behavior on the target Galaxy Tab.
