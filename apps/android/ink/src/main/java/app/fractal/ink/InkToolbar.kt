package app.fractal.ink

import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.design.LocalFractalColors

private val palette = listOf("#1C1B19", "#233F65", "#A2362A", "#2F6B45", "#75519C", "#966A37", "#F5DC6B", "#A8CBEF")
private fun colorOf(hex: String): Color = try { Color(AndroidColor.parseColor(hex)) } catch (_: Exception) { Color.Black }
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

/** Compact rail on tablets, top bar on narrow layouts. A second tool tap opens its options. */
@Composable
fun InkToolbar(state: InkPageState, tool: InkToolState, modifier: Modifier = Modifier, onAsk: (List<InkStroke>, InkBounds) -> Unit = { _, _ -> }) {
    val colors = LocalFractalColors.current
    var popover by remember { mutableStateOf<InkTool?>(null) }
    var colorDialog by remember { mutableStateOf(false) }
    var collapsed by remember { mutableStateOf(false) }
    val body: @Composable (Boolean) -> Unit = { vertical ->
        @Composable fun ToolButton(item: InkTool) {
            Box {
                Box(
                    Modifier.size(48.dp).clickable {
                        if (tool.active == item) popover = item else { tool.active = item; popover = null }
                    }.semantics { contentDescription = item.name },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(icon(item), item.name, tint = colors.ink, modifier = Modifier.size(24.dp))
                    Canvas(Modifier.align(if (vertical) Alignment.CenterStart else Alignment.BottomCenter)
                        .then(if (vertical) Modifier.width(2.dp).height(24.dp) else Modifier.width(24.dp).height(2.dp))) {
                        if (tool.active == item) drawRect(colors.ink)
                    }
                }
                DropdownMenu(expanded = popover == item, onDismissRequest = { popover = null }) {
                    if (item == InkTool.Eraser) {
                        EraserMode.entries.forEach { mode -> DropdownMenuItem(text = { Text(mode.name) }, onClick = { tool.eraserMode = mode; popover = null }) }
                        DropdownMenuItem(text = { Text("S Pen button: ${tool.buttonEraserMode.name}") }, onClick = {
                            tool.buttonEraserMode = if (tool.buttonEraserMode == EraserMode.Stroke) EraserMode.Partial else EraserMode.Stroke
                        })
                    } else if (item == InkTool.Shape) {
                        ShapeMode.entries.forEach { shape -> DropdownMenuItem(text = { Text(shape.name) }, onClick = { tool.shapeMode = shape; popover = null }) }
                    }
                    val widths = when (item) {
                        InkTool.Highlighter -> listOf(.009f,.015f,.023f)
                        InkTool.Eraser -> listOf(.008f,.014f,.025f)
                        else -> listOf(.0015f,.003f,.005f)
                    }
                    widths.forEachIndexed { index, value -> DropdownMenuItem(text = { Text(listOf("Fine","Medium","Broad")[index]) }, onClick = { tool.width = value; popover = null }) }
                    Slider(value = tool.width.coerceIn(.001f,.03f), onValueChange = { tool.width = it }, valueRange = .001f..03f, modifier = Modifier.width(180.dp).padding(horizontal = 12.dp))
                }
            }
        }
        @Composable fun Swatch(hex: String) {
            Box(Modifier.size(48.dp).clickable { tool.chooseColor(hex); if (state.selectedIds.isNotEmpty()) state.recolorSelection(hex) }, contentAlignment = Alignment.Center) {
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
                Spacer(Modifier.height(8.dp))
                (listOf(tool.color) + tool.recentColors.filterNot { it == tool.color }.take(4)).forEach { Swatch(it) }
                TextButton(onClick = { colorDialog = true }, modifier = Modifier.size(48.dp)) { Text("+", color = colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.undo() }, modifier = Modifier.size(48.dp)) { Text("↶", color = colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.redo() }, modifier = Modifier.size(48.dp)) { Text("↷", color = colors.ink, fontSize = 24.sp) }
                if (state.selectedIds.isNotEmpty()) {
                    TextButton(onClick = { state.duplicateSelection() }) { Text("Copy", color=colors.ink) }
                    TextButton(onClick = { state.deleteSelection() }) { Text("Delete", color=colors.ink) }
                    TextButton(onClick = { state.selection().bounds()?.let { onAsk(state.selection(),it) } }) { Text("Ask", color=colors.accent) }
                }
                }
            }
        } else {
            Row(Modifier.fillMaxWidth().background(colors.paper).border(.5.dp,colors.rule).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                InkTool.entries.forEach { ToolButton(it) }
                (listOf(tool.color) + tool.recentColors.filterNot { it == tool.color }.take(4)).forEach { Swatch(it) }
                TextButton(onClick = { colorDialog = true }, modifier = Modifier.size(48.dp)) { Text("+", color=colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.undo() }, modifier = Modifier.size(48.dp)) { Text("↶", color=colors.ink, fontSize = 24.sp) }
                TextButton(onClick = { state.redo() }, modifier = Modifier.size(48.dp)) { Text("↷", color=colors.ink, fontSize = 24.sp) }
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
        AlertDialog(onDismissRequest = { colorDialog = false }, title = { Text("Custom colour") },
            text = { Column {
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    palette.forEach { preset ->
                        Box(Modifier.size(40.dp).clickable { value = preset }.padding(4.dp).background(colorOf(preset), CircleShape))
                    }
                }
                Box(Modifier.fillMaxWidth().height(28.dp).background(colorOf(value)))
                OutlinedTextField(value, { value = it }, label = { Text("Hex colour") }, singleLine = true)
                listOf("Red" to 16,"Green" to 8,"Blue" to 0).forEach { (name,shift) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(name,modifier=Modifier.width(52.dp))
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
            }) { Text("Apply") } },
            dismissButton = { TextButton(onClick = { colorDialog = false }) { Text("Cancel") } })
    }
}
