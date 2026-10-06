package app.fractal.reader

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.pdf.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private fun JsonObject.string(name: String) = this[name]?.jsonPrimitive?.contentOrNull.orEmpty()
internal fun selectionContext(value: Pair<Int, PdfTextSelection>?): JsonObject = buildJsonObject {
    value?.let { (page, selection) ->
        put("page", page); put("text", selection.text); put("origin", selection.origin); put("blockId", selection.blockId)
        put("provenanceLabel", selection.provenance); put("hash", selection.pdfSha256); put("version", selection.extractionVersion)
        put("start", selection.start); put("end", selection.end); put("rotation", selection.rotation)
        fun rectangles(rects: List<PdfRect>) = JsonArray(rects.map { rect -> buildJsonObject { put("x", rect.x); put("y", rect.y); put("width", rect.width); put("height", rect.height) } })
        put("quads", JsonArray(selection.quads.map { quad -> JsonArray(quad.map { (x, y) -> buildJsonObject { put("x", x); put("y", y) } }) }))
        put("rects", rectangles(selection.rects)); put("originalRects", rectangles(selection.originalRects))
    }
}
internal fun contextSelection(context: JsonObject): Pair<Int, PdfTextSelection>? {
    val page = context["page"]?.jsonPrimitive?.intOrNull ?: return null
    fun rectangles(name: String) = (context[name] as? JsonArray).orEmpty().map { value ->
        val r = value.jsonObject; fun n(name: String) = r[name]?.jsonPrimitive?.floatOrNull ?: 0f
        PdfRect(n("x"), n("y"), n("width"), n("height"))
    }
    return page to PdfTextSelection(context.string("text"), rectangles("rects"), context["start"]?.jsonPrimitive?.intOrNull, context["end"]?.jsonPrimitive?.intOrNull,
        quads = (context["quads"] as? JsonArray).orEmpty().map { quad -> quad.jsonArray.map { point ->
            point.jsonObject["x"]!!.jsonPrimitive.float to point.jsonObject["y"]!!.jsonPrimitive.float
        } }, origin = context.string("origin").ifBlank { "original" }, blockId = context["blockId"]?.jsonPrimitive?.contentOrNull,
        provenance = context.string("provenanceLabel"), originalRects = rectangles("originalRects"), pdfSha256 = context["hash"]?.jsonPrimitive?.contentOrNull,
        extractionVersion = context["version"]?.jsonPrimitive?.contentOrNull, rotation = context["rotation"]?.jsonPrimitive?.intOrNull)
}

@Composable
internal fun DurableReaderPanel(app: ReaderApplication, paperKey: String, annotations: List<AnnotationEntity>, pages: PdfPages?, tab: String,
    onTabChange: (String) -> Unit, onJump: (Int) -> Unit, modifier: Modifier, incomingQuote: Pair<Int, PdfTextSelection>?, clearQuote: () -> Unit, onClose: () -> Unit, onRequestCreated: (String, Pair<Int, PdfTextSelection>?) -> Unit = { _, _ -> },
    threadId: String, onThreadChange: (String) -> Unit) {
    val colors = LocalFractalColors.current
    val offlineMessage = libraryText("Offline: showing retained history.", "오프라인: 저장된 기록을 표시합니다.")
    val unavailableModel = libraryText("Selected model is unavailable. Choose another model or Hub default.", "선택한 모델을 사용할 수 없습니다. 다른 모델이나 허브 기본값을 선택하세요.")
    val shorterQuote = libraryText("Select a shorter quote to send. Your complete selection is retained.", "전송할 인용문을 더 짧게 선택하세요. 전체 선택 내용은 보존됩니다.")
    val scope = rememberCoroutineScope()
    val history by app.database.metadata().observeHistory(paperKey).collectAsState(emptyList())
    val requests by app.database.reader().observeRequests(paperKey).collectAsState(emptyList())
    var question by remember(paperKey) { mutableStateOf("") }
    var model by remember(paperKey) { mutableStateOf("") }
    var providers by remember { mutableStateOf<JsonObject?>(app.settings.getString("cachedReaderProviders", null)?.let { runCatching { WireJson.format.parseToJsonElement(it).jsonObject }.getOrNull() }) }
    var context by remember(paperKey) { mutableStateOf(JsonObject(emptyMap())) }
    var busy by remember(paperKey) { mutableStateOf(false) }
    var initialized by remember(paperKey) { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var editingNote by remember { mutableStateOf<JsonObject?>(null) }
    var deleting by remember { mutableStateOf<String?>(null) }
    val models = readerModels(providers)
    val modelAvailable = model.isEmpty() || models.any { it.value == model && it.available }
    fun saveDraft() { if (initialized) app.history.saveDraft(paperKey, buildJsonObject {
        put("question", question); put("model", model); put("context", context)
    }) }
    LaunchedEffect(paperKey) {
        val draft = app.history.draft(paperKey)
        question = draft.string("question"); model = draft.string("model")
        context = incomingQuote?.let(::selectionContext) ?: (draft["context"] as? JsonObject ?: JsonObject(emptyMap()))
        initialized = true; saveDraft()
        runCatching { app.client.data("/api/ai/providers").jsonObject }.onSuccess {
            providers = it; app.settings.edit().putString("cachedReaderProviders", it.toString()).apply()
        }
    }
    LaunchedEffect(incomingQuote, initialized) { if (initialized && incomingQuote != null) { context = selectionContext(incomingQuote); saveDraft() } }
    LaunchedEffect(paperKey) {
        if (app.credentials.load() == null) return@LaunchedEffect
        runCatching { app.history.reconnect(paperKey) }.onFailure { error = offlineMessage }
        var ticks = 0
        while (true) {
            delay(1500)
            // This effect and the Room collectors detach on Close; generation remains Hub-owned.
            try { app.history.refresh(paperKey); error = "" } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { error = offlineMessage }
            if (++ticks % 10 == 0) runCatching { app.client.data("/api/ai/providers").jsonObject }.onSuccess {
                providers = it; app.settings.edit().putString("cachedReaderProviders", it.toString()).apply()
            }
        }
    }
    fun submit(explanation: Boolean) {
        if (busy || !initialized) return
        busy = true
        val retained = contextSelection(context)
        val asked = question; val localContext = context
        scope.launch {
            try {
                require(modelAvailable) { unavailableModel }
                require((retained?.second?.text?.length ?: 0) <= 20000) { shorterQuote }
                val selectedModel = resolveReaderModel(model, models)
                val body = if (!explanation) readerQuestionBody(asked, null, selectedModel, retained, threadId) else {
                    val selected = retained ?: error("Choose original text or a region first")
                    withReaderCrop(readerExplainBody(null, selectedModel, selected, threadId = threadId), pages, selected)
                }
                val requestId = app.history.create(paperKey, if (explanation) "explanation" else "question", body, localContext)
                onRequestCreated(requestId, retained)
                question = ""; context = JsonObject(emptyMap()); clearQuote(); saveDraft(); error = ""
            } catch (cancel: CancellationException) { throw cancel }
            catch (failure: Exception) { error = failure.message.orEmpty() }
            finally { busy = false }
        }
    }
    Column(modifier.nativeInkBlocker().background(colors.paper).border(.5.dp, colors.rule)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ResearchSelector(libraryText("Reader panel", "읽기 패널"), tab, listOf("notes" to libraryText("Notes", "노트"), "questions" to libraryText("Questions", "질문"), "history" to libraryText("History", "기록")), onTabChange, Modifier.weight(1f), showLabel = false)
            TextButton(onClick = onClose) { Text(libraryText("Close", "닫기")) }
        }
        HorizontalDivider(color = colors.rule)
        if (error.isNotBlank()) Text(error, Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
        if (tab == "notes") LazyColumn(Modifier.weight(1f)) {
            items(annotations.filter { it.kind in listOf("memo", "highlight") }, key = { it.id }) { row ->
                val json = WireJson.format.parseToJsonElement(row.json).jsonObject
                val note = readerNoteText(row.kind, json)
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    TextButton(onClick = { onJump(row.page) }) { Text(libraryText("Page ${row.page}", "${row.page}쪽")) }
                    SelectionContainer { Column { if (note.quote.isNotBlank()) Text(note.quote, style = MaterialTheme.typography.bodyMedium); if (note.body.isNotBlank()) Text(note.body, Modifier.padding(top = 8.dp)) } }
                    if (note.quote.isBlank() && row.kind == "highlight") RegionThumbnail(pages, row.page, row.json)
                    if (row.kind == "memo") Row {
                        TextButton(onClick = { editingNote = json }) { Text(libraryText("Edit", "편집")) }
                        TextButton(onClick = { scope.launch { editAnnotation(app, json, buildJsonObject { put("collapsed", !(json["collapsed"]?.jsonPrimitive?.booleanOrNull ?: false)) }) } }) { Text(libraryText("Collapse / expand", "접기 / 펼치기")) }
                    }
                }
                HorizontalDivider(color = colors.rule, thickness = .5.dp)
            }
        } else {
            val threads = readerThreads(history, requests)
            val active = threads.firstOrNull { it.id == threadId }
            if (tab == "history") {
                LazyColumn(Modifier.weight(1f).testTag("reader-thread-history")) {
                    items(threads, key = { it.id }) { thread ->
                        TextButton(onClick = { onThreadChange(thread.id)
                            val pin = readerAnswerPins(requests, history).firstOrNull { it.key == thread.id }
                            if (pin != null) {
                                val old = answerThreadRoot(history, thread.id)?.answerPlacement() ?: localAnswerPlacement(requests, thread.id)
                                saveAnswerPlacement(app, paperKey, thread.id, old?.copy(state = "open", updatedAt = java.time.Instant.now().toString())
                                    ?: AnswerPlacement(pin.page, pin.rect.x.coerceIn(0f, 1f), (pin.rect.y + pin.rect.height).coerceIn(0f, 1f), "open", java.time.Instant.now().toString()))
                                onJump(pin.page); onClose()
                            } else onTabChange("questions") }, modifier = Modifier.fillMaxWidth().testTag("reader-thread-${thread.id}")) {
                            Column(Modifier.fillMaxWidth().padding(8.dp)) {
                                Text(thread.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(libraryText("${thread.turns.size} turns", "${thread.turns.size}개 대화"), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        HorizontalDivider(color = colors.rule)
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(active?.title ?: libraryText("New question", "새 질문"), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                    TextButton(onClick = { onThreadChange(java.util.UUID.randomUUID().toString()); question = ""; context = JsonObject(emptyMap()); clearQuote(); saveDraft() }, modifier = Modifier.testTag("reader-new-question")) { Text(libraryText("New question", "새 질문")) }
                }
                val listState = rememberLazyListState()
                LaunchedEffect(threadId, active?.turns?.size) { if (!active?.turns.isNullOrEmpty()) listState.animateScrollToItem(active!!.turns.lastIndex) }
                LazyColumn(Modifier.weight(1f).testTag("reader-question-thread"), state = listState) {
                    items(active?.turns.orEmpty(), key = { it.id }) { turn ->
                        Column(Modifier.fillMaxWidth().padding(12.dp).testTag("reader-turn-${turn.id}")) {
                            Surface(color = colors.rule.copy(alpha = .2f), shape = MaterialTheme.shapes.small) {
                                Column(Modifier.fillMaxWidth().padding(10.dp)) {
                                    Text(turn.question, style = MaterialTheme.typography.titleSmall)
                                    if (turn.quote.isNotBlank()) Text("📎 p.${turn.page ?: "?"} · “${turn.quote}”", Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            SelectionContainer { Text(turn.text.ifBlank { readerStateLabel(turn.status) }, Modifier.padding(vertical = 12.dp)) }
                            if (turn.status in listOf("running", "pending") && turn.text.isNotBlank()) Text(readerStateLabel(turn.status), style = MaterialTheme.typography.bodySmall)
                            val cited = readerTurnCitations(turn, paperKey)
                            Row(Modifier.horizontalScroll(rememberScrollState())) { cited.distinct().filter { it in 1..(pages?.pageCount ?: 0) }.forEach { page -> TextButton(onClick = { onJump(page) }) { Text("[p.$page]") } } }
                            val failure = turn.request?.error ?: (turn.json["error"] as? JsonObject)?.threadText("message")
                            failure?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            (turn.json["answer"] as? JsonObject)?.threadText("contextSourceStatus")?.takeIf { it.isNotBlank() && it != "current" }?.let { Text(readerSourceLabel(it), style = MaterialTheme.typography.bodySmall) }
                            Row {
                                if (turn.request?.status == "failed") TextButton(onClick = { app.history.send(turn.request.requestId) }) { Text(libraryText("Retry", "재시도")) }
                                turn.historyId?.let { id ->
                                    if (turn.status in listOf("running", "pending")) TextButton(onClick = { scope.launch { app.history.action(paperKey, id, "cancel") } }) { Text(libraryText("Cancel", "취소")) }
                                    TextButton(onClick = { deleting = id }) { Text(libraryText("Delete…", "삭제…")) }
                                }
                            }
                        }
                    }
                }
                Column(Modifier.padding(12.dp)) {
                    contextSelection(context)?.let { (page, selected) ->
                        Row(Modifier.fillMaxWidth().testTag("reader-quote-attachment"), verticalAlignment = Alignment.CenterVertically) {
                            Text("📎 p.$page · “${selected.text.ifBlank { libraryText("Selected region", "선택 영역") }}”", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { context = JsonObject(emptyMap()); clearQuote(); saveDraft() }, modifier = Modifier.testTag("reader-remove-attachment")) { Text("×") }
                        }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(question, { question = it; saveDraft() }, label = { Text(libraryText("Ask about this paper", "이 논문에 질문")) }, modifier = Modifier.weight(1f).testTag("reader-thread-input"), maxLines = 4)
                        Box {
                            var expanded by remember { mutableStateOf(false) }
                            TextButton(onClick = { expanded = true }, modifier = Modifier.testTag("reader-thread-model")) { Text(models.firstOrNull { it.value == model }?.label ?: libraryText("Model", "모델"), maxLines = 1, modifier = Modifier.widthIn(max = 72.dp), overflow = TextOverflow.Ellipsis) }
                            DropdownMenu(expanded, { expanded = false }) {
                                DropdownMenuItem(text = { Text(libraryText("Hub default", "허브 기본값")) }, onClick = { model = ""; expanded = false; saveDraft() })
                                models.forEach { choice -> DropdownMenuItem(text = { Text(choice.label) }, enabled = choice.available, onClick = { model = choice.value; expanded = false; saveDraft() }) }
                            }
                        }
                        TextButton(enabled = initialized && !busy && modelAvailable && question.isNotBlank() && question.length <= 4000, onClick = { submit(false) }, modifier = Modifier.testTag("reader-thread-send")) { Text(libraryText("Send", "보내기")) }
                    }
                    if (!modelAvailable) Text(unavailableModel, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    editingNote?.let { original -> NoteEditor(original, readerNoteText("memo", original).quote, { editingNote = null }) { body, color -> scope.launch { editAnnotation(app, original, buildJsonObject { put("text", body); put("color", color) }) }; editingNote = null } }
    deleting?.let { id -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text(libraryText("Delete retained history?", "저장된 기록을 삭제할까요?")) },
        text = { Text(libraryText("Closing the panel keeps answers. This explicitly deletes the entry.", "패널을 닫아도 답변은 보존됩니다. 이 작업은 기록을 삭제합니다.")) },
        confirmButton = { TextButton(onClick = { scope.launch { app.history.action(paperKey, id, "delete") }; deleting = null }) { Text(libraryText("Delete", "삭제")) } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text(libraryText("Keep", "유지")) } }) }
}
