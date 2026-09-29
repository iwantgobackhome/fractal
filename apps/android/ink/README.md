# Ink module

`:ink` is a page-local vector ink overlay. It uses AndroidX Ink for front-buffered authoring and finished stroke rendering. Coordinates are normalized to the unzoomed page; the host owns the PDF bitmap and any page transform.

## Reader integration

```kotlin
val pageState = remember(paperKey, pageNumber) { InkPageState().apply { load(savedStrokes) } }
val tools = rememberInkToolState() // once at the app level
Box {
    PdfPageBitmap(modifier = Modifier.fillMaxSize())
    InkCanvas(
        state = pageState,
        tool = tools,
        modifier = Modifier.fillMaxSize(),
        pageSize = Size(renderedWidthPx, renderedHeightPx),
        paperKey = paperKey,
        page = pageNumber, // one-based
        deviceId = deviceId,
        onStrokesChanged = { change -> saveAndSync(pageState.export()) },
        onSelectionAsk = { strokes, bounds -> askAboutInk(strokes, bounds) },
        onFingerGesture = { dx, dy, scale -> updatePageTransform(dx, dy, scale) },
    )
}
InkToolbar(pageState, tools)
```

Keep the bitmap and `InkCanvas` at the same untransformed size and apply pan/zoom to their shared parent. `pageSize` is that size in pixels. `onFingerGesture` reports pan in local pixels and a multiplicative pinch scale; the host can apply single-finger pan as scrolling. Only stylus/eraser tools create ink. Palm `ACTION_CANCEL` and `FLAG_CANCELED` discard the live stroke.

`InkPageState.load(strokes)` replaces a page and clears history. `export()` includes deletion tombstones for sync. Every edit, including erasing, lasso transforms, recolouring and undo/redo, invokes `onStrokesChanged`. `InkChange` has `before` and `after` snapshots. Use one state per page; don't share an undo stack between pages. `InkToolbar` exposes undo/redo, tool options, palette, a custom RGB picker, and selection actions. `rememberInkToolState` persists active tool, per-tool widths and colours, recent colours, eraser modes and shape mode in DataStore. Highlighter starts at paper yellow.

`InkJson.encode/decode` serialize lists of `InkStroke`. The shared contract fields stay intact. Android adds optional `brush`, `shape`, and `tilt` fields; the hub zod schema should be extended for them during integration. `brush` is one of `ballpoint`, `fountain`, `pencil`, `highlighter`, `shape`. `shape` has `type` and `snapped`. `tilt` is an array aligned to `points`, where supplied.

The demo app has a blank A4 page and a **Samples** button that loads all four brush renderings. The demo has no persistence for page strokes; it exists for real-tablet feel testing.
