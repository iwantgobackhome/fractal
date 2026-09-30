package app.fractal.reader

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import app.fractal.data.*
import app.fractal.design.LocalFractalColors
import app.fractal.sync.SyncScheduler
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.Instant
import kotlin.math.roundToInt

internal suspend fun editAnnotation(app: ReaderApplication, original: JsonObject, patch: JsonObject) {
    // Read the latest row so a body edit does not erase an independently changed position/color.
    val id = original["id"]?.jsonPrimitive?.content ?: return
    val latest = app.database.annotations().get(id)?.json?.let { WireJson.format.parseToJsonElement(it).jsonObject } ?: original
    app.sync.saveLocal(JsonObject(latest + patch + ("updatedAt" to JsonPrimitive(Instant.now().toString()))))
    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
}

@Composable
internal fun BoxScope.StickyNotes(app: ReaderApplication, rows: List<AnnotationEntity>, width: Int, height: Int, page: OriginalTextPage?) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var deleting by remember { mutableStateOf<JsonObject?>(null) }
    val positioned = rows.mapNotNull { row ->
        val json = runCatching { WireJson.format.parseToJsonElement(row.json).jsonObject }.getOrNull()
        val rect = json?.get("rect") as? JsonObject
        if (json == null || rect == null) null else Triple(row, json, rect)
    }
    positioned.forEach { (row, json, rect) ->
        key(row.id) {
            fun value(name: String) = rect[name]?.jsonPrimitive?.floatOrNull ?: 0f
            val collapsed = json["collapsed"]?.jsonPrimitive?.booleanOrNull ?: false
            val body = readerNoteText("memo", json)
            val color = json["color"]?.jsonPrimitive?.contentOrNull ?: "yellow"
            var x by remember(row.json) { mutableStateOf(value("x")) }
            var y by remember(row.json) { mutableStateOf(value("y")) }
            val currentJson = rememberUpdatedState(json)
            fun persist() { scope.launch { editAnnotation(app, currentJson.value, buildJsonObject {
                put("rect", buildJsonObject { put("x", x.toDouble()); put("y", y.toDouble()); put("width", value("width").toDouble().coerceIn(0.0, 1.0 - x)); put("height", value("height").toDouble().coerceIn(0.0, 1.0 - y)) })
            }) } }
            val noteWidth = with(density) { if (collapsed) 48.dp.roundToPx() else minOf(240.dp.roundToPx(), width) }
            val boundedX = (x * width).coerceIn(0f, (width - noteWidth).coerceAtLeast(0).toFloat())
            Column(Modifier.offset { IntOffset(boundedX.roundToInt(), (y * height).coerceIn(0f, (height - 48).coerceAtLeast(0).toFloat()).roundToInt()) }
                .width(with(density) { noteWidth.toDp() }).nativeInkBlocker().background(highlightColor(color).copy(alpha = .97f)).border(.5.dp, highlightColor(color))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(48.dp).focusable().semantics { contentDescription = "Move source note" }
                        .onKeyEvent { event ->
                            if (event.type != KeyEventType.KeyDown) false else {
                                val step = .01f
                                when (event.key) { Key.DirectionLeft -> x = (x - step).coerceAtLeast(0f); Key.DirectionRight -> x = (x + step).coerceAtMost(.98f)
                                    Key.DirectionUp -> y = (y - step).coerceAtLeast(0f); Key.DirectionDown -> y = (y + step).coerceAtMost(.98f); else -> return@onKeyEvent false }
                                persist(); true
                            }
                        }.pointerInput(row.id, width, height) {
                            var startX = 0f; var startY = 0f
                            detectDragGestures(onDragStart = { startX = x; startY = y }, onDragCancel = { x = startX; y = startY }, onDragEnd = { persist() }) { change, amount ->
                                change.consume(); x = (x + amount.x / width).coerceIn(0f, .98f); y = (y + amount.y / height).coerceIn(0f, .98f)
                            }
                        }, contentAlignment = Alignment.Center) { Text("✥", color = androidx.compose.ui.graphics.Color(0xFF29251F)) }
                    if (!collapsed) {
                        TextButton(onClick = { editing = json }, modifier = Modifier.weight(1f)) { Text(libraryText("Edit", "편집"), color = androidx.compose.ui.graphics.Color(0xFF29251F)) }
                        TextButton(onClick = { scope.launch { editAnnotation(app, json, buildJsonObject { put("collapsed", true) }) } }) { Text("−", color = androidx.compose.ui.graphics.Color(0xFF29251F)) }
                    }
                }
                if (collapsed) Box(Modifier.fillMaxWidth().height(48.dp).clickable { scope.launch { editAnnotation(app, json, buildJsonObject { put("collapsed", false) }) } }, contentAlignment = Alignment.Center) {
                    Text("+", color = androidx.compose.ui.graphics.Color(0xFF29251F))
                } else {
                    if (body.quote.isNotBlank()) Text(body.quote, Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall, color = androidx.compose.ui.graphics.Color(0xFF534B3D))
                    Box(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState()).padding(12.dp)) { Text(body.body, color = androidx.compose.ui.graphics.Color(0xFF29251F)) }
                    TextButton(onClick = { deleting = json }) { Text(libraryText("Delete…", "삭제…"), color = androidx.compose.ui.graphics.Color(0xFF29251F)) }
                }
            }
        }
    }
    editing?.let { original -> NoteEditor(original, readerNoteText("memo", original).quote, { editing = null }) { body, color ->
        scope.launch { editAnnotation(app, original, buildJsonObject { put("text", body); put("color", color) }) }; editing = null
    } }
    deleting?.let { original -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text(libraryText("Delete note?", "노트를 삭제할까요?")) },
        text = { Text(libraryText("Collapse keeps the note. Delete removes it from this paper.", "접으면 노트가 보존됩니다. 삭제하면 이 논문에서 제거됩니다.")) },
        confirmButton = { TextButton(onClick = { scope.launch { editAnnotation(app, original, buildJsonObject { put("deleted", true) }) }; deleting = null }) { Text(libraryText("Delete", "삭제")) } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text(libraryText("Keep", "유지")) } }) }
}

@Composable
internal fun NoteEditor(original: JsonObject?, quote: String, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var text by remember(original) { mutableStateOf(original?.get("text")?.jsonPrimitive?.contentOrNull.orEmpty()) }
    var color by remember(original) { mutableStateOf(original?.get("color")?.jsonPrimitive?.contentOrNull ?: "yellow") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(libraryText("Source note", "원문 노트")) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (quote.isNotBlank()) Text(quote, style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(text, { text = it }, label = { Text(libraryText("Complete note body", "노트 내용")) }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            Row { listOf("yellow", "green", "blue", "pink").forEach { name ->
                Box(Modifier.size(48.dp).clickable { color = name }.semantics { contentDescription = "Note color $name"; selected = color == name }, contentAlignment = Alignment.Center) {
                    Box(Modifier.size(24.dp).background(highlightColor(name)).border(if (color == name) 2.dp else .5.dp, androidx.compose.ui.graphics.Color.DarkGray))
                }
            } }
        }
    }, confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onSave(text, color) }) { Text(libraryText("Save", "저장")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(libraryText("Cancel", "취소")) } })
}
