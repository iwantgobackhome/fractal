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
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.pointerInput
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
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfRect
import app.fractal.pdf.PdfTextSelection
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

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
    contentOverlay: @Composable BoxScope.(Int, Int, OriginalTextPage?) -> Unit = { _, _, _ -> },
) {
    val colors = LocalFractalColors.current
    val density = LocalDensity.current
    val loadingSelection = libraryText("Text selection is loading.", "텍스트 선택을 준비하고 있습니다.")
    val noTextSelection = libraryText("This page has no selectable text. Choose a region for a scan or figure.", "이 페이지에는 선택할 텍스트가 없습니다. 스캔이나 그림은 영역을 선택하세요.")
    val offlineSelection = libraryText("Text selection is unavailable. Reconnect to cache text, or choose a region.", "텍스트를 선택할 수 없습니다. 다시 연결해 텍스트를 저장하거나 영역을 선택하세요.")
    val missedSelection = libraryText("No selectable text here. Choose a region for a figure.", "여기에는 선택할 텍스트가 없습니다. 그림은 영역을 선택하세요.")
    val changedSelection = libraryText("The PDF changed. Reopen it before selecting text.", "PDF가 변경되었습니다. 다시 열고 텍스트를 선택하세요.")
    var textPage by remember(source, index) { mutableStateOf<OriginalTextPage?>(null) }
    var textStatus by remember(source, index) { mutableStateOf(loadingSelection) }
    LaunchedEffect(source, index) {
        val result = withContext(Dispatchers.IO) { app.originalText.page(paperKey, source.pdfSha256, index + 1, source.pageCount) }
        textPage = result.page
        textStatus = if (result.page?.coverage == "no_text") noTextSelection else if (result.page == null) offlineSelection else ""
    }
    val geometry = remember(textPage) { textPage?.let(::OriginalTextGeometry) }
    fun selected(range: OriginalRange): PdfTextSelection = PdfTextSelection(
        text = range.text, rects = range.displayQuads.map(::quadRect), start = range.start, end = range.end,
        provenance = "cached-original-approximate", quads = range.displayQuads.map { quad -> quad.map { it.x.toFloat() to it.y.toFloat() } },
        originalRects = range.originalQuads.map(::quadRect), pdfSha256 = source.pdfSha256,
        extractionVersion = PDF_TEXT_LAYOUT_VERSION, rotation = textPage?.rotation,
    )
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
        var bitmap by remember(source, index, widthPx) { mutableStateOf<android.graphics.Bitmap?>(null) }
        LaunchedEffect(source, index, widthPx) {
            bitmap = withContext(Dispatchers.IO) { source.bitmap(index, widthPx) }
        }
        val height = width / aspect
        Box(Modifier.fillMaxWidth().height(height).clipToBounds()) {
            // Allow the zoomed page its real width; clipping belongs to the viewport, not the page.
            Box(Modifier.offset { IntOffset(boundedPan.roundToInt(), 0) }
                .wrapContentSize(Alignment.TopStart, unbounded = true)
                .width(width).height(height).border(.5.dp, colors.rule).background(colors.surface)) {
                bitmap?.let { rendered ->
                    Image(rendered.asImageBitmap(), null, Modifier.matchParentSize(),
                        colorFilter = if (colors.paper.red < .3f) {
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
                        } else null)
                }
                Canvas(Modifier.matchParentSize()) {
                    highlights.forEach { row ->
                        val json = runCatching { WireJson.format.parseToJsonElement(row.json).jsonObject }.getOrNull()
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
                    selection?.quads?.forEach { quad ->
                        val path = Path()
                        quad.forEachIndexed { point, (x, y) -> if (point == 0) path.moveTo(x * size.width, y * size.height) else path.lineTo(x * size.width, y * size.height) }
                        path.close()
                        drawPath(path, colors.focus.copy(alpha = .23f))
                    }
                }
                InkCanvas(state, tool, Modifier.matchParentSize(),
                    pageSize = Size(widthPx.toFloat(), with(density) { height.roundToPx().toFloat() }),
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
                    onTextSelection = { start, end ->
                        if (!source.identityUnchanged()) onSelectionUnavailable(changedSelection)
                        else if (regionMode) onSelection(region(start.x, start.y, end.x, end.y))
                        else geometry?.select(start.x.toDouble(), start.y.toDouble(), end.x.toDouble(), end.y.toDouble())
                            ?.let { onSelection(selected(it)) }
                            ?: onSelectionUnavailable(textStatus.ifBlank { missedSelection })
                    },
                    onFingerLongPress = { x, y ->
                        if (!source.identityUnchanged()) onSelectionUnavailable(changedSelection)
                        else if (regionMode) onSelection(region((x - .08f).coerceAtLeast(0f), (y - .012f).coerceAtLeast(0f), (x + .08f).coerceAtMost(1f), (y + .012f).coerceAtMost(1f)))
                        else geometry?.wordAt(x.toDouble(), y.toDouble())?.let { onSelection(selected(it)) }
                            ?: onSelectionUnavailable(textStatus.ifBlank { missedSelection })
                    },
                    onFingerDoubleTap = onDoubleTap,
                    onWritingStateChanged = onWritingStateChanged,
                )
                val heightPx = with(density) { height.roundToPx() }
                val latestSelection = rememberUpdatedState(selection)
                if (geometry != null && selection?.start != null && selection.end != null) {
                    listOf(false, true).forEach { endHandle ->
                        val offset = if (endHandle) selection.end else selection.start
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
                contentOverlay(widthPx, heightPx, textPage)
            }
        }
    }
}

private fun quadRect(quad: List<app.fractal.data.TextPoint>): PdfRect {
    val left = quad.minOf { it.x }.coerceIn(0.0, 1.0); val top = quad.minOf { it.y }.coerceIn(0.0, 1.0)
    val right = quad.maxOf { it.x }.coerceIn(left, 1.0); val bottom = quad.maxOf { it.y }.coerceIn(top, 1.0)
    return PdfRect(left.toFloat(), top.toFloat(), (right - left).toFloat(), (bottom - top).toFloat())
}
