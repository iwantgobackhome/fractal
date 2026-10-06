package app.fractal.ink

import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.delay
import androidx.compose.ui.unit.sp
import app.fractal.design.LocalFractalColors

private val palette = listOf("#1C1B19", "#233F65", "#A2362A", "#2F6B45", "#75519C", "#966A37", "#F5DC6B", "#A8CBEF")
private fun colorOf(hex: String): Color = try { Color(AndroidColor.parseColor(hex)) } catch (_: Exception) { Color.Black }
private fun toolLabel(item: InkTool): Int = when (item) {
    InkTool.Ballpoint -> R.string.tool_ballpoint
    InkTool.Fountain -> R.string.tool_fountain
    InkTool.Pencil -> R.string.tool_pencil
    InkTool.Highlighter -> R.string.tool_highlighter
    InkTool.Eraser -> R.string.tool_eraser
    InkTool.Shape -> R.string.tool_shape
    InkTool.Lasso -> R.string.tool_lasso
}
private fun eraserLabel(mode: EraserMode): Int =
    if (mode == EraserMode.Stroke) R.string.eraser_stroke else R.string.eraser_partial
private fun shapeLabel(shape: ShapeMode): Int = when (shape) {
    ShapeMode.Line -> R.string.shape_line
    ShapeMode.Arrow -> R.string.shape_arrow
    ShapeMode.Rectangle -> R.string.shape_rectangle
    ShapeMode.Ellipse -> R.string.shape_ellipse
}
private fun icon(name: InkTool): ImageVector = ImageVector.Builder(name = name.name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f).apply {
    path(fill = null, stroke = androidx.compose.ui.graphics.SolidColor(Color.Black), strokeLineWidth = 1.7f, strokeLineCap = StrokeCap.Round) {
        when (name) {
            InkTool.Ballpoint -> { moveTo(5f,19f); lineTo(18f,6f); lineTo(20f,8f); lineTo(7f,21f); close(); moveTo(15f,9f); lineTo(17f,11f) }
            InkTool.Fountain -> { moveTo(4f,19f); lineTo(12f,3f); lineTo(20f,19f); lineTo(12f,21f); close(); moveTo(12f,8f); lineTo(12f,18f) }
            InkTool.Pencil -> { moveTo(4f,19f); lineTo(17f,5f); lineTo(20f,8f); lineTo(7f,21f); close(); moveTo(5f,17f); lineTo(8f,20f) }
            InkTool.Highlighter -> { moveTo(4f,17f); lineTo(15f,6f); lineTo(20f,11f); lineTo(9f,22f); close(); moveTo(3f,22f); lineTo(19f,22f) }
            InkTool.Eraser -> { moveTo(3f,16f); lineTo(14f,5f); lineTo(21f,12f); lineTo(12f,21f); lineTo(8f,21f); close(); moveTo(8f,11f); lineTo(15f,18f) }
            InkTool.Shape -> { moveTo(3f,19f); lineTo(12f,5f); lineTo(21f,19f); close() }
            InkTool.Lasso -> { moveTo(5f,9f); curveTo(6f,3f,19f,3f,20f,10f); curveTo(21f,18f,8f,20f,5f,15f); curveTo(3f,12f,6f,10f,9f,12f); lineTo(12f,18f) }
        }
    }
}.build()

private const val MIN_WIDTH = .001f
private const val MAX_WIDTH = .03f
/** Widths are page-relative; show them as a 1–30 scale so presets and the slider share one number. */
internal fun widthDisplay(width: Float): String = String.format(java.util.Locale.ROOT, "%.1f", width.coerceIn(MIN_WIDTH, MAX_WIDTH) * 1000f)

/** Compact rail on tablets, top bar on narrow layouts. A second tool tap opens its options. */
@Composable
fun InkToolbar(state: InkPageState, tool: InkToolState, modifier: Modifier = Modifier, onAsk: (List<InkStroke>, InkBounds) -> Unit = { _, _ -> }, onToolSelected: (InkTool) -> Unit = {}, regionMode: Boolean = false, onRegionToggle: () -> Unit = {}) {
    val colors = LocalFractalColors.current
    val addColorLabel = stringResource(R.string.add_color)
    val undoLabel = stringResource(R.string.undo)
    val redoLabel = stringResource(R.string.redo)
    var popover by remember { mutableStateOf<InkTool?>(null) }
    var colorDialog by remember { mutableStateOf(false) }
    var collapsed by remember { mutableStateOf(false) }
    val body: @Composable (Boolean) -> Unit = { vertical ->
        @Composable fun ToolButton(item: InkTool) {
            val label = stringResource(toolLabel(item))
            val interaction = remember { MutableInteractionSource() }
            val hovered by interaction.collectIsHoveredAsState()
            var pressedLabel by remember { mutableStateOf(false) }
            LaunchedEffect(pressedLabel) { if (pressedLabel) { delay(1500); pressedLabel = false } }
            Box {
                Box(
                    Modifier.size(48.dp).hoverable(interaction).combinedClickable(interactionSource = interaction, indication = null,
                        onLongClick = { pressedLabel = true }) {
                        if (tool.active == item) popover = item else { tool.active = item; popover = null }
                        onToolSelected(item)
                    }.semantics { contentDescription = label; selected = tool.active == item },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(icon(item), null, tint = colors.ink, modifier = Modifier.size(24.dp))
                    Canvas(Modifier.align(if (vertical) Alignment.CenterStart else Alignment.BottomCenter)
                        .then(if (vertical) Modifier.width(2.dp).height(24.dp) else Modifier.width(24.dp).height(2.dp))) {
                        if (tool.active == item) drawRect(colors.ink)
                    }
                }
                // A stylus hover (or a long press) names the tool; the icons alone are ambiguous.
                if ((hovered || pressedLabel) && popover != item) {
                    val gap = with(LocalDensity.current) { 52.dp.roundToPx() }
                    Popup(alignment = Alignment.TopStart, offset = if (vertical) IntOffset(gap, 0) else IntOffset(0, gap),
                        properties = PopupProperties(focusable = false)) {
                        Text(label, color = colors.paper, style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.background(colors.ink.copy(alpha = .88f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
                    }
                }
                DropdownMenu(expanded = popover == item, onDismissRequest = { popover = null }) {
                    if (item == InkTool.Eraser) {
                        EraserMode.entries.forEach { mode -> DropdownMenuItem(text = { Text(stringResource(eraserLabel(mode))) }, onClick = { tool.eraserMode = mode; popover = null }) }
                        DropdownMenuItem(text = { Text(stringResource(R.string.spen_eraser_mode,
                            stringResource(eraserLabel(tool.buttonEraserMode)))) }, onClick = {
                            tool.buttonEraserMode = if (tool.buttonEraserMode == EraserMode.Stroke) EraserMode.Partial else EraserMode.Stroke
                        })
                    } else if (item == InkTool.Shape) {
                        ShapeMode.entries.forEach { shape -> DropdownMenuItem(text = { Text(stringResource(shapeLabel(shape))) }, onClick = { tool.active = InkTool.Shape; tool.shapeMode = shape; onToolSelected(InkTool.Shape); popover = null }) }
                    }
                    val widths = when (item) {
                        InkTool.Highlighter -> listOf(.009f,.015f,.023f)
                        InkTool.Eraser -> listOf(.008f,.014f,.025f)
                        else -> listOf(.0015f,.003f,.005f)
                    }
                    val widthLabels = listOf(R.string.width_fine, R.string.width_medium, R.string.width_broad)
                    widths.forEachIndexed { index, value -> DropdownMenuItem(text = {
                        Text(stringResource(widthLabels[index]) + if (kotlin.math.abs(tool.width - value) < .0001f) " ✓" else "")
                    }, onClick = { tool.width = value; popover = null }) }
                    Text(stringResource(R.string.width_value, widthDisplay(tool.width)), style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                    Slider(value = tool.width.coerceIn(MIN_WIDTH, MAX_WIDTH), onValueChange = { tool.width = it }, valueRange = MIN_WIDTH..MAX_WIDTH,
                        modifier = Modifier.width(200.dp).padding(horizontal = 12.dp).semantics { contentDescription = "Stroke width" })
                }
            }
        }
        @Composable fun Swatch(hex: String) {
            val description = stringResource(R.string.color_swatch, hex)
            Box(Modifier.size(48.dp).clickable { tool.chooseColor(hex); if (state.selectedIds.isNotEmpty()) state.recolorSelection(hex) }
                .semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(24.dp).then(if (tool.color == hex) Modifier.border(2.dp,colors.ink,CircleShape) else Modifier)
                    .padding(2.dp).size(20.dp).background(colorOf(hex),CircleShape))
            }
        }
        if (vertical) {
            Column(Modifier.fillMaxSize().background(colors.paper).border(0.5.dp,colors.rule).verticalScroll(rememberScrollState()).padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (collapsed) {
                    ToolButton(tool.active)
                } else {
                InkTool.entries.forEach { ToolButton(it) }
                TextButton(onClick = onRegionToggle, modifier = Modifier.semantics { contentDescription = "Region"; selected = regionMode }) { Text(stringResource(R.string.tool_region), color = if (regionMode) colors.accent else colors.ink) }
                Spacer(Modifier.height(8.dp))
                (listOf(tool.color) + tool.recentColors.filterNot { it == tool.color }.take(4)).forEach { Swatch(it) }
                TextButton(onClick = { colorDialog = true }, modifier = Modifier.size(48.dp).semantics { contentDescription = addColorLabel }) { Text(stringResource(R.string.add_symbol), color = colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.undo() }, modifier = Modifier.size(48.dp).semantics { contentDescription = undoLabel }) { Text(stringResource(R.string.undo_symbol), color = colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.redo() }, modifier = Modifier.size(48.dp).semantics { contentDescription = redoLabel }) { Text(stringResource(R.string.redo_symbol), color = colors.ink, fontSize = 24.sp) }
                if (state.selectedIds.isNotEmpty()) {
                    TextButton(onClick = { state.duplicateSelection() }) { Text(stringResource(R.string.copy_selection), color=colors.ink) }
                    TextButton(onClick = { state.deleteSelection() }) { Text(stringResource(R.string.delete_selection), color=colors.ink) }
                    TextButton(onClick = { state.selection().bounds()?.let { onAsk(state.selection(),it) } }) { Text(stringResource(R.string.ask_selection), color=colors.accent) }
                }
                }
            }
        } else {
            Row(Modifier.fillMaxWidth().background(colors.paper).border(.5.dp,colors.rule).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                InkTool.entries.forEach { ToolButton(it) }
                TextButton(onClick = onRegionToggle, modifier = Modifier.semantics { contentDescription = "Region"; selected = regionMode }) { Text(stringResource(R.string.tool_region), color = if (regionMode) colors.accent else colors.ink) }
                (listOf(tool.color) + tool.recentColors.filterNot { it == tool.color }.take(4)).forEach { Swatch(it) }
                TextButton(onClick = { colorDialog = true }, modifier = Modifier.size(48.dp).semantics { contentDescription = addColorLabel }) { Text(stringResource(R.string.add_symbol), color=colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.undo() }, modifier = Modifier.size(48.dp).semantics { contentDescription = undoLabel }) { Text(stringResource(R.string.undo_symbol), color=colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.redo() }, modifier = Modifier.size(48.dp).semantics { contentDescription = redoLabel }) { Text(stringResource(R.string.redo_symbol), color=colors.ink, fontSize = 24.sp) }
            }
        }
    }
    val vertical = LocalConfiguration.current.screenWidthDp >= 600
    val dragModifier = if (vertical) Modifier.pointerInput(Unit) {
        detectDragGestures { change, dragAmount ->
            if (dragAmount.x < -12f) collapsed = true
            if (dragAmount.x > 12f) collapsed = false
            change.consume()
        }
    } else Modifier
    Box(modifier.then(dragModifier)) { body(vertical) }
    if (colorDialog) {
        var value by remember { mutableStateOf(tool.color) }
        fun channel(shift: Int): Float = runCatching { ((AndroidColor.parseColor(value) shr shift) and 255) / 255f }.getOrDefault(0f)
        AlertDialog(onDismissRequest = { colorDialog = false }, title = { Text(stringResource(R.string.custom_color)) },
            text = { Column {
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    palette.forEach { preset ->
                        Box(Modifier.size(40.dp).clickable { value = preset }.padding(4.dp).background(colorOf(preset), CircleShape))
                    }
                }
                Box(Modifier.fillMaxWidth().height(28.dp).background(colorOf(value)))
                OutlinedTextField(value, { value = it }, label = { Text(stringResource(R.string.hex_color)) }, singleLine = true)
                listOf(R.string.red to 16,R.string.green to 8,R.string.blue to 0).forEach { (name,shift) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(name),modifier=Modifier.width(52.dp))
                        Slider(channel(shift), onValueChange = { next ->
                            val current = runCatching { AndroidColor.parseColor(value) }.getOrDefault(AndroidColor.BLACK)
                            val mask = 255 shl shift
                            val result = (current and mask.inv()) or ((next*255).toInt() shl shift)
                            value = String.format("#%06X",result and 0xffffff)
                        },modifier=Modifier.weight(1f))
                    }
                }
            } },
            confirmButton = { TextButton(onClick = {
                if (runCatching { AndroidColor.parseColor(value) }.isSuccess) { tool.chooseColor(value); colorDialog = false }
            }) { Text(stringResource(R.string.apply)) } },
            dismissButton = { TextButton(onClick = { colorDialog = false }) { Text(stringResource(R.string.cancel)) } })
    }
}
