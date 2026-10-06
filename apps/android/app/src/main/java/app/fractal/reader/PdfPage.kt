package app.fractal.reader

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.Text
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Path
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.unit.dp
import app.fractal.data.AnnotationEntity
import app.fractal.data.WireJson
import app.fractal.data.OriginalTextPage
import app.fractal.data.OriginalTextGeometry
import app.fractal.data.OriginalRange
import app.fractal.data.PDF_TEXT_LAYOUT_VERSION
import app.fractal.design.LocalFractalColors
import app.fractal.ink.InkCanvas
import app.fractal.ink.InkPageState
import app.fractal.ink.InkStroke
import app.fractal.ink.InkToolState
import app.fractal.pdf.PdfRenderBudget
import app.fractal.pdf.PdfTileSpec
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfRect
import app.fractal.pdf.PdfTextSelection
import kotlin.math.roundToInt
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal val PdfTilePageWidth = SemanticsPropertyKey<Int>("PdfTilePageWidth")
internal val PdfTilePixels = SemanticsPropertyKey<Int>("PdfTilePixels")

@Composable
fun PdfPage(
    app: ReaderApplication,
    source: PdfPages,
    paperKey: String,
    index: Int,
    zoom: Float,
    state: InkPageState,
    tool: InkToolState,
    highlights: List<AnnotationEntity>,
    onFingerGesture: (panY: Float, zoom: Float, focusY: Float) -> Unit,
    onSelection: (PdfTextSelection) -> Unit,
    onDoubleTap: () -> Unit,
    onWritingStateChanged: (Boolean) -> Unit,
    onInkChanged: (List<InkStroke>, List<InkStroke>) -> Unit,
    nativeViewport: android.graphics.Rect? = null,
    selection: PdfTextSelection? = null,
    regionMode: Boolean = false,
    onSelectionUnavailable: (String) -> Unit = {},
    onBackgroundTap: () -> Unit = {},
    onStructureTap: (Float, Float) -> Boolean = { _, _ -> false },
    onHighlightTap: () -> Unit = {},
    contentOverlay: @Composable BoxScope.(Int, Int, OriginalTextPage?) -> Unit = { _, _, _ -> },
) {
    val parsedHighlights = remember(highlights) {
        highlights.map { row -> runCatching { WireJson.format.parseToJsonElement(row.json).jsonObject }.getOrNull() }
    }
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    var liveSelection by remember(source, index) { mutableStateOf<PdfTextSelection?>(null) }
    val displayedSelection = liveSelection ?: selection
    var tappedHighlight by remember { mutableStateOf<JsonObject?>(null) }
    var tapPosition by remember { mutableStateOf(0f to 0f) }
    var memoHighlight by remember { mutableStateOf<JsonObject?>(null) }
    var memoText by remember { mutableStateOf("") }
    val density = LocalDensity.current
    val loadingSelection = libraryText("Text selection is loading.", "텍스트 선택을 준비하고 있습니다.")
    val noTextSelection = libraryText("This page has no selectable text. Choose a region for a scan or figure.", "이 페이지에는 선택할 텍스트가 없습니다. 스캔이나 그림은 영역을 선택하세요.")
    val offlineSelection = libraryText("Text selection is unavailable. Reconnect to cache text, or choose a region.", "텍스트를 선택할 수 없습니다. 다시 연결해 텍스트를 저장하거나 영역을 선택하세요.")
    val missedSelection = libraryText("No selectable text here. Choose a region for a figure.", "여기에는 선택할 텍스트가 없습니다. 그림은 영역을 선택하세요.")
    val changedSelection = libraryText("The PDF changed. Reopen it before selecting text.", "PDF가 변경되었습니다. 다시 열고 텍스트를 선택하세요.")
    var textPage by remember(source, index) { mutableStateOf<OriginalTextPage?>(null) }
    var textStatus by remember(source, index) { mutableStateOf(loadingSelection) }
    var textRetry by remember(source, index) { mutableStateOf(0) }
    var retryable by remember(source, index) { mutableStateOf(false) }
    var textLoading by remember(source, index) { mutableStateOf(true) }
    LaunchedEffect(source, index, textRetry) {
        textLoading = true
        retryable = false
        if (!source.identityUnchanged()) { textStatus = changedSelection; textLoading = false; return@LaunchedEffect }
        val result = withContext(Dispatchers.IO) { app.originalText.page(paperKey, source.pdfSha256, index + 1, source.pageCount) }
        textPage = result.page
        textStatus = if (result.page?.coverage == "no_text") noTextSelection else if (result.page == null) offlineSelection else ""
        retryable = result.retryable && result.page == null
        textLoading = false
    }
    val geometry = remember(textPage) { textPage?.let(::OriginalTextGeometry) }
    // A cached layout can finish loading between a native event and the next Compose frame.
    fun currentGeometry() = geometry?.takeIf { it.page == textPage } ?: textPage?.let(::OriginalTextGeometry)
    fun selected(range: OriginalRange): PdfTextSelection = PdfTextSelection(
        text = range.text, rects = range.displayQuads.map(::quadRect), start = range.start, end = range.end,
        provenance = "cached-original-approximate", quads = range.displayQuads.map { quad -> quad.map { it.x.toFloat() to it.y.toFloat() } },
        originalRects = range.originalQuads.map(::quadRect), pdfSha256 = source.pdfSha256,
        // Character offsets synthesized inside a run are not published boundaries, so they stay off the layout range.
        extractionVersion = PDF_TEXT_LAYOUT_VERSION.takeIf { textPage?.let { it.publishes(range.start) && it.publishes(range.end) } == true },
        rotation = textPage?.rotation,
    )
    LaunchedEffect(highlights, textPage) { textPage?.let { repairLayoutRanges(app, highlights, it, source.pdfSha256) } }
    fun region(startX: Float, startY: Float, endX: Float, endY: Float) = PdfTextSelection("", listOf(PdfRect(
        minOf(startX, endX), minOf(startY, endY), kotlin.math.abs(endX - startX).coerceAtLeast(.01f),
        kotlin.math.abs(endY - startY).coerceAtLeast(.01f))), provenance = "deliberate-region",
        pdfSha256 = source.pdfSha256, rotation = textPage?.rotation)
    BoxWithConstraints(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        val width = maxWidth * zoom
        val widthPx = with(density) { width.roundToPx() }
        val viewportWidthPx = with(density) { maxWidth.toPx() }
        var horizontalPan by remember(source, index) { mutableStateOf(0f) }
        val boundedPan = horizontalPan.coerceIn(minOf(0f, viewportWidthPx - widthPx), 0f)
        // Page dimensions are available before bitmap rendering; do not lay out a guessed ratio.
        val aspect = remember(source, index) { source.aspectRatio(index) }
        var bitmap by remember(source, index) { mutableStateOf<android.graphics.Bitmap?>(null) }
        // Keep one viewport-width base at every zoom; a late base render cannot downgrade it.
        val baseWidthPx = viewportWidthPx.roundToInt()
        LaunchedEffect(source, index, baseWidthPx) {
            if (bitmap != null) kotlinx.coroutines.delay(200)
            try {
                val rendered = withContext(Dispatchers.IO) {
                    val context = kotlinx.coroutines.currentCoroutineContext()
                    source.bitmap(index, baseWidthPx) { context.ensureActive() }
                }
                if (bitmap == null || rendered.width >= bitmap!!.width) bitmap = rendered
            } catch (_: OutOfMemoryError) { /* Keep the displayed base under heap pressure. */ }
        }
        // Retain one coordinate frame through pen-up; viewport changes must not resize a wet stroke.
        var inkViewport by remember(source, index) { mutableStateOf<Pair<IntRect, Size>?>(null) }
        var writingViewport by remember(source, index) { mutableStateOf<Pair<IntRect, Size>?>(null) }
        var visibleTile by remember(source, index) { mutableStateOf<PdfTileSpec?>(null) }
        var tile by remember(source, index) { mutableStateOf<Pair<PdfTileSpec, android.graphics.Bitmap>?>(null) }
        LaunchedEffect(source, index, zoom, visibleTile) {
            val spec = visibleTile ?: return@LaunchedEffect
            if (zoom <= 1f) return@LaunchedEffect
            kotlinx.coroutines.delay(200)
            try {
                val rendered = withContext(Dispatchers.IO) {
                    val context = kotlinx.coroutines.currentCoroutineContext()
                    source.tileBitmap(index, spec) { context.ensureActive() }
                }
                tile = spec to rendered
            } catch (_: OutOfMemoryError) { /* The scaled base and previous tile remain visible. */ }
        }
        val height = width / aspect
        Box(Modifier.fillMaxWidth().height(height).clipToBounds()) {
            // Allow the zoomed page its real width; clipping belongs to the viewport, not the page.
            Box(Modifier.offset { IntOffset(boundedPan.roundToInt(), 0) }
                .wrapContentSize(Alignment.TopStart, unbounded = true)
                .width(width).height(height).onGloballyPositioned { coordinates ->
                    val origin = coordinates.positionInWindow()
                    val bounds = androidx.compose.ui.geometry.Rect(origin.x, origin.y, origin.x + coordinates.size.width, origin.y + coordinates.size.height)
                    val viewport = nativeViewport?.let { androidx.compose.ui.geometry.Rect(it.left.toFloat(), it.top.toFloat(), it.right.toFloat(), it.bottom.toFloat()) }
                        ?: coordinates.findRootCoordinates().boundsInWindow()
                    val intersection = bounds.intersect(viewport)
                    inkViewport = if (intersection.width <= 0 || intersection.height <= 0) null else {
                        val left = (intersection.left - bounds.left).roundToInt().coerceIn(0, coordinates.size.width)
                        val top = (intersection.top - bounds.top).roundToInt().coerceIn(0, coordinates.size.height)
                        val right = (intersection.right - bounds.left).roundToInt().coerceIn(left, coordinates.size.width)
                        val bottom = (intersection.bottom - bounds.top).roundToInt().coerceIn(top, coordinates.size.height)
                        (IntRect(left, top, right, bottom) to Size(coordinates.size.width.toFloat(), coordinates.size.height.toFloat()))
                            .takeIf { right > left && bottom > top }
                    }
                    visibleTile = if (intersection.width <= 0 || intersection.height <= 0) null else PdfRenderBudget.tile(
                        widthPx, with(density) { height.roundToPx() },
                        (intersection.left - bounds.left).roundToInt(), (intersection.top - bounds.top).roundToInt(),
                        intersection.width.roundToInt(), intersection.height.roundToInt())
                }.border(.5.dp, colors.rule).background(colors.surface)) {
                val paperFilter = if (colors.paper.red < .3f) {
                            ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(
                                -.8f, 0f, 0f, 0f, 255f,
                                0f, -.8f, 0f, 0f, 255f,
                                0f, 0f, -.8f, 0f, 255f,
                                0f, 0f, 0f, 1f, 0f,
                            )))
                        } else if (colors.paper.blue < .9f) {
                            ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(
                                .80f, 0f, 0f, 0f, 40f,
                                0f, .78f, 0f, 0f, 37f,
                                0f, 0f, .72f, 0f, 28f,
                                0f, 0f, 0f, 1f, 0f,
                            )))
                        } else null
                bitmap?.let { rendered ->
                    Image(rendered.asImageBitmap(), null, Modifier.matchParentSize().testTag("pdf-page-${index + 1}-bitmap"),
                        colorFilter = paperFilter)
                }
                if (zoom > 1f) tile?.let { (spec, rendered) ->
                    val x = width * (spec.left.toFloat() / spec.pageWidth)
                    val y = height * (spec.top.toFloat() / spec.pageHeight)
                    Image(rendered.asImageBitmap(), null,
                        Modifier.offset(x, y).size(width * (spec.width.toFloat() / spec.pageWidth), height * (spec.height.toFloat() / spec.pageHeight))
                            .testTag("pdf-page-${index + 1}-tile").semantics {
                                this[PdfTilePageWidth] = spec.pageWidth
                                this[PdfTilePixels] = rendered.width * rendered.height
                            }, colorFilter = paperFilter)
                }
                Canvas(Modifier.matchParentSize()) {
                    parsedHighlights.forEach { json ->
                        val provenance = json?.get("provenance") as? kotlinx.serialization.json.JsonObject
                        if (sourceContextStatus(provenance, source.pdfSha256, index + 1, textPage) !in listOf("current", "unknown")) return@forEach
                        if (provenance?.get("coordinateSpace")?.jsonPrimitive?.content == "unrotated-crop-normalized-v1" && textPage == null) return@forEach
                        val color = highlightColor(json?.get("color")?.jsonPrimitive?.content ?: "yellow").copy(alpha = .38f)
                        val rects = json?.get("rects")?.jsonArray.orEmpty()
                        rects.forEach { item ->
                            val rect = item.jsonObject
                            fun value(key: String) = rect[key]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                            val displayed = renderedRect(PdfRect(value("x"), value("y"), value("width"), value("height")), provenance, textPage?.rotation ?: 0)
                            drawRect(color, topLeft = androidx.compose.ui.geometry.Offset(displayed.x * size.width, displayed.y * size.height),
                                size = Size(displayed.width * size.width, displayed.height * size.height))
                        }
                        val note = json?.get("note")?.jsonPrimitive?.content
                        if (!note.isNullOrBlank() && note != "null" && rects.isNotEmpty()) {
                            val end = rects.last().jsonObject
                            fun value(key: String) = end[key]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                            val displayed = renderedRect(PdfRect(value("x"), value("y"), value("width"), value("height")), provenance, textPage?.rotation ?: 0)
                            drawCircle(colors.ink, radius = 5.dp.toPx(), center = androidx.compose.ui.geometry.Offset((displayed.x + displayed.width) * size.width, displayed.y * size.height))
                        }
                    }
                    if (displayedSelection?.quads.isNullOrEmpty()) displayedSelection?.rects?.forEach { rect ->
                        drawRect(colors.focus.copy(alpha = .23f), androidx.compose.ui.geometry.Offset(rect.x * size.width, rect.y * size.height), Size(rect.width * size.width, rect.height * size.height))
                        drawRect(colors.focus, androidx.compose.ui.geometry.Offset(rect.x * size.width, rect.y * size.height),
                            Size(rect.width * size.width, rect.height * size.height), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
                    }
                    displayedSelection?.quads?.forEach { quad ->
                        val path = Path()
                        quad.forEachIndexed { point, (x, y) -> if (point == 0) path.moveTo(x * size.width, y * size.height) else path.lineTo(x * size.width, y * size.height) }
                        path.close()
                        drawPath(path, colors.focus.copy(alpha = .23f))
                    }
                }
                val inkFrame = writingViewport ?: inkViewport
                val rect = inkFrame?.first ?: IntRect.Zero
                InkCanvas(state, tool, Modifier.offset { IntOffset(rect.left, rect.top) }
                    .wrapContentSize(Alignment.TopStart, unbounded = true)
                    .size(with(density) { rect.width.toDp() }, with(density) { rect.height.toDp() })
                    .testTag("pdf-page-${index + 1}-ink"),
                    pageSize = inkFrame?.second ?: Size.Zero,
                    visible = inkFrame != null,
                    pageOrigin = Offset(rect.left.toFloat(), rect.top.toFloat()),
                    paperKey = paperKey,
                    page = index + 1,
                    deviceId = app.credentials.load()?.deviceId ?: "android",
                    onStrokesChanged = { onInkChanged(it.before, it.after) },
                    onFingerTransform = { gesture ->
                        val factor = (zoom * gesture.zoom).coerceIn(.5f, 4f) / zoom
                        horizontalPan = (boundedPan + gesture.panX - gesture.focusX * (factor - 1f))
                            .coerceIn(minOf(0f, viewportWidthPx - widthPx * factor), 0f)
                        onFingerGesture(gesture.panY, factor, gesture.focusY)
                    },
                    fingerScrollsParent = true,
                    nativeInkRouting = nativeViewport != null,
                    nativeViewportInWindow = nativeViewport,
                    regionMode = regionMode,
                    onSelectionCanceled = { liveSelection = null },
                    onSelectionProgress = { start, end, finished ->
                        if (source.identityUnchanged()) {
                            val current = currentGeometry()
                            val value = if (regionMode) region(start.x, start.y, end.x, end.y)
                            else if (kotlin.math.hypot(end.x - start.x, end.y - start.y) < .005f)
                                current?.wordAt(start.x.toDouble(), start.y.toDouble())?.let(::selected)
                            else current?.select(start.x.toDouble(), start.y.toDouble(), end.x.toDouble(), end.y.toDouble())?.let(::selected)
                            if (finished) {
                                val result = value ?: liveSelection
                                liveSelection = null
                                if (result != null) onSelection(result) else onSelectionUnavailable(textStatus.ifBlank { missedSelection })
                            } else liveSelection = value
                        }
                    },
                    onFingerTap = { x, y ->
                        tappedHighlight = highlights.asReversed().firstNotNullOfOrNull { row ->
                            val json = runCatching { WireJson.format.parseToJsonElement(row.json).jsonObject }.getOrNull() ?: return@firstNotNullOfOrNull null
                            val provenance = json["provenance"] as? JsonObject
                            if (sourceContextStatus(provenance, source.pdfSha256, index + 1, textPage) !in listOf("current", "unknown")) return@firstNotNullOfOrNull null
                            if (provenance?.get("coordinateSpace")?.jsonPrimitive?.content == "unrotated-crop-normalized-v1" && textPage == null) return@firstNotNullOfOrNull null
                            json.takeIf { json["rects"]?.jsonArray.orEmpty().any { item ->
                                val r = item.jsonObject
                                fun v(key: String) = r[key]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                                val rect = renderedRect(PdfRect(v("x"), v("y"), v("width"), v("height")), provenance, textPage?.rotation ?: 0)
                                x in rect.x..(rect.x + rect.width) && y in rect.y..(rect.y + rect.height)
                            } }
                        }
                        tapPosition = x to y
                        // A tap outside a highlight dismisses the current text selection.
                        if (tappedHighlight != null) onHighlightTap()
                        else if (!onStructureTap(x, y)) onBackgroundTap()
                    },
                    onFingerLongPress = { x, y ->
                        if (!source.identityUnchanged()) onSelectionUnavailable(changedSelection)
                        else currentGeometry()?.wordAt(x.toDouble(), y.toDouble())?.let { liveSelection = selected(it) }
                            ?: onSelectionUnavailable(textStatus.ifBlank { missedSelection })
                    },
                    onFingerDoubleTap = onDoubleTap,
                    onWritingStateChanged = { writing ->
                        writingViewport = if (writing) writingViewport ?: inkViewport else null
                        onWritingStateChanged(writing)
                    },
                )
                val heightPx = with(density) { height.roundToPx() }
                val latestSelection = rememberUpdatedState(displayedSelection)
                if (geometry != null && displayedSelection?.start != null && displayedSelection.end != null) {
                    listOf(false, true).forEach { endHandle ->
                        val offset = if (endHandle) displayedSelection.end else displayedSelection.start
                        geometry.handlePoint(offset!!, endHandle)?.let { point ->
                            val touchPx = with(density) { 48.dp.toPx() }
                            var dragX by remember(geometry, endHandle) { mutableStateOf(0.0) }
                            var dragY by remember(geometry, endHandle) { mutableStateOf(0.0) }
                            var opposite by remember(geometry, endHandle) { mutableStateOf(0) }
                            Box(Modifier.offset { IntOffset((point.x * widthPx - if (endHandle) 0f else touchPx).coerceIn(0.0, (widthPx - touchPx).coerceAtLeast(0f).toDouble()).roundToInt(),
                                (point.y * heightPx).coerceIn(0.0, (heightPx - touchPx).coerceAtLeast(0f).toDouble()).roundToInt()) }
                                .size(48.dp).nativeInkBlocker().semantics { contentDescription = if (endHandle) "Selection end handle" else "Selection start handle" }
                                .pointerInput(geometry, endHandle, widthPx, heightPx) {
                                    detectDragGestures(onDragStart = {
                                        val value = latestSelection.value ?: return@detectDragGestures
                                        val current = geometry.handlePoint(if (endHandle) value.end!! else value.start!!, endHandle) ?: return@detectDragGestures
                                        dragX = current.x; dragY = current.y
                                        opposite = if (endHandle) value.start!! else value.end!!
                                    }) { change, amount ->
                                        change.consume()
                                        if (source.identityUnchanged()) {
                                            dragX += amount.x / widthPx; dragY += amount.y / heightPx
                                            geometry.endpointAt(dragX, dragY)?.let { endpoint ->
                                                geometry.range(opposite, endpoint)?.let { onSelection(selected(it)) }
                                            }
                                        }
                                    }
                                }, contentAlignment = Alignment.Center) {
                                Canvas(Modifier.size(16.dp)) { drawCircle(colors.focus) }
                            }
                        }
                    }
                }
                Box(Modifier.offset { IntOffset((tapPosition.first * widthPx).roundToInt(), (tapPosition.second * heightPx).roundToInt()) }.nativeInkBlocker()) {
                    DropdownMenu(expanded = tappedHighlight != null, onDismissRequest = { tappedHighlight = null }) {
                        DropdownMenuItem(text = { Text(libraryText("Delete", "삭제")) }, onClick = {
                            tappedHighlight?.let { original -> scope.launch { editAnnotation(app, original, JsonObject(mapOf("deleted" to JsonPrimitive(true)))) } }
                            tappedHighlight = null
                        })
                        DropdownMenuItem(text = { Text(libraryText("Memo", "메모")) }, onClick = {
                            memoHighlight = tappedHighlight
                            memoText = tappedHighlight?.get("note")?.jsonPrimitive?.content?.takeUnless { it == "null" }.orEmpty()
                            tappedHighlight = null
                        })
                        listOf("yellow", "green", "blue", "pink").forEach { color ->
                            DropdownMenuItem(text = { Text(color) }, onClick = {
                                tappedHighlight?.let { original -> scope.launch { editAnnotation(app, original, JsonObject(mapOf("color" to JsonPrimitive(color)))) } }
                                tappedHighlight = null
                            })
                        }
                    }
                }
                if (memoHighlight != null) AlertDialog(onDismissRequest = { memoHighlight = null },
                    title = { Text(libraryText("Highlight memo", "하이라이트 메모")) },
                    text = { OutlinedTextField(value = memoText, onValueChange = { memoText = it }, minLines = 3) },
                    confirmButton = { TextButton(onClick = {
                        val original = memoHighlight; val note = memoText
                        if (original != null) scope.launch { editAnnotation(app, original, JsonObject(mapOf("note" to JsonPrimitive(note)))) }
                        memoHighlight = null
                    }) { Text(libraryText("Save", "저장")) } },
                    dismissButton = { TextButton(onClick = { memoHighlight = null }) { Text(libraryText("Cancel", "취소")) } })
                contentOverlay(widthPx, heightPx, textPage)
            }
            // This control overlays the fixed paper viewport. It neither inserts a list row nor resets
            // ink/page state, and only retries this mounted physical page using the captured PDF tuple.
            if (retryable) TextButton(onClick = { textRetry++ }, enabled = !textLoading,
                modifier = Modifier.align(Alignment.TopEnd).nativeInkBlocker().background(colors.paper)) {
                Text(libraryText("Retry original text · page ", "원문 텍스트 다시 시도 · 페이지 ") + (index + 1))
            }
        }
    }
}

private fun quadRect(quad: List<app.fractal.data.TextPoint>): PdfRect {
    val left = quad.minOf { it.x }.coerceIn(0.0, 1.0); val top = quad.minOf { it.y }.coerceIn(0.0, 1.0)
    val right = quad.maxOf { it.x }.coerceIn(left, 1.0); val bottom = quad.maxOf { it.y }.coerceIn(top, 1.0)
    return PdfRect(left.toFloat(), top.toFloat(), (right - left).toFloat(), (bottom - top).toFloat())
}
