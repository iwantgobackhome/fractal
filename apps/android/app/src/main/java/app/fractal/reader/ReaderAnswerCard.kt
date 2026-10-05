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
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.*
import app.fractal.data.AiRequestEntity
import app.fractal.data.HistoryEntity
import app.fractal.data.WireJson
import app.fractal.design.*
import app.fractal.pdf.*
import app.fractal.sync.StructureItem
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kotlin.math.roundToInt

internal data class ReaderAnswerTarget(val selected: Pair<Int, PdfTextSelection>? = null,
    val item: StructureItem? = null, val pageText: String = "", val explain: Boolean = false,
    val requestId: String? = null, val anchor: Offset? = null, val historyId: String? = null)

/** A question or explanation tied to a place on a page. Minimized answers stay there as markers. */
internal data class ReaderAnswerPin(val key: String, val page: Int, val rect: PdfRect, val provenance: JsonObject?,
    val selected: Pair<Int, PdfTextSelection>, val requestId: String?, val historyId: String?, val kind: String)

internal fun readerAnswerPins(requests: List<AiRequestEntity>, history: List<HistoryEntity>): List<ReaderAnswerPin> {
    fun parse(text: String) = runCatching { WireJson.format.parseToJsonElement(text).jsonObject }.getOrNull()
    val live = history.map { it.id }.toSet()
    val local = requests.filter { it.kind in listOf("question", "explanation") && (it.historyId == null || it.historyId in live) }.mapNotNull { row ->
        val selected = parse(row.contextJson)?.let(::contextSelection) ?: return@mapNotNull null
        val rect = selected.second.rects.firstOrNull() ?: return@mapNotNull null
        ReaderAnswerPin(row.requestId, selected.first, rect, null, selected, row.requestId, row.historyId, row.kind)
    }
    val claimed = local.mapNotNull { it.historyId }.toSet()
    val remote = history.filter { it.id !in claimed }.mapNotNull { row ->
        val json = parse(row.json) ?: return@mapNotNull null
        val context = json["context"] as? JsonObject ?: return@mapNotNull null
        val page = context["page"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
        val bounds = context["rect"] as? JsonObject ?: return@mapNotNull null
        fun value(name: String) = bounds[name]?.jsonPrimitive?.floatOrNull ?: 0f
        val rect = PdfRect(value("x"), value("y"), value("width"), value("height"))
        val provenance = context["provenance"] as? JsonObject
        val text = context["selectedText"]?.jsonPrimitive?.contentOrNull.orEmpty()
        ReaderAnswerPin(row.id, page, rect, provenance, page to PdfTextSelection(text, listOf(rect)),
            json["requestId"]?.jsonPrimitive?.contentOrNull, row.id, json["kind"]?.jsonPrimitive?.contentOrNull.orEmpty())
    }
    return local + remote
}

@Composable
internal fun BoxScope.ReaderAnswerPins(pins: List<ReaderAnswerPin>, width: Int, height: Int, rotation: Int,
    onOpen: (ReaderAnswerPin, Offset) -> Unit) {
    val density = LocalDensity.current
    val colors = LocalFractalColors.current
    val size = with(density) { 32.dp.roundToPx() }
    val placed = mutableMapOf<Pair<Int, Int>, Int>()
    pins.forEach { pin -> key(pin.key) {
        val rect = renderedRect(pin.rect, pin.provenance, rotation)
        // Markers sit in the left margin beside the asked-about line, like margin notes, so they
        // never cover the text. Answers about the same line fan out to the right.
        val y = ((rect.y + rect.height / 2) * height - size / 2f).roundToInt().coerceIn(0, (height - size).coerceAtLeast(0))
        val slot = placed.merge(0 to y / size, 1, Int::plus)!! - 1
        val x = (with(density) { 4.dp.roundToPx() } + slot * size).coerceAtMost((width - size).coerceAtLeast(0))
        var anchor by remember { mutableStateOf(Offset.Zero) }
        Surface(onClick = { onOpen(pin, anchor) },
            modifier = Modifier.offset { IntOffset(x, y) }.size(32.dp).nativeInkBlocker()
                .onGloballyPositioned { anchor = it.boundsInWindow().bottomLeft }
                .testTag("reader-answer-pin-${pin.requestId ?: pin.key}")
                .semantics { contentDescription = if (pin.kind == "explanation") "Open explanation" else "Open answer" },
            shape = androidx.compose.foundation.shape.CircleShape, color = colors.focus, shadowElevation = 3.dp) {
            Box(contentAlignment = Alignment.Center) {
                Text(if (pin.kind == "explanation") "i" else "?", color = colors.paper, style = MaterialTheme.typography.labelLarge)
            }
        }
    } }
}

/** Position belongs to the reader session, while generation belongs to durable history. */
@Composable
internal fun BoxScope.ReaderAnswerCard(app: ReaderApplication, paperKey: String, pages: PdfPages?,
    target: ReaderAnswerTarget, position: Offset?, onPosition: (Offset) -> Unit, widthPx: Float, heightPx: Float,
    onJump: (Int) -> Unit, onClose: () -> Unit, onMinimize: () -> Unit = onClose) {
    val density = LocalDensity.current
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    val history by app.database.metadata().observeHistory(paperKey).collectAsState(emptyList())
    val requests by app.database.reader().observeRequests(paperKey).collectAsState(emptyList())
    var selectedContext by remember(target) { mutableStateOf(target.selected) }
    var requestId by remember(target) { mutableStateOf(target.requestId) }
    var question by remember(target) { mutableStateOf("") }
    var error by remember(target) { mutableStateOf("") }
    var initialized by remember(target) { mutableStateOf(false) }
    var busy by remember(target) { mutableStateOf(false) }
    var language by remember { mutableStateOf("auto") }
    var model by remember { mutableStateOf("") }
    var providers by remember { mutableStateOf<JsonObject?>(app.settings.getString("cachedReaderProviders", null)?.let {
        runCatching { WireJson.format.parseToJsonElement(it).jsonObject }.getOrNull() }) }
    val models = readerModels(providers)
    val request = requests.firstOrNull { it.requestId == requestId }
    val record = history.firstOrNull { it.id == request?.historyId || it.id == target.historyId ||
        runCatching { WireJson.format.parseToJsonElement(it.json).jsonObject["requestId"]?.jsonPrimitive?.contentOrNull == requestId && requestId != null }.getOrDefault(false) }
    val json = record?.let { runCatching { WireJson.format.parseToJsonElement(it.json).jsonObject }.getOrNull() }
    fun value(name: String) = json?.get(name)?.jsonPrimitive?.contentOrNull.orEmpty()
    val response = value("text")
    val submitted = request?.let { runCatching { WireJson.format.parseToJsonElement(it.bodyJson).jsonObject }.getOrNull() }
    val asked = value("question").ifBlank { submitted?.get("question")?.jsonPrimitive?.contentOrNull.orEmpty() }
    val heading = target.item?.label?.ifBlank { target.item.kind } ?: libraryText("Answer", "답변")
    val cardWidth = with(density) { minOf(380.dp.toPx(), widthPx - 16.dp.toPx()).coerceAtLeast(1f) }
    var cardHeight by remember { mutableStateOf(with(density) { 300.dp.toPx() }) }
    val effectiveWidth = cardWidth
    fun clamp(offset: Offset) = Offset(offset.x.coerceIn(0f, (widthPx - effectiveWidth).coerceAtLeast(0f)),
        offset.y.coerceIn(0f, (heightPx - cardHeight).coerceAtLeast(0f)))
    val currentPosition = clamp(position ?: target.anchor ?: Offset(with(density) { 8.dp.toPx() }, heightPx * .25f))
    val latestPosition = rememberUpdatedState(currentPosition)
    LaunchedEffect(widthPx, heightPx, cardHeight) { onPosition(currentPosition) }
    fun submit(explain: Boolean) { if (busy || !initialized) return; busy = true; error = ""
        scope.launch {
            try {
                val selected = selectedContext
                val selectedModel = resolveReaderModel(model, models)
                val body = if (explain) withReaderCrop(readerExplainBody(language, selectedModel,
                    selected ?: error("Choose original context first"), target.item, target.pageText), pages, selected)
                else readerQuestionBody(question, language, selectedModel, selected)
                requestId = app.history.create(paperKey, if (explain) "explanation" else "question", body, selectionContext(selected))
                question = ""
                app.history.saveDraft(paperKey, buildJsonObject { put("question", ""); put("language", language); put("model", model); put("context", selectionContext(selected)) })
            } catch (cancel: CancellationException) { throw cancel }
            catch (failure: Exception) { error = failure.message.orEmpty() }
            finally { busy = false }
        }
    }
    LaunchedEffect(target) {
        val draft = app.history.draft(paperKey)
        language = draft["language"]?.jsonPrimitive?.contentOrNull ?: "auto"
        model = draft["model"]?.jsonPrimitive?.contentOrNull.orEmpty()
        if (selectedContext == null) selectedContext = (draft["context"] as? JsonObject)?.let(::contextSelection)
        if (target.requestId == null && !target.explain) question = draft["question"]?.jsonPrimitive?.contentOrNull.orEmpty()
        app.history.saveDraft(paperKey, buildJsonObject { put("context", selectionContext(selectedContext)) })
        initialized = true
        if (target.explain && target.requestId == null) submit(true)
    }
    LaunchedEffect(paperKey) {
        if (app.credentials.load() == null) return@LaunchedEffect
        runCatching { app.history.reconnect(paperKey) }
        runCatching { app.client.data("/api/ai/providers").jsonObject }.onSuccess { providers = it; app.settings.edit().putString("cachedReaderProviders", it.toString()).apply() }
        while (isActive) { runCatching { app.history.refresh(paperKey) }; delay(1500) }
    }
    Surface(Modifier.offset { IntOffset(currentPosition.x.roundToInt(), currentPosition.y.roundToInt()) }
        .width(with(density) { effectiveWidth.toDp() }).heightIn(max = with(density) { minOf(520.dp.toPx(), heightPx * .65f).coerceAtLeast(48.dp.toPx()).toDp() })
        .onSizeChanged { cardHeight = it.height.toFloat() }.nativeInkBlocker().testTag("reader-answer-card"),
        shape = MaterialTheme.shapes.medium, color = colors.paper, shadowElevation = 8.dp, tonalElevation = 3.dp) {
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(heading, Modifier.weight(1f).heightIn(min = 48.dp).padding(start = 12.dp).wrapContentHeight()
                    .testTag("reader-answer-drag").semantics { contentDescription = "Move answer" }
                    .pointerInput(widthPx, heightPx, cardHeight, effectiveWidth) {
                        var dragging = currentPosition
                        detectDragGestures(onDragStart = { dragging = latestPosition.value }) { change, amount ->
                            change.consume(); dragging = clamp(dragging + amount); onPosition(dragging)
                        }
                    }, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                // Minimizing leaves a marker on the page where the question was asked.
                TextButton(onClick = onMinimize, modifier = Modifier.testTag("reader-answer-collapse")
                    .semantics { contentDescription = "Minimize answer to page" }) { Text("−") }
                TextButton(onClick = onClose, modifier = Modifier.testTag("reader-answer-close")) { Text("×") }
            }
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                if (asked.isNotBlank()) Text(asked, style = MaterialTheme.typography.titleSmall)
                if (selectedContext?.second?.text?.isNotBlank() == true) Text(selectedContext!!.second.text,
                    maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                if (response.isNotBlank()) SelectionContainer { Text(response, Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium) }
                if (requestId != null && response.isBlank()) Text(readerStateLabel(value("status").ifBlank { request?.status ?: "queued" }), Modifier.padding(vertical = 8.dp))
                val answer = json?.get("answer") as? JsonObject
                val citations = (answer?.get("citations") as? JsonArray).orEmpty().mapNotNull { citation ->
                    val c = citation as? JsonObject
                    if (c?.get("paperKey")?.jsonPrimitive?.contentOrNull in listOf(null, paperKey)) c?.get("page")?.jsonPrimitive?.intOrNull else null
                } + Regex("\\[p\\.(\\d+)]").findAll(response).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()
                Row(Modifier.horizontalScroll(rememberScrollState())) { citations.distinct().filter { it in 1..(pages?.pageCount ?: 0) }.forEach { page ->
                    TextButton(onClick = { onJump(page) }) { Text("[p.$page]") }
                } }
                val failure = error.ifBlank { request?.error.orEmpty() }
                if (failure.isNotBlank()) Text(failure, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                if (request?.status == "failed") TextButton(onClick = { app.history.send(request.requestId) }) { Text(libraryText("Retry", "재시도")) }
                OutlinedTextField(question, { question = it; app.history.saveDraft(paperKey, buildJsonObject { put("question", it) }) },
                    Modifier.fillMaxWidth().testTag("reader-answer-question"), enabled = initialized, label = { Text(libraryText(if (requestId == null) "Ask a question" else "Follow-up question", if (requestId == null) "질문하기" else "후속 질문")) }, maxLines = 4)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { submit(false) }, enabled = initialized && question.isNotBlank() && question.length <= 4000 && !busy) { Text(libraryText("Ask", "질문")) }
                    if (selectedContext?.second?.origin == "original") TextButton(onClick = { submit(true) }, enabled = initialized && !busy && !selectedContext?.second?.rects.isNullOrEmpty()) { Text(libraryText("Explain", "설명")) }
                }
                val languages = readerLanguageOptions()
                val retainedLanguage = if (languages.none { it.first == language }) listOf(language to java.util.Locale.forLanguageTag(language).getDisplayName(java.util.Locale.getDefault())) else emptyList()
                ResearchSelector(libraryText("Answer language", "답변 언어"), language, languages + retainedLanguage,
                    { language = it; app.history.saveDraft(paperKey, buildJsonObject { put("language", it) }) })
                val unavailable = libraryText("unavailable", "사용 불가")
                val retainedModel = if (model.isNotBlank() && models.none { it.value == model }) listOf(model to "$model · $unavailable") else emptyList()
                ResearchSelector(libraryText("Model", "모델"), model,
                    listOf("" to libraryText("Hub default", "허브 기본값")) + models.map { it.value to if (it.available) it.label else "${it.label} · $unavailable" } + retainedModel,
                    { model = it; app.history.saveDraft(paperKey, buildJsonObject { put("model", it) }) })
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
