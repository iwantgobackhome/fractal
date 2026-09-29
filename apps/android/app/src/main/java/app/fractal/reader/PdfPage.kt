package app.fractal.reader

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.fractal.data.AnnotationEntity
import app.fractal.data.WireJson
import app.fractal.design.LocalFractalColors
import app.fractal.ink.InkCanvas
import app.fractal.ink.InkPageState
import app.fractal.ink.InkStroke
import app.fractal.ink.InkToolState
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfRect
import app.fractal.pdf.PdfTextSelection
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
    onFingerGesture: (Float, Float) -> Unit,
    onSelection: (PdfTextSelection) -> Unit,
    onDoubleTap: () -> Unit,
    onWritingStateChanged: (Boolean) -> Unit,
    onInkChanged: (List<InkStroke>, List<InkStroke>) -> Unit,
) {
    val colors = LocalFractalColors.current
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        val width = maxWidth * zoom
        val widthPx = with(density) { width.roundToPx() }
        var aspect by remember(source, index) { mutableStateOf(.72f) }
        var bitmap by remember(source, index, widthPx) { mutableStateOf<android.graphics.Bitmap?>(null) }
        LaunchedEffect(source, index, widthPx) {
            withContext(Dispatchers.IO) {
                aspect = source.aspectRatio(index)
                bitmap = source.bitmap(index, widthPx)
            }
        }
        val height = width / aspect
        Box(Modifier.width(width).height(height).border(.5.dp, colors.rule).background(colors.surface)) {
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
                    val color = highlightColor(json?.get("color")?.jsonPrimitive?.content ?: "yellow").copy(alpha = .38f)
                    val rects = json?.get("rects")?.jsonArray.orEmpty()
                    rects.forEach { item ->
                        val rect = item.jsonObject
                        fun value(key: String) = rect[key]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                        drawRect(color, topLeft = androidx.compose.ui.geometry.Offset(value("x") * size.width, value("y") * size.height),
                            size = Size(value("width") * size.width, value("height") * size.height))
                    }
                    val note = json?.get("note")?.jsonPrimitive?.content
                    if (!note.isNullOrBlank() && note != "null" && rects.isNotEmpty()) {
                        val end = rects.last().jsonObject
                        val x = (end["x"]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f) +
                            (end["width"]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f)
                        val y = end["y"]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                        drawCircle(colors.ink, radius = 5.dp.toPx(), center = androidx.compose.ui.geometry.Offset(x * size.width, y * size.height))
                    }
                }
            }
            InkCanvas(state, tool, Modifier.matchParentSize(),
                pageSize = Size(widthPx.toFloat(), with(density) { height.roundToPx().toFloat() }),
                paperKey = paperKey,
                page = index + 1,
                deviceId = app.credentials.load()?.deviceId ?: "android",
                onStrokesChanged = { onInkChanged(it.before, it.after) },
                onFingerGesture = { _, dy, factor -> onFingerGesture(dy, factor) },
                onFingerLongPress = { x, y ->
                    val selected = source.select(index, x, y) ?: PdfTextSelection(
                        text = "",
                        rects = listOf(PdfRect((x - .08f).coerceAtLeast(0f), (y - .012f).coerceAtLeast(0f), .16f, .024f)),
                    )
                    onSelection(selected)
                },
                onFingerDoubleTap = onDoubleTap,
                onWritingStateChanged = onWritingStateChanged,
            )
        }
    }
}
