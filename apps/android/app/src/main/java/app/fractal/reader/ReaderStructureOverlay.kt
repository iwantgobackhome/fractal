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
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.*
import app.fractal.design.LocalFractalColors
import app.fractal.sync.StructureItem
import kotlin.math.roundToInt

@Composable
internal fun BoxScope.ReaderStructureOverlay(items: List<StructureItem>, selectedId: String?, width: Int, height: Int,
    onAction: (StructureItem, Offset, Boolean) -> Unit) {
    val color = LocalFractalColors.current.inkSoft
    val density = LocalDensity.current
    val explain = libraryText("Explain", "설명")
    val ask = libraryText("Ask", "질문")
    items.forEach { item -> key(item.id) {
        val b = item.bbox
        Box(Modifier.offset { IntOffset((b.x * width).roundToInt(), (b.y * height).roundToInt()) }
            .size(with(density) { (b.width * width).toFloat().toDp() }, with(density) { (b.height * height).toFloat().toDp() })
            .testTag("structure-item-${item.id}").semantics {
                contentDescription = item.label.ifBlank { item.kind }
                customActions = listOf(CustomAccessibilityAction(explain) { onAction(item, Offset.Zero, true); true },
                    CustomAccessibilityAction(ask) { onAction(item, Offset.Zero, false); true })
            })
    } }
    val item = items.firstOrNull { it.id == selectedId } ?: return
    val b = item.bbox
    Canvas(Modifier.matchParentSize()) {
        drawRect(color.copy(alpha = .45f), Offset((b.x * width).toFloat(), (b.y * height).toFloat()),
            Size((b.width * width).toFloat(), (b.height * height).toFloat()), style = Stroke(1.dp.toPx()))
    }
    var anchor by remember(item.id) { mutableStateOf(Offset.Zero) }
    val rowWidth = with(density) { minOf(180.dp.roundToPx(), width) }
    val rowHeight = with(density) { 48.dp.roundToPx() }
    val gap = with(density) { 4.dp.roundToPx() }
    val top = (b.y * height).roundToInt()
    val bottom = ((b.y + b.height) * height).roundToInt()
    // Near the page top, leave room for the original-text loading/retry control.
    val rowY = if (top >= rowHeight * 2 + gap) top - rowHeight - gap else bottom + gap
    Surface(Modifier.offset { IntOffset((b.x * width).roundToInt().coerceIn(0, (width - rowWidth).coerceAtLeast(0)),
        rowY.coerceIn(0, (height - rowHeight).coerceAtLeast(0))) }
        .width(with(density) { rowWidth.toDp() }).nativeInkBlocker()
        .onGloballyPositioned { anchor = it.boundsInWindow().bottomLeft }, shape = MaterialTheme.shapes.small,
        color = LocalFractalColors.current.paper.copy(alpha = .95f), tonalElevation = 1.dp) {
        Row {
            TextButton(onClick = { onAction(item, anchor, true) }, modifier = Modifier.weight(1f).testTag("explain-structure-${item.id}"),
                contentPadding = PaddingValues(horizontal = 8.dp)) { Text(explain, style = MaterialTheme.typography.labelMedium) }
            TextButton(onClick = { onAction(item, anchor, false) }, modifier = Modifier.weight(1f).testTag("ask-structure-${item.id}"),
                contentPadding = PaddingValues(horizontal = 8.dp)) { Text(ask, style = MaterialTheme.typography.labelMedium) }
        }
    }
}
