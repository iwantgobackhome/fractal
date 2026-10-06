package app.fractal.reader

import android.graphics.Rect
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onGloballyPositioned
import app.fractal.sync.PaperStructure
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.ink.*
import app.fractal.pdf.*
import app.fractal.sync.SyncScheduler
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.serialization.json.*
import java.time.Instant

private data class ReadingAnchor(val page: Int = 1, val fraction: Double = 0.0, val block: String? = null)
private fun LazyListState.fraction() = (firstVisibleItemScrollOffset.toDouble() /
    (layoutInfo.visibleItemsInfo.firstOrNull { it.index == firstVisibleItemIndex }?.size ?: 1)).coerceIn(0.0, 1.0)
private suspend fun LazyListState.restore(index: Int, fraction: Double): Unit = withContext(Dispatchers.Main.immediate) {
    // A restore can resume after Room I/O; forceRemeasure must stay on Android's UI thread.
    // This also confines test effect interceptors that otherwise resume on the Room worker.
    scrollToItem(index.coerceAtLeast(0))
    if (fraction <= 0.00001) return@withContext
    withFrameNanos { }
    yield() // Apply semantic offset after the native/Compose measurement pass finishes.
    val size = layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }?.size ?: return@withContext
    scrollBy((size * fraction).toFloat())
}
private fun Modifier.readingDriver(onDown: () -> Unit) = composed {
    val current = rememberUpdatedState(onDown)
    pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false); current.value(); waitForUpOrCancellation() } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StableReaderScreen(app: ReaderApplication, paper: LibraryEntity, onBack: () -> Unit) {
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val clipboard = LocalClipboardManager.current
    val sourceList = rememberLazyListState()
    val translationList = rememberLazyListState()
    val tool = rememberInkToolState()
    val states = remember(paper.paperKey) { mutableStateMapOf<Int, InkPageState>() }
    val annotations by app.database.annotations().observePaper(paper.paperKey).collectAsState(emptyList())
    var pages by remember(paper.paperKey) { mutableStateOf<PdfPages?>(null) }
    var status by remember(paper.paperKey) { mutableStateOf(app.getString(R.string.loading_pdf)) }
    var sourcePageContext by remember(paper.paperKey) { mutableStateOf<Map<Int, String>>(emptyMap()) }
    var blocks by remember(paper.paperKey) { mutableStateOf<List<TranslatedBlock>>(emptyList()) }
    var mode by remember(paper.paperKey) { mutableStateOf("original") }
    var driver by remember { mutableStateOf("original") }
    var sourceAnchor by remember(paper.paperKey) { mutableStateOf(ReadingAnchor()) }
    var translatedAnchor by remember(paper.paperKey) { mutableStateOf(ReadingAnchor()) }
    var translationGapPage by remember(paper.paperKey) { mutableStateOf<Int?>(null) }
    var restored by remember(paper.paperKey) { mutableStateOf(false) }
    var resizing by remember { mutableStateOf(false) }
    var lastPaneWidth by remember(paper.paperKey) { mutableStateOf(0.dp) }
    var zoom by remember(paper.paperKey) { mutableStateOf(1f) }
    var writing by remember { mutableStateOf(false) }
    var barVisible by remember { mutableStateOf(true) }
    var panel by remember(paper.paperKey) { mutableStateOf(false) }
    var panelTab by remember { mutableStateOf("notes") }
    var selection by remember(paper.paperKey) { mutableStateOf<Pair<Int, PdfTextSelection>?>(null) }
    var questionThreadId by remember(paper.paperKey) { mutableStateOf(java.util.UUID.randomUUID().toString()) }
    var quote by remember(paper.paperKey) { mutableStateOf<Pair<Int, PdfTextSelection>?>(null) }
    var selectionMessage by remember { mutableStateOf("") }
    var regionMode by remember { mutableStateOf(false) }
    var viewport by remember { mutableStateOf<Rect?>(null) }
    var noteSelection by remember { mutableStateOf<Pair<Int, PdfTextSelection>?>(null) }
    var toolsMenu by remember { mutableStateOf(false) }
    var structure by remember(paper.paperKey) { mutableStateOf<PaperStructure?>(null) }
    val answerTargets = remember(paper.paperKey) { mutableStateMapOf<String, ReaderAnswerTarget>() }
    val answerRequests by app.database.reader().observeRequests(paper.paperKey).collectAsState(emptyList())
    val answerHistory by app.database.metadata().observeHistory(paper.paperKey).collectAsState(emptyList())
    val answerPins = remember(answerRequests, answerHistory) { readerAnswerPins(answerRequests, answerHistory) }
    fun openAnswer(selected: Pair<Int, PdfTextSelection>?, explain: Boolean = false, requestId: String? = null) {
        val thread = requestId?.let { id -> answerPins.firstOrNull { it.requestId == id }?.key } ?: java.util.UUID.randomUUID().toString()
        answerTargets[thread] = ReaderAnswerTarget(selected ?: (sourceAnchor.page to PdfTextSelection("", listOf(PdfRect(.02f, .2f, .01f, .01f)))), explain = explain, requestId = requestId, threadId = thread)
        panel = false
    }
    var fullTitle by remember { mutableStateOf(false) }
    LaunchedEffect(paper.paperKey) {
        app.database.metadata().snapshot(paper.paperKey)?.let {
            val snapshot = WireJson.format.parseToJsonElement(it.json).jsonObject
            blocks = translatedBlocks(snapshot); sourcePageContext = structurePageContext(snapshot)
        }
        runCatching { app.sync.refreshPaperMetadata(paper.paperKey) }.onSuccess {
            app.database.metadata().snapshot(paper.paperKey)?.let { cached ->
                val snapshot = WireJson.format.parseToJsonElement(cached.json).jsonObject
                blocks = translatedBlocks(snapshot); sourcePageContext = structurePageContext(snapshot)
            }
        }
    }
    LaunchedEffect(paper.paperKey) {
        try {
            val file = paper.pdfSha256?.let { app.cache.verified(it) } ?: run {
                val metadata = app.sync.refreshPaperMetadata(paper.paperKey) ?: error("PDF unavailable")
                app.downloader.download(paper.paperKey, metadata.first)
            }
            pages = withContext(Dispatchers.IO) { PdfPages(file) }
            status = ""
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { status = app.getString(R.string.offline_unavailable) }
    }
    LaunchedEffect(paper.paperKey, pages) {
        val source = pages ?: return@LaunchedEffect
        try { app.structure.load(paper.paperKey, source.pdfSha256) { structure = it } }
        catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { /* Retained structure remains available offline. */ }
    }
    val opened = pages
    DisposableEffect(opened) { onDispose { opened?.close() } }
    LaunchedEffect(opened) {
        val source = opened ?: return@LaunchedEffect
        val saved = app.database.reader().position(paper.paperKey)?.let { runCatching { WireJson.format.parseToJsonElement(it.json).jsonObject }.getOrNull() }
        val prior = paper.readProgressJson?.let { runCatching { WireJson.format.decodeFromString<ReadProgress>(it) }.getOrNull() }
        fun number(name: String) = saved?.get(name)?.jsonPrimitive?.content?.toDoubleOrNull()
        sourceAnchor = ReadingAnchor((number("page")?.toInt() ?: prior?.page ?: 1).coerceIn(1, source.pageCount), number("fraction") ?: prior?.scrollOffset ?: 0.0)
        translatedAnchor = ReadingAnchor(number("translatedPage")?.toInt() ?: sourceAnchor.page, number("translatedFraction") ?: 0.0,
            saved?.get("block")?.jsonPrimitive?.contentOrNull)
        mode = saved?.get("mode")?.jsonPrimitive?.contentOrNull?.takeIf { it in listOf("original", "translation", "split") } ?: "original"
        sourceList.restore(sourceAnchor.page - 1, sourceAnchor.fraction)
        restored = true
        app.metadata.read(paper.paperKey, sourceAnchor.page, sourceAnchor.fraction)
        SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
    }
    LaunchedEffect(restored, blocks) {
        if (!restored || blocks.isEmpty()) return@LaunchedEffect
        if (blocks.none { it.page == translatedAnchor.page }) {
            translationGapPage = translatedAnchor.page
            return@LaunchedEffect
        }
        translationGapPage = null
        val index = blocks.indexOfFirst { it.blockId == translatedAnchor.block }.takeIf { it >= 0 }
            ?: blocks.indexOfFirst { it.page == translatedAnchor.page }.coerceAtLeast(0)
        translationList.restore(index, translatedAnchor.fraction)
    }
    LaunchedEffect(annotations) {
        val grouped = annotations.filter { it.kind == "ink" }.groupBy { it.page }
        for (page in states.keys.toList() + grouped.keys.filterNot { it in states }) {
            val state = states.getOrPut(page) { InkPageState() }
            val strokes = grouped[page].orEmpty().mapNotNull { runCatching { InkJson.format.decodeFromString(InkStroke.serializer(), it.json) }.getOrNull() }
            if (state.strokes != strokes) state.load(strokes)
        }
    }
    fun savePosition() { scope.launch {
        if (!restored) return@launch
        app.database.reader().upsert(ReaderPositionEntity(paper.paperKey, buildJsonObject {
            put("mode", mode); put("page", sourceAnchor.page); put("fraction", sourceAnchor.fraction)
            put("translatedPage", translatedAnchor.page); put("translatedFraction", translatedAnchor.fraction); put("block", translatedAnchor.block)
        }.toString()))
    } }
    fun jump(page: Int) { val count = pages?.pageCount ?: return; mode = "original"; driver = "original"
        scope.launch { sourceList.scrollToItem((page - 1).coerceIn(0, count - 1)) } }
    fun sourceToTranslation(anchor: ReadingAnchor) {
        val indices = blocks.indices.filter { blocks[it].page == anchor.page }
        if (indices.isEmpty()) {
            translationGapPage = anchor.page
            translatedAnchor = anchor.copy(block = null)
            return
        }
        translationGapPage = null
        val scaled = anchor.fraction * indices.size
        val ordinal = scaled.toInt().coerceIn(0, indices.lastIndex)
        scope.launch { translationList.restore(indices[ordinal], (scaled - ordinal).coerceIn(0.0, 1.0)) }
    }
    fun translationToSource(anchor: ReadingAnchor) {
        val indices = blocks.filter { it.page == anchor.page }
        if (indices.isEmpty()) { scope.launch { sourceList.restore(anchor.page - 1, anchor.fraction) }; return }
        val ordinal = indices.indexOfFirst { it.blockId == anchor.block }.coerceAtLeast(0)
        scope.launch { sourceList.restore(anchor.page - 1, (ordinal + anchor.fraction) / indices.size.coerceAtLeast(1)) }
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(colors.paper)) {
        val availableHeight = maxHeight
        val compact = maxWidth < 600.dp
        val split = maxWidth >= 840.dp && mode == "split" && blocks.isNotEmpty()
        val translationOnly = mode == "translation" || (mode == "split" && !split && driver == "translation")
        val sourceVisible = !translationOnly || split
        val activePage = if (translationOnly) translatedAnchor.page else sourceAnchor.page
        val paneWidth = (maxWidth - if (compact) 0.dp else 48.dp) / if (split) 2 else 1
        val panelWidth = minOf(420.dp, (maxWidth - 48.dp) * .48f)
        LaunchedEffect(restored, paneWidth, sourceVisible) {
            if (!restored || !sourceVisible) return@LaunchedEffect
            if (lastPaneWidth != 0.dp && lastPaneWidth != paneWidth) {
                val sourceBefore = sourceAnchor; val translatedBefore = translatedAnchor
                resizing = true
                sourceList.restore(sourceBefore.page - 1, sourceBefore.fraction)
                val index = blocks.indexOfFirst { it.blockId == translatedBefore.block }
                if (index >= 0) translationList.restore(index, translatedBefore.fraction)
                resizing = false
            }
            lastPaneWidth = paneWidth
        }
        LaunchedEffect(restored, split, sourceVisible, resizing) {
            if (!restored) return@LaunchedEffect
            snapshotFlow { sourceList.firstVisibleItemIndex to sourceList.firstVisibleItemScrollOffset }.collectLatest {
                if (!sourceVisible || resizing) return@collectLatest
                sourceAnchor = ReadingAnchor(sourceList.firstVisibleItemIndex + 1, sourceList.fraction())
                if (split && driver == "original" && sourceList.isScrollInProgress) sourceToTranslation(sourceAnchor)
                delay(500); savePosition()
                if (driver == "original") app.metadata.read(paper.paperKey, sourceAnchor.page, sourceAnchor.fraction)
            }
        }
        LaunchedEffect(restored, blocks, split, resizing) {
            if (!restored || blocks.isEmpty()) return@LaunchedEffect
            snapshotFlow { translationList.firstVisibleItemIndex to translationList.firstVisibleItemScrollOffset }.collectLatest {
                val block = blocks.getOrNull(translationList.firstVisibleItemIndex) ?: return@collectLatest
                if (resizing || translationGapPage != null) return@collectLatest
                translatedAnchor = ReadingAnchor(block.page, translationList.fraction(), block.blockId)
                if (split && driver == "translation" && translationList.isScrollInProgress) translationToSource(translatedAnchor)
                delay(500); savePosition()
                if (driver == "translation") app.metadata.read(paper.paperKey, block.page, translatedAnchor.fraction, block.blockId)
            }
        }
        // Reserve the same header/tool extent through writing, selection and panel changes.
        val headerRow = (48 * density.fontScale.coerceIn(1f, 2f)).dp
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(headerRow * 2)) {
                if (barVisible) Column {
                    Row(Modifier.fillMaxWidth().height(headerRow), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { savePosition(); onBack() }) { Text("‹", style = MaterialTheme.typography.headlineSmall) }
                        Text(paper.title ?: paper.paperKey, Modifier.weight(1f).heightIn(min = 48.dp).wrapContentHeight(Alignment.CenterVertically).clickable { fullTitle = true }, style = MaterialTheme.typography.titleMedium.copy(fontFamily = ScholarlySerif), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        TextButton(onClick = { panelTab = "notes"; panel = true }) { Text(libraryText("Notes", "노트")) }
                        TextButton(onClick = { openAnswer(selection) }) { Text(libraryText("Ask", "질문")) }
                    }
                    Row(Modifier.fillMaxWidth().height(headerRow).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        val modes = listOf("original" to libraryText("Original", "원문"), "translation" to libraryText("Translation", "번역"), "split" to libraryText("Split", "나란히")).filter { it.first == "original" || blocks.isNotEmpty() }
                        ResearchSelector(libraryText("Reading pane", "읽기 화면"), mode, modes, { id ->
                                if (id in listOf("translation", "split") && !translationOnly) sourceToTranslation(sourceAnchor)
                                if (id == "original" && translationOnly) translationToSource(translatedAnchor)
                                mode = id; driver = if (id == "translation") "translation" else "original"; selection = null
                            }, Modifier.weight(1f), showLabel = false)
                        Text("$activePage / ${pages?.pageCount ?: 0}", Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall)
                        Box { TextButton(onClick = { toolsMenu = true }, modifier = Modifier.testTag("reader-tools")) { Text(libraryText("Tools ▾", "도구 ▾")) }
                            DropdownMenu(toolsMenu, { toolsMenu = false }) {
                                DropdownMenuItem(text = { Text(libraryText("Deliberately select a region", "직접 영역 선택")) }, enabled = sourceVisible, onClick = { regionMode = !regionMode; toolsMenu = false })
                                DropdownMenuItem(text = { Text(libraryText("Fit original page width", "원문 너비 맞춤")) }, enabled = sourceVisible, onClick = { zoom = 1f; toolsMenu = false })
                                DropdownMenuItem(text = { Text(libraryText("Add source note", "원문 노트 추가")) }, enabled = sourceVisible, onClick = { noteSelection = activePage to PdfTextSelection("", listOf(PdfRect(.08f, .15f, .02f, .02f)), provenance = "deliberate-region", pdfSha256 = pages?.pdfSha256); toolsMenu = false })
                                DropdownMenuItem(modifier = Modifier.testTag("reader-history-open"), text = { Text(libraryText("Retained history", "저장된 기록")) }, onClick = { panelTab = "history"; panel = true; toolsMenu = false })
                            }
                        }
                    }
                } else TextButton(onClick = { barVisible = true }, modifier = Modifier.fillMaxSize()) { Text(libraryText("Show reader controls", "읽기 도구 표시")) }
            }
            HorizontalDivider(color = colors.rule, thickness = .5.dp)
            if (compact) Box(Modifier.fillMaxWidth().height(48.dp)) {
                if (sourceVisible) InkToolbar(states.getOrPut(activePage) { InkPageState() }, tool, onToolSelected = { regionMode = false }, regionMode = regionMode, onRegionToggle = { regionMode = !regionMode })
            }
            Row(Modifier.weight(1f)) {
                if (!compact) Box(Modifier.width(48.dp).fillMaxHeight()) {
                    if (sourceVisible) InkToolbar(states.getOrPut(activePage) { InkPageState() }, tool, Modifier.fillMaxSize(), onToolSelected = { regionMode = false }, regionMode = regionMode, onRegionToggle = { regionMode = !regionMode })
                }
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    Row(Modifier.fillMaxSize()) {
                        if (sourceVisible) {
                            val source = pages
                            if (source == null) Text(status, Modifier.weight(1f).padding(24.dp)) else LazyColumn(state = sourceList,
                                modifier = Modifier.weight(1f).fillMaxHeight().testTag("reader-source-pages").background(colors.sunken).readingDriver { driver = "original" }.readerViewport { viewport = it }) {
                                items(source.pageCount, key = { it }) { index ->
                                    val state = states.getOrPut(index + 1) { InkPageState() }
                                    PdfPage(app, source, paper.paperKey, index, zoom, state, tool,
                                        annotations.filter { it.page == index + 1 && it.kind == "highlight" },
                                        nativeViewport = viewport, selection = selection?.takeIf { it.first == index + 1 }?.second, regionMode = regionMode,
                                        onSelectionUnavailable = { selectionMessage = it },
                                        onBackgroundTap = { selection = null; selectionMessage = "" },
                                        onFingerGesture = { dy, factor, focusY ->
                                            zoom = (zoom * factor).coerceIn(.5f, 4f)
                                            scope.launch { if (factor != 1f) { withFrameNanos { }; yield() }; sourceList.scrollBy(focusY * (factor - 1f) - dy) }
                                        }, onWritingStateChanged = { writing = it; if (it && !regionMode) barVisible = false },
                                        onSelection = { selection = index + 1 to it; selectionMessage = "" },
                                        onDoubleTap = { zoom = if (zoom == 1f) 1.5f else 1f },
                                        onInkChanged = { before, after -> scope.launch {
                                            val old = before.associateBy { it.id }; val new = after.associateBy { it.id }
                                            for (stroke in after) if (old[stroke.id] != stroke) app.sync.saveLocal(WireJson.format.parseToJsonElement(InkJson.format.encodeToString(InkStroke.serializer(), stroke)).jsonObject)
                                            for (stroke in before.filter { it.id !in new }) app.sync.saveLocal(WireJson.format.parseToJsonElement(InkJson.format.encodeToString(InkStroke.serializer(), stroke.copy(deleted = true, updatedAt = Instant.now().toString()))).jsonObject)
                                            SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
                                        } }, contentOverlay = { width, height, textPage ->
                                            ReaderStructureOverlay(structure?.items.orEmpty().filter { it.page == index + 1 }, width, height) { item, _ ->
                                                val thread = java.util.UUID.randomUUID().toString()
                                                answerTargets[thread] = ReaderAnswerTarget(structureSelection(item, source.pdfSha256), item,
                                                    textPage?.text ?: sourcePageContext[index + 1].orEmpty(), explain = true, threadId = thread)
                                                panel = false
                                            }
                                            ReaderPageAnswers(app, paper.paperKey, source, index + 1, width, height, textPage?.rotation ?: 0,
                                                answerTargets, answerPins, answerHistory, answerRequests, textPage, ::jump)
                                            StickyNotes(app, annotations.filter { it.kind == "memo" && it.page == index + 1 }, width, height, textPage, source.pdfSha256)
                                        })
                                }
                            }
                        }
                        if (split) VerticalDivider(color = colors.rule)
                        if ((translationOnly || split) && translationGapPage != null) Column(Modifier.weight(1f).fillMaxHeight().padding(24.dp)) {
                            Text(libraryText("No translated content is cached for page $translationGapPage.", "$translationGapPage 쪽의 번역 내용이 캐시되지 않았습니다."), style = MaterialTheme.typography.bodyLarge)
                            TextButton(onClick = { translationToSource(translatedAnchor); mode = "original"; driver = "original" }) { Text(libraryText("Read original page", "원문 페이지 읽기")) }
                        } else if (translationOnly || split) LazyColumn(state = translationList, modifier = Modifier.weight(1f).fillMaxHeight().readingDriver { driver = "translation" }) {
                            itemsIndexed(blocks, key = { _, block -> block.blockId }) { index, block ->
                                Column {
                                    if (index == 0 || blocks[index - 1].page != block.page) {
                                        HorizontalDivider(color = colors.rule)
                                        Text(libraryText("Page ${block.page}", "${block.page}쪽"), Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                                            style = MaterialTheme.typography.labelMedium, color = colors.inkSoft)
                                    }
                                    if (block.isSourceCrop) TranslatedSourceBlock(block, pages)
                                    else TranslatedReaderBlock(block) { text ->
                                        quote = block.page to PdfTextSelection(text, emptyList(), origin = if (block.translated) "translated" else "original", blockId = block.blockId, provenance = if (block.translated) "translated-copy" else "source-block-copy")
                                        panel = true; panelTab = "questions"
                                    }
                                }
                            }
                        }
                    }
                    if (selectionMessage.isNotBlank()) Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth().nativeInkBlocker(), color = colors.paper) {
                        Column(Modifier.padding(12.dp)) { Text(selectionMessage, style = MaterialTheme.typography.bodySmall)
                            Row { TextButton(onClick = { regionMode = true; selectionMessage = "" }) { Text(libraryText("Select a region", "영역 선택")) }
                                TextButton(onClick = { selectionMessage = "" }) { Text(libraryText("Dismiss", "닫기")) } }
                        }
                    }
                    selection?.let { selected ->
                        Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth().nativeInkBlocker(), color = colors.paper, tonalElevation = 2.dp) {
                            Column { if (selected.second.provenance == "cached-original-approximate") Text(libraryText("Original text · approximate highlight", "원문 텍스트 · 대략적인 강조 영역"), Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall)
                                Text(if (selected.second.text.isBlank()) libraryText("Deliberately selected original region", "직접 선택한 원문 영역") else selected.second.text,
                                Modifier.padding(horizontal = 12.dp, vertical = 4.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                                Row(Modifier.horizontalScroll(rememberScrollState())) {
                                    TextButton(enabled = selected.second.text.isNotBlank(), onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(selected.second.text)) }) { Text(libraryText("Copy", "복사")) }
                                    TextButton(onClick = { openAnswer(selected, explain = selected.second.origin == "original"); selection = null }) { Text(libraryText(if (selected.second.origin == "original") "Explain" else "Attach quote", if (selected.second.origin == "original") "설명" else "인용 첨부")) }
                                    TextButton(onClick = { openAnswer(selected); selection = null }) { Text(libraryText("Ask", "질문")) }
                                    TextButton(onClick = { scope.launch { saveHighlight(app, paper.paperKey, selected.first, selected.second, "yellow") }; selection = null }) { Text(libraryText("Highlight", "강조")) }
                                    TextButton(onClick = { noteSelection = selected; selection = null }) { Text(libraryText("Note", "노트")) }
                                    TextButton(onClick = { selection = null }) { Text(libraryText("Clear", "해제")) }
                                }
                            }
                        }
                    }
                    if (panel && !compact) SidePanel(app, paper.paperKey, annotations, pages, panelTab, { panelTab = it }, ::jump,
                        Modifier.align(Alignment.CenterEnd).width(panelWidth).fillMaxHeight(), quote, { quote = null }, onClose = { panel = false }, threadId = questionThreadId, onThreadChange = { questionThreadId = it })
                }
            }
        }

        if (panel && compact) ModalBottomSheet(onDismissRequest = { panel = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            SidePanel(app, paper.paperKey, annotations, pages, panelTab, { panelTab = it }, ::jump,
                Modifier.fillMaxWidth().height(availableHeight * .85f), quote, { quote = null }, onClose = { panel = false }, threadId = questionThreadId, onThreadChange = { questionThreadId = it })
        }
    }
    noteSelection?.let { (page, selected) -> NoteEditor(null, selected.text, onDismiss = { noteSelection = null }) { text, color ->
        scope.launch { saveMemo(app, paper.paperKey, page, selected, text, color) }; noteSelection = null
    } }
    if (fullTitle) AlertDialog(onDismissRequest = { fullTitle = false }, title = { Text(libraryText("Paper details", "논문 정보")) },
        text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) { Text(paper.title ?: paper.paperKey, style = MaterialTheme.typography.titleLarge); Text(paper.authors); Text(listOfNotNull(paper.venue, paper.year?.toString()).joinToString(" · ")); Text(paper.paperKey, style = MaterialTheme.typography.bodySmall) } },
        confirmButton = { TextButton(onClick = { fullTitle = false }) { Text(libraryText("Close", "닫기")) } })
}

@Composable
private fun TranslatedReaderBlock(block: TranslatedBlock, onQuote: (String) -> Unit) {
    val colors = LocalFractalColors.current
    val clipboard = LocalClipboardManager.current
    val toolbar = LocalTextToolbar.current
    var copied by remember(block.blockId, block.text) { mutableStateOf<String?>(null) }
    val wrapped = remember(toolbar, clipboard, block.blockId, block.text) { object : TextToolbar {
        override val status get() = toolbar.status
        override fun hide() = toolbar.hide()
        override fun showMenu(rect: androidx.compose.ui.geometry.Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
            toolbar.showMenu(rect, onCopyRequested?.let { copy -> { copy(); copied = clipboard.getText()?.text } }, onPasteRequested, onCutRequested, onSelectAllRequested)
        }
    } }
    val quoteLabel = if (block.translated) libraryText("Quote this translated block", "번역 블록 인용") else libraryText("Quote original passage", "원문 내용 인용")
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp).semantics {
        customActions = listOf(androidx.compose.ui.semantics.CustomAccessibilityAction(quoteLabel) { onQuote(block.text); true })
    }) {
        CompositionLocalProvider(LocalTextToolbar provides wrapped) { SelectionContainer {
            Text(block.text, style = if (block.kind == "heading") MaterialTheme.typography.titleLarge else if (block.kind == "caption") MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge, color = colors.ink)
        } }
        if (copied != null) TextButton(onClick = { onQuote(copied!!) }) { Text(libraryText("Quote copied excerpt", "복사한 부분 인용")) }
    }
}
