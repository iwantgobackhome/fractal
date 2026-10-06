package app.fractal.reader

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.*
import app.fractal.data.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.ui.focus.onFocusChanged
import app.fractal.design.*
import app.fractal.pdf.*
import app.fractal.sync.StructureItem
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kotlin.math.roundToInt

internal data class ReaderAnswerTarget(val selected: Pair<Int, PdfTextSelection>? = null,
    val item: StructureItem? = null, val pageText: String = "", val explain: Boolean = false,
    val requestId: String? = null, val anchor: Offset? = null, val historyId: String? = null, val threadId: String? = null)

/** A question or explanation tied to a place on a page. Minimized answers stay there as markers. */
internal data class ReaderAnswerPin(val key: String, val page: Int, val rect: PdfRect, val provenance: JsonObject?,
    val selected: Pair<Int, PdfTextSelection>, val requestId: String?, val historyId: String?, val kind: String)

internal fun readerAnswerPins(requests: List<AiRequestEntity>, history: List<HistoryEntity>): List<ReaderAnswerPin> =
    readerThreads(history, requests).mapNotNull { thread ->
        val root = thread.turns.firstOrNull { it.id == thread.id } ?: thread.turns.first()
        val context = root.json["context"] as? JsonObject
        val retained = root.request?.let { contextSelection(readerJson(it.contextJson)) }
        val selected = retained ?: context?.let { ctx ->
            val page = ctx["page"]?.jsonPrimitive?.intOrNull ?: return@let null
            val rectangles = (ctx["rects"] as? JsonArray)?.mapNotNull { it as? JsonObject }
                ?: listOfNotNull(ctx["rect"] as? JsonObject)
            page to PdfTextSelection(ctx.threadText("selectedText"), rectangles.map { r ->
                fun n(key: String) = r[key]?.jsonPrimitive?.floatOrNull ?: 0f
                PdfRect(n("x"), n("y"), n("width"), n("height"))
            })
        } ?: return@mapNotNull null
        val rect = selected.second.rects.firstOrNull() ?: return@mapNotNull null
        ReaderAnswerPin(thread.id, selected.first, rect, context?.get("provenance") as? JsonObject,
            selected, root.request?.requestId ?: root.json.threadText("requestId").takeIf(String::isNotBlank), root.historyId,
            root.json.threadText("kind").ifBlank { root.request?.kind.orEmpty() })
    }

internal fun answerCardPosition(position: Offset, width: Float, height: Float, cardWidth: Float, cardHeight: Float) =
    Offset(position.x.coerceIn(0f, (width - cardWidth).coerceAtLeast(0f)), position.y.coerceIn(0f, (height - cardHeight).coerceAtLeast(0f)))

/** Page content owns positioning; generation and follow-ups belong to durable history. */
@Composable
internal fun BoxScope.ReaderAnswerCard(app: ReaderApplication, paperKey: String, pages: PdfPages?,
    target: ReaderAnswerTarget, position: Offset?, onPosition: (Offset) -> Unit, widthPx: Float, heightPx: Float,
    onJump: (Int) -> Unit, onClose: () -> Unit, onMinimize: () -> Unit = onClose, onThreadChange: (String) -> Unit = {}, onMoveEnd: () -> Unit = {}, onActive: (Boolean) -> Unit = {}) {
    val density = LocalDensity.current
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    val history by app.database.metadata().observeHistory(paperKey).collectAsState(emptyList())
    val requests by app.database.reader().observeRequests(paperKey).collectAsState(emptyList())
    var selectedContext by remember(target) { mutableStateOf(target.selected.takeIf { target.requestId == null && target.historyId == null }) }
    var requestId by remember(target) { mutableStateOf(target.requestId) }
    var question by remember(target) { mutableStateOf("") }
    var error by remember(target) { mutableStateOf("") }
    var initialized by remember(target) { mutableStateOf(false) }
    var busy by remember(target) { mutableStateOf(false) }
    var threadId by remember(target) { mutableStateOf(target.threadId ?: java.util.UUID.randomUUID().toString()) }
    var model by remember { mutableStateOf("") }
    var providers by remember { mutableStateOf<JsonObject?>(app.settings.getString("cachedReaderProviders", null)?.let {
        runCatching { WireJson.format.parseToJsonElement(it).jsonObject }.getOrNull() }) }
    val models = readerModels(providers)
    val request = requests.firstOrNull { it.requestId == requestId }
    val record = history.firstOrNull { it.id == request?.historyId || it.id == target.historyId ||
        runCatching { WireJson.format.parseToJsonElement(it.json).jsonObject["requestId"]?.jsonPrimitive?.contentOrNull == requestId && requestId != null }.getOrDefault(false) }
    val submitted = request?.let { runCatching { WireJson.format.parseToJsonElement(it.bodyJson).jsonObject }.getOrNull() }
    val heading = target.item?.label?.ifBlank { target.item.kind } ?: libraryText("Answer", "답변")
    val cardWidth = with(density) { minOf(320.dp.toPx(), widthPx - 16.dp.toPx()).coerceAtLeast(1f) }
    var cardHeight by remember { mutableStateOf(with(density) { 300.dp.toPx() }) }
    val effectiveWidth = cardWidth
    fun clamp(offset: Offset) = answerCardPosition(offset, widthPx, heightPx, effectiveWidth, cardHeight)
    val currentPosition = clamp(position ?: target.anchor ?: Offset(with(density) { 8.dp.toPx() }, heightPx * .25f))
    val latestPosition = rememberUpdatedState(currentPosition)
    LaunchedEffect(widthPx, heightPx, cardHeight) { onPosition(currentPosition) }
    fun submit(explain: Boolean) { if (busy || !initialized) return; busy = true; error = ""
        scope.launch {
            try {
                val selected = selectedContext
                val selectedModel = resolveReaderModel(model, models)
                val body = if (explain) withReaderCrop(readerExplainBody(null, selectedModel,
                    selected ?: error("Choose original context first"), target.item, target.pageText, threadId), pages, selected)
                else readerQuestionBody(question, null, selectedModel, selected, threadId)
                requestId = app.history.create(paperKey, if (explain) "explanation" else "question", body, selectionContext(selected))
                question = ""; selectedContext = null; onThreadChange(threadId)
                app.history.saveDraft(paperKey, buildJsonObject { put("question", ""); put("model", model); put("context", JsonObject(emptyMap())); put("threadId", threadId) })
            } catch (cancel: CancellationException) { throw cancel }
            catch (failure: Exception) { error = failure.message.orEmpty() }
            finally { busy = false }
        }
    }
    LaunchedEffect(target) {
        val draft = app.history.draft(paperKey)
        val existingRequest = target.requestId?.let { app.database.reader().request(it) }
        val existingHistory = target.historyId?.let { app.database.metadata().history(it) }
        val existingThread = existingRequest?.let { readerJson(it.bodyJson).threadText("threadId").takeIf(String::isNotBlank) }
            ?: existingHistory?.let { readerThreadId(it.id, readerJson(it.json)) }
        existingThread?.let { threadId = it; onThreadChange(it) }
        model = draft["model"]?.jsonPrimitive?.contentOrNull.orEmpty()
        if (selectedContext == null && target.requestId == null && target.historyId == null) selectedContext = (draft["context"] as? JsonObject)?.let(::contextSelection)
        if (target.requestId == null && !target.explain) question = draft["question"]?.jsonPrimitive?.contentOrNull.orEmpty()
        app.history.saveDraft(paperKey, buildJsonObject { put("context", selectionContext(selectedContext)) })
        initialized = true
        if (target.explain && target.requestId == null) submit(true)
    }
    LaunchedEffect(record?.id, submitted) {
        val resolved = submitted?.threadText("threadId")?.takeIf { it.isNotBlank() } ?: record?.let { readerThreadId(it.id, readerJson(it.json)) }
        if (resolved != null) { threadId = resolved; onThreadChange(resolved) }
    }
    LaunchedEffect(paperKey) {
        if (app.credentials.load() == null) return@LaunchedEffect
        runCatching { app.history.reconnect(paperKey) }
        runCatching { app.client.data("/api/ai/providers").jsonObject }.onSuccess { providers = it; app.settings.edit().putString("cachedReaderProviders", it.toString()).apply() }
        while (isActive) { runCatching { app.history.refresh(paperKey) }; delay(1500) }
    }
    var pressed by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    LaunchedEffect(pressed, focused, moving) { onActive(pressed || focused || moving) }
    DisposableEffect(Unit) { onDispose { onActive(false) } }
    var deleting by remember { mutableStateOf(false) }
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text(libraryText("Delete answer card?", "답변 카드 삭제?")) },
        text = { Text(libraryText("The conversation remains in History.", "대화는 기록에 남습니다.")) },
        confirmButton = { TextButton(onClick = { deleting = false; onClose() }, modifier = Modifier.testTag("reader-answer-delete-confirm")) { Text(libraryText("Delete", "삭제")) } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text(libraryText("Cancel", "취소")) } })
    Surface(Modifier.offset { IntOffset(currentPosition.x.roundToInt(), currentPosition.y.roundToInt()) }
        .width(with(density) { effectiveWidth.toDp() }).heightIn(max = with(density) { minOf(520.dp.toPx(), heightPx * .65f).coerceAtLeast(48.dp.toPx()).toDp() })
        .onSizeChanged { cardHeight = it.height.toFloat() }
        .onFocusChanged { focused = it.hasFocus }.focusGroup()
        .pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false); pressed = true; waitForUpOrCancellation(); pressed = false } }.nativeInkBlocker().testTag("reader-answer-card").semantics { contentDescription = "Answer thread ${target.threadId}" },
        shape = MaterialTheme.shapes.medium, color = colors.paper, shadowElevation = 8.dp, tonalElevation = 3.dp) {
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(heading, Modifier.weight(1f).heightIn(min = 48.dp).padding(start = 12.dp).wrapContentHeight()
                    .testTag("reader-answer-drag").semantics { contentDescription = "Move answer" }
                    .pointerInput(widthPx, heightPx, cardHeight, effectiveWidth) {
                        var dragging = currentPosition
                        detectDragGestures(onDragStart = { dragging = latestPosition.value; moving = true },
                            onDragEnd = { onMoveEnd(); moving = false }, onDragCancel = { onMoveEnd(); moving = false }) { change, amount ->
                            change.consume(); dragging = clamp(dragging + amount); onPosition(dragging)
                        }
                    }, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                // Collapsing retains a marker at the card’s current page position.
                TextButton(onClick = onMinimize, modifier = Modifier.testTag("reader-answer-collapse")
                    .semantics { contentDescription = "Minimize answer to page" }) { Text("−") }
                TextButton(onClick = { deleting = true }, modifier = Modifier.testTag("reader-answer-close")) { Text("×") }
            }
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                val turns = readerThreads(history, requests).firstOrNull { it.id == threadId }?.turns.orEmpty()
                turns.forEach { turn ->
                    Text(turn.question, style = MaterialTheme.typography.titleSmall)
                    if (turn.quote.isNotBlank()) Text("📎 p.${turn.page ?: "?"} · “${turn.quote}”", maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    SelectionContainer { Text(turn.text.ifBlank { readerStateLabel(turn.status) }, Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium) }
                    val citations = readerTurnCitations(turn, paperKey)
                    if (turn.status in listOf("pending", "running") && turn.text.isNotBlank()) Text(readerStateLabel(turn.status), style = MaterialTheme.typography.bodySmall)
                    Row(Modifier.horizontalScroll(rememberScrollState())) { citations.distinct().filter { it in 1..(pages?.pageCount ?: 0) }.forEach { page -> TextButton(onClick = { onJump(page) }) { Text("[p.$page]") } } }
                }
                selectedContext?.let { (page, selected) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("📎 p.$page · “${selected.text.ifBlank { "Selected region" }}”", Modifier.weight(1f), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { selectedContext = null; app.history.saveDraft(paperKey, buildJsonObject { put("context", JsonObject(emptyMap())) }) }) { Text("×") }
                    }
                }
                val failure = error.ifBlank { request?.error.orEmpty() }
                if (failure.isNotBlank()) Text(failure, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                if (request?.status == "failed") TextButton(onClick = { app.history.send(request.requestId) }) { Text(libraryText("Retry", "재시도")) }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(question, { question = it; app.history.saveDraft(paperKey, buildJsonObject { put("question", it) }) },
                        Modifier.weight(1f).onFocusChanged { focused = it.isFocused }.testTag("reader-answer-question"), enabled = initialized, label = { Text(libraryText(if (requestId == null) "Ask a question" else "Follow-up question", if (requestId == null) "질문하기" else "후속 질문")) }, maxLines = 4)
                    Box {
                        var expanded by remember { mutableStateOf(false) }
                        TextButton(onClick = { expanded = true }) { Text(models.firstOrNull { it.value == model }?.label ?: libraryText("Model", "모델"), maxLines = 1, modifier = Modifier.widthIn(max = 64.dp), overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
                        DropdownMenu(expanded, { expanded = false }) {
                            DropdownMenuItem(text = { Text(libraryText("Hub default", "허브 기본값")) }, onClick = { model = ""; expanded = false; app.history.saveDraft(paperKey, buildJsonObject { put("model", model) }) })
                            models.forEach { choice -> DropdownMenuItem(text = { Text(choice.label) }, enabled = choice.available, onClick = { model = choice.value; expanded = false; app.history.saveDraft(paperKey, buildJsonObject { put("model", model) }) }) }
                        }
                    }
                    TextButton(onClick = { submit(false) }, enabled = initialized && question.isNotBlank() && question.length <= 4000 && !busy) { Text(libraryText("Ask", "질문")) }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
