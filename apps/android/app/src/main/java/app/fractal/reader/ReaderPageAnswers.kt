package app.fractal.reader

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.*
import app.fractal.data.*
import app.fractal.design.LocalFractalColors
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfRect
import app.fractal.sync.SyncScheduler
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.time.Instant
import kotlin.math.roundToInt

internal fun placementIntentId(thread: String) = "answer-placement:$thread"
internal fun localAnswerPlacement(requests: List<AiRequestEntity>, thread: String): AnswerPlacement? = requests
    .firstOrNull { it.requestId == placementIntentId(thread) }?.let {
        runCatching { WireJson.format.decodeFromString<AnswerPlacement>(it.bodyJson) }.getOrNull()
    }
internal fun saveAnswerPlacement(app: ReaderApplication, paperKey: String, thread: String, placement: AnswerPlacement) {
    app.submissionScope.launch {
        app.database.reader().upsert(AiRequestEntity(placementIntentId(thread), paperKey, "draft", placement.json().toString(), buildJsonObject {
                put("deviceId", app.credentials.load()?.deviceId ?: app.settings.getString("localDeviceId", null) ?: "android")
            }.toString(), "draft",
            null, null, false, placement.updatedAt, placement.updatedAt))
        val root = answerThreadRoot(app.database.metadata().historyEntries(paperKey), thread)
        if (root != null) app.metadata.placeAnswer(root.id, placement)
        SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
    }
}

@Composable
internal fun BoxScope.ReaderPageAnswers(app: ReaderApplication, paperKey: String, pages: PdfPages?, page: Int,
    width: Int, height: Int, rotation: Int, targets: Map<String, ReaderAnswerTarget>, pins: List<ReaderAnswerPin>,
    history: List<HistoryEntity>, requests: List<AiRequestEntity>, textPage: OriginalTextPage?, onJump: (Int) -> Unit) {
    val density = LocalDensity.current
    val colors = LocalFractalColors.current
    val all = pins.associate { pin -> pin.key to ReaderAnswerTarget(pin.selected, requestId = pin.requestId,
        historyId = pin.historyId, threadId = pin.key) } + targets
    val resolved = all.mapValues { (thread, target) ->
        val pin = pins.firstOrNull { it.key == thread }
        if (pin == null) target else target.copy(requestId = pin.requestId, historyId = pin.historyId)
    }
    val chronology = readerThreads(history, requests).associate { it.id to it.turns.first().createdAt }
    resolved.filterValues { it.selected?.first == page }.entries.sortedBy { chronology[it.key] ?: "9999" }.forEach { (thread, target) -> key(thread) {
        val root = answerThreadRoot(history, thread)
        val remote = root?.answerPlacement()
        val local = localAnswerPlacement(requests, thread)
        val saved = listOfNotNull(remote, local).maxByOrNull { Instant.parse(it.updatedAt) }
        val pin = pins.firstOrNull { it.key == thread }
        val source = renderedRect(target.selected!!.second.rects.firstOrNull() ?: PdfRect(.02f, .2f, 0f, 0f), pin?.provenance, rotation)
        var position by remember(thread, width, height) { mutableStateOf(Offset((saved?.x ?: source.x) * width, (saved?.y ?: (source.y + source.height)) * height)) }
        var state by remember(thread) { mutableStateOf(saved?.state ?: "open") }
        var moveJob by remember(thread) { mutableStateOf<Job?>(null) }
        var active by remember(thread) { mutableStateOf(false) }
        fun persist(next: String = state) {
            state = next
            saveAnswerPlacement(app, paperKey, thread, AnswerPlacement(page, (position.x / width).coerceIn(0f, 1f),
                (position.y / height).coerceIn(0f, 1f), next, Instant.now().toString()))
        }
        LaunchedEffect(saved) { saved?.let { state = it.state; if (!active) position = Offset(it.x * width, it.y * height) } }
        // Keep the overlay mounted: inserting a page sibling during DOWN cancels child gestures.
        Canvas(Modifier.matchParentSize().testTag(if (active && state == "open") "reader-answer-source-$thread" else "reader-answer-source-inactive-$thread")) {
            if (active && state == "open") {
                val selection = target.selected.second
                val range = pin?.provenance?.get("layoutRange") as? JsonObject
                val start = range?.get("start")?.jsonPrimitive?.intOrNull
                val end = range?.get("end")?.jsonPrimitive?.intOrNull
                val recovered = if (selection.quads.isEmpty() && textPage != null && start != null && end != null &&
                    sourceContextStatus(pin.provenance, pages?.pdfSha256, page, textPage) == "current")
                    OriginalTextGeometry(textPage).range(start, end)?.displayQuads?.map { quad -> quad.map { it.x.toFloat() to it.y.toFloat() } }.orEmpty()
                    else emptyList()
                val quads = selection.quads.ifEmpty { recovered }
                if (quads.isNotEmpty()) quads.forEach { quad ->
                    val path = Path()
                    quad.forEachIndexed { i, point ->
                        if (i == 0) path.moveTo(point.first * size.width, point.second * size.height)
                        else path.lineTo(point.first * size.width, point.second * size.height)
                    }
                    path.close()
                    drawPath(path, colors.focus.copy(alpha = .28f))
                } else selection.rects.forEach { original ->
                    val rect = renderedRect(original, pin?.provenance, rotation)
                    drawRect(colors.focus.copy(alpha = .28f), Offset(rect.x * size.width, rect.y * size.height),
                        Size(rect.width * size.width, rect.height * size.height))
                }
            }
        }
        when (state) {
            "open" -> key("answer-card") { ReaderAnswerCard(app, paperKey, pages, target, position, { position = it }, width.toFloat(), height.toFloat(), onJump,
                onClose = { persist("dismissed") }, onMinimize = { persist("collapsed") }, onMoveEnd = { moveJob?.cancel(); moveJob = app.submissionScope.launch { delay(250); persist() } }, onActive = { active = it }) }
            "collapsed" -> Surface(onClick = { persist("open") }, modifier = Modifier.offset {
                IntOffset(position.x.roundToInt().coerceIn(0, (width - with(density) { 32.dp.roundToPx() }).coerceAtLeast(0)),
                    position.y.roundToInt().coerceIn(0, (height - with(density) { 32.dp.roundToPx() }).coerceAtLeast(0)))
            }.size(32.dp).nativeInkBlocker().testTag("reader-answer-pin-${pin?.requestId ?: thread}"),
                shape = androidx.compose.foundation.shape.CircleShape, color = colors.focus) {
                Box(contentAlignment = Alignment.Center) { Text(if (target.explain || pin?.kind == "explanation") "i" else "?", color = colors.paper) }
            }
        }
        // Save the initial, clamped position only after layout has measured the card.
        LaunchedEffect(thread) { if (saved == null) { delay(350); persist() } }
    } }
}
