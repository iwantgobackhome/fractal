package app.fractal.reader

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.pdf.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private fun JsonObject.string(name: String) = this[name]?.jsonPrimitive?.contentOrNull.orEmpty()
private fun selectionContext(value: Pair<Int, PdfTextSelection>?): JsonObject = buildJsonObject {
    value?.let { (page, selection) ->
        put("page", page); put("text", selection.text); put("origin", selection.origin); put("blockId", selection.blockId)
        put("provenanceLabel", selection.provenance); put("hash", selection.pdfSha256); put("version", selection.extractionVersion)
        put("start", selection.start); put("end", selection.end); put("rotation", selection.rotation)
        fun rectangles(rects: List<PdfRect>) = JsonArray(rects.map { rect -> buildJsonObject { put("x", rect.x); put("y", rect.y); put("width", rect.width); put("height", rect.height) } })
        put("rects", rectangles(selection.rects)); put("originalRects", rectangles(selection.originalRects))
    }
}
private fun contextSelection(context: JsonObject): Pair<Int, PdfTextSelection>? {
    val page = context["page"]?.jsonPrimitive?.intOrNull ?: return null
    fun rectangles(name: String) = (context[name] as? JsonArray).orEmpty().map { value ->
        val r = value.jsonObject; fun n(name: String) = r[name]?.jsonPrimitive?.floatOrNull ?: 0f
        PdfRect(n("x"), n("y"), n("width"), n("height"))
    }
    return page to PdfTextSelection(context.string("text"), rectangles("rects"), context["start"]?.jsonPrimitive?.intOrNull, context["end"]?.jsonPrimitive?.intOrNull,
        origin = context.string("origin").ifBlank { "original" }, blockId = context["blockId"]?.jsonPrimitive?.contentOrNull,
        provenance = context.string("provenanceLabel"), originalRects = rectangles("originalRects"), pdfSha256 = context["hash"]?.jsonPrimitive?.contentOrNull,
        extractionVersion = context["version"]?.jsonPrimitive?.contentOrNull, rotation = context["rotation"]?.jsonPrimitive?.intOrNull)
}

@Composable
internal fun DurableReaderPanel(app: ReaderApplication, paperKey: String, annotations: List<AnnotationEntity>, pages: PdfPages?, tab: String,
    onTabChange: (String) -> Unit, onJump: (Int) -> Unit, modifier: Modifier, incomingQuote: Pair<Int, PdfTextSelection>?, clearQuote: () -> Unit, onClose: () -> Unit) {
    val colors = LocalFractalColors.current
    val offlineMessage = libraryText("Offline: showing retained history.", "오프라인: 저장된 기록을 표시합니다.")
    val unavailableModel = libraryText("Selected model is unavailable. Choose another model or Hub default.", "선택한 모델을 사용할 수 없습니다. 다른 모델이나 허브 기본값을 선택하세요.")
    val unavailableLabel = libraryText("unavailable", "사용 불가")
    val shorterQuote = libraryText("Select a shorter quote to send. Your complete selection is retained.", "전송할 인용문을 더 짧게 선택하세요. 전체 선택 내용은 보존됩니다.")
    val scope = rememberCoroutineScope()
    val history by app.database.metadata().observeHistory(paperKey).collectAsState(emptyList())
    val requests by app.database.reader().observeRequests(paperKey).collectAsState(emptyList())
    var question by remember(paperKey) { mutableStateOf("") }
    var model by remember(paperKey) { mutableStateOf("") }
    var language by remember(paperKey) { mutableStateOf("auto") }
    var providers by remember { mutableStateOf<JsonObject?>(app.settings.getString("cachedReaderProviders", null)?.let { runCatching { WireJson.format.parseToJsonElement(it).jsonObject }.getOrNull() }) }
    var context by remember(paperKey) { mutableStateOf(JsonObject(emptyMap())) }
    var initialized by remember(paperKey) { mutableStateOf(false) }
    var filter by remember { mutableStateOf("all") }
    var error by remember { mutableStateOf("") }
    var editingNote by remember { mutableStateOf<JsonObject?>(null) }
    var deleting by remember { mutableStateOf<String?>(null) }
    var fullQuote by remember { mutableStateOf(false) }
    val models = readerModels(providers)
    val modelAvailable = model.isEmpty() || models.any { it.value == model && it.available }
    fun saveDraft() { if (initialized) app.history.saveDraft(paperKey, buildJsonObject {
        put("question", question); put("model", model); put("language", language); put("context", context)
    }) }
    LaunchedEffect(paperKey) {
        val draft = app.history.draft(paperKey)
        question = draft.string("question"); model = draft.string("model"); language = draft.string("language").ifBlank { "auto" }
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
        val retained = contextSelection(context)
        val asked = question; val localContext = context
        scope.launch {
            try {
                require(modelAvailable) { unavailableModel }
                require((retained?.second?.text?.length ?: 0) <= 20000) { shorterQuote }
                val selectedModel = resolveReaderModel(model, models)
                val body = if (!explanation) readerQuestionBody(asked, language, selectedModel, retained) else {
                    val selected = retained ?: error("Choose original text or a region first")
                    require(selected.second.origin == "original")
                    val base = readerQuestionBody("", language, selectedModel, selected)
                    JsonObject(base.filterKeys { it !in listOf("question", "selectedText", "rect") } + buildJsonObject {
                        put("kind", if (selected.second.text.isBlank()) "figure" else "text")
                        put("surroundingText", selected.second.text); put("bbox", base["rect"] ?: error("Original region is unavailable"))
                        if (selected.second.text.isBlank() && pages?.identityUnchanged() == true && pages.pdfSha256 == selected.second.pdfSha256) {
                            val encoded = withContext(Dispatchers.IO) {
                                val rect = base["rect"]!!.jsonObject
                                val image = pages.bitmap(selected.first - 1, 1000)
                                fun value(name: String) = rect[name]!!.jsonPrimitive.double
                                val x = (value("x") * image.width).toInt().coerceIn(0, image.width - 1)
                                val y = (value("y") * image.height).toInt().coerceIn(0, image.height - 1)
                                val width = (value("width") * image.width).toInt().coerceIn(1, image.width - x)
                                val height = (value("height") * image.height).toInt().coerceIn(1, image.height - y)
                                val crop = android.graphics.Bitmap.createBitmap(image, x, y, width, height)
                                val bytes = java.io.ByteArrayOutputStream()
                                crop.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bytes)
                                if (crop !== image) crop.recycle()
                                android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP)
                            }
                            if (encoded.length <= 4_000_000) put("croppedPngBase64", encoded)
                        }
                    })
                }
                app.history.create(paperKey, if (explanation) "explanation" else "question", body, localContext)
                question = ""; saveDraft(); error = ""
            } catch (cancel: CancellationException) { throw cancel }
            catch (failure: Exception) { error = failure.message.orEmpty() }
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
            if (tab == "history") ResearchSelector(libraryText("Filter history", "기록 필터"), filter, listOf("all" to libraryText("All", "전체"), "question" to libraryText("Questions", "질문"), "explanation" to libraryText("Explanations", "설명"), "active" to libraryText("In progress", "진행 중"), "failed" to libraryText("Failed / canceled", "실패 / 취소")), { filter = it }, Modifier.padding(12.dp))
            LazyColumn(Modifier.weight(1f)) {
                items(requests.filter { it.kind in listOf("question", "explanation", "cancel", "delete") && (it.historyId == null || it.status == "failed" || (it.kind in listOf("cancel", "delete") && it.status != "done")) &&
                    (filter == "all" || filter == it.kind || (filter == "active" && it.status in listOf("queued", "sending")) || (filter == "failed" && it.status == "failed")) }, key = { "request:${it.requestId}" }) { row ->
                    val body = WireJson.format.parseToJsonElement(row.bodyJson).jsonObject
                    Column(Modifier.padding(16.dp)) {
                        Text("${readerKindLabel(row.kind)} · ${readerStateLabel(row.status)}", style = MaterialTheme.typography.labelMedium)
                        Text(body.string("question").ifBlank { body.string("surroundingText") })
                        val retained = WireJson.format.parseToJsonElement(row.contextJson).jsonObject
                        if (retained.string("text").isNotBlank()) Text(retained.string("text"), style = MaterialTheme.typography.bodySmall)
                        if (row.error != null) Text(libraryText("Could not send. Context is retained for retry.", "전송하지 못했습니다. 재시도할 문맥이 보존됩니다."), color = colors.inkSoft)
                        if (row.status == "failed") TextButton(onClick = { app.history.send(row.requestId) }) { Text(libraryText("Retry same request", "동일 요청 재시도")) }
                    }
                }
                items(history.filter { row ->
                    val kind = WireJson.format.parseToJsonElement(row.json).jsonObject.string("kind")
                    filter == "all" || (filter == kind) || (filter == "active" && row.status in listOf("pending", "running")) || (filter == "failed" && row.status in listOf("failed", "canceled"))
                }, key = { it.id }) { row ->
                    val json = WireJson.format.parseToJsonElement(row.json).jsonObject
                    val ctx = json["context"] as? JsonObject ?: JsonObject(emptyMap())
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text("${readerKindLabel(json.string("kind"))} · ${readerStateLabel(row.status)}", style = MaterialTheme.typography.labelMedium, color = colors.inkSoft)
                        if (json.string("kind") == "explanation") Text("${readerExcerptLabel(ctx.string("explanationKind"))} · ${libraryText("page", "쪽")} ${ctx["page"]?.jsonPrimitive?.intOrNull ?: ""}", style = MaterialTheme.typography.titleSmall)
                        else if (json.string("question").isNotBlank()) Text(json.string("question"), style = MaterialTheme.typography.titleSmall)
                        if (ctx.string("selectedText").isNotBlank()) Text(ctx.string("selectedText"), Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
                        if (ctx["rect"] is JsonObject) RegionThumbnail(pages, ctx["page"]?.jsonPrimitive?.intOrNull ?: 0, buildJsonObject {
                            put("paperKey", paperKey); put("rects", JsonArray(listOf(ctx["rect"]!!))); ctx["provenance"]?.let { put("provenance", it) }
                        }.toString())
                        val local = requests.firstOrNull { it.historyId == row.id }?.contextJson?.let { WireJson.format.parseToJsonElement(it).jsonObject }
                        if (local?.string("origin") == "translated" || (ctx["provenance"] as? JsonObject)?.string("textSource") == "translated") Text(readerQuoteLabel("translated"), style = MaterialTheme.typography.bodySmall)
                        SelectionContainer { Text(json.string("text"), Modifier.padding(vertical = 8.dp)) }
                        val answer = json["answer"] as? JsonObject
                        answer?.string("contextSourceStatus")?.takeIf { it.isNotBlank() && it != "current" }?.let { Text(readerSourceLabel(it), style = MaterialTheme.typography.bodySmall) }
                        val citedPages = answer?.get("citations")?.jsonArray.orEmpty().mapNotNull { citation ->
                            val c = citation.jsonObject
                            if (c.string("paperKey") != paperKey) null else c["page"]?.jsonPrimitive?.intOrNull
                        } + Regex("\\[p\\.(\\d+)]").findAll(json.string("text")).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()
                        Row(Modifier.horizontalScroll(rememberScrollState())) { citedPages.distinct().filter { it in 1..(pages?.pageCount ?: 0) }.forEach { page -> TextButton(onClick = { onJump(page) }) { Text("[p.$page]") } } }
                        json["error"]?.takeIf { it is JsonObject }?.jsonObject?.string("message")?.let { Text(it, color = colors.inkSoft) }
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            if (row.status in listOf("pending", "running")) TextButton(onClick = { scope.launch { app.history.action(paperKey, row.id, "cancel") } }) { Text(libraryText("Cancel generation", "생성 취소")) }
                            TextButton(onClick = { deleting = row.id }) { Text(libraryText("Delete…", "삭제…")) }
                        }
                    }
                    HorizontalDivider(color = colors.rule, thickness = .5.dp)
                }
            }
            if (tab == "questions") Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()).padding(12.dp)) {
                contextSelection(context)?.let { (page, selected) ->
                    Text("${readerQuoteLabel(selected.origin)} · ${libraryText("page", "쪽")} $page", style = MaterialTheme.typography.bodySmall)
                    Text(selected.text.ifBlank { libraryText("Selected source region", "선택한 원문 영역") }, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Row { if (selected.text.isNotBlank()) TextButton(onClick = { fullQuote = true }) { Text(libraryText("Full quote", "전체 인용문")) }
                        TextButton(onClick = { context = JsonObject(emptyMap()); clearQuote(); saveDraft() }) { Text(libraryText("Clear quote", "인용 해제")) } }
                }
                val modelOptions = models.map { it.value to if (it.available) it.label else "${it.label} · $unavailableLabel" }
                val retainedChoice = if (model.isNotEmpty() && models.none { it.value == model }) listOf(model to "$model · $unavailableLabel") else emptyList()
                ResearchSelector(libraryText("Model", "모델"), model, listOf("" to libraryText("Hub default", "허브 기본값")) + modelOptions + retainedChoice, { model = it; saveDraft() })
                if (!modelAvailable) Text(unavailableModel, style = MaterialTheme.typography.bodySmall)
                val languages = listOf("auto" to libraryText("Automatic", "자동"), "en" to "English", "ko" to "한국어", "ja" to "日本語", "zh-CN" to "简体中文", "zh-Hant" to "繁體中文", "de" to "Deutsch", "fr" to "Français", "es" to "Español", "pt-BR" to "Português (Brasil)", "it" to "Italiano", "ar" to "العربية")
                val retainedLanguage = if (languages.none { it.first == language }) listOf(language to java.util.Locale.forLanguageTag(language).getDisplayName(java.util.Locale.getDefault())) else emptyList()
                ResearchSelector(libraryText("Answer language", "답변 언어"), language, languages + retainedLanguage, { language = it; saveDraft() }, Modifier.padding(top = 8.dp))
                OutlinedTextField(question, { question = it; saveDraft() }, label = { Text(libraryText("Ask about this paper", "이 논문에 질문")) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), minLines = 2, maxLines = 5)
                Row {
                    TextButton(enabled = initialized && modelAvailable && question.isNotBlank() && question.length <= 4000, onClick = { submit(false) }) { Text(libraryText("Send", "보내기")) }
                    TextButton(enabled = initialized && modelAvailable && contextSelection(context)?.second?.let { it.origin == "original" && it.rects.isNotEmpty() } == true, onClick = { submit(true) }) { Text(libraryText("Explain selection", "선택 내용 설명")) }
                }
                if (app.credentials.load() == null) Text(libraryText("Pair with a Hub to send. Drafts and failed requests are retained locally.", "전송하려면 허브와 연결하세요. 초안과 실패한 요청은 기기에 보존됩니다."), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    editingNote?.let { original -> NoteEditor(original, readerNoteText("memo", original).quote, { editingNote = null }) { body, color -> scope.launch { editAnnotation(app, original, buildJsonObject { put("text", body); put("color", color) }) }; editingNote = null } }
    if (fullQuote) AlertDialog(onDismissRequest = { fullQuote = false }, title = { Text(libraryText("Retained quote", "저장된 인용문")) }, text = {
        SelectionContainer { Text(contextSelection(context)?.second?.text.orEmpty(), Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) }
    }, confirmButton = { TextButton(onClick = { fullQuote = false }) { Text(libraryText("Close", "닫기")) } })
    deleting?.let { id -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text(libraryText("Delete retained history?", "저장된 기록을 삭제할까요?")) },
        text = { Text(libraryText("Closing the panel keeps answers. This explicitly deletes the entry.", "패널을 닫아도 답변은 보존됩니다. 이 작업은 기록을 삭제합니다.")) },
        confirmButton = { TextButton(onClick = { scope.launch { app.history.action(paperKey, id, "delete") }; deleting = null }) { Text(libraryText("Delete", "삭제")) } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text(libraryText("Keep", "유지")) } }) }
}
