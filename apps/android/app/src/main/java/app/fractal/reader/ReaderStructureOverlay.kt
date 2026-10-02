package app.fractal.reader

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.*
import app.fractal.design.LocalFractalColors
import app.fractal.sync.StructureItem
import kotlin.math.roundToInt

@Composable
internal fun BoxScope.ReaderStructureOverlay(items: List<StructureItem>, width: Int, height: Int,
    onExplain: (StructureItem, Offset) -> Unit) {
    val color = LocalFractalColors.current.inkSoft
    val density = LocalDensity.current
    Canvas(Modifier.matchParentSize()) {
        items.forEach { item -> val b = item.bbox
            drawRect(color.copy(alpha = .28f), Offset((b.x * width).toFloat(), (b.y * height).toFloat()),
                Size((b.width * width).toFloat(), (b.height * height).toFloat()), style = Stroke(1.dp.toPx()))
        }
    }
    items.forEach { item -> key(item.id) {
        var anchor by remember { mutableStateOf(Offset.Zero) }
        val chipWidth = with(density) { minOf(180.dp.roundToPx(), width) }
        val chipHeight = with(density) { 48.dp.roundToPx() }
        Surface(Modifier.offset { IntOffset((item.bbox.x * width).roundToInt().coerceIn(0, (width - chipWidth).coerceAtLeast(0)),
            ((item.bbox.y + item.bbox.height) * height).roundToInt().coerceIn(0, (height - chipHeight).coerceAtLeast(0))) }
            .width(with(density) { chipWidth.toDp() }).nativeInkBlocker().testTag("explain-structure-${item.id}")
            .onGloballyPositioned { anchor = it.boundsInWindow().bottomLeft }, shape = MaterialTheme.shapes.small,
            color = LocalFractalColors.current.paper.copy(alpha = .95f), tonalElevation = 1.dp) {
            TextButton(onClick = { onExplain(item, anchor) }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                Text(libraryText("Explain", "설명") + item.label.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty(),
                    maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
            }
        }
    } }
}
