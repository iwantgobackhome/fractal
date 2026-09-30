package app.fractal.reader

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.Image
import app.fractal.data.AnnotationEntity
import app.fractal.data.LibraryEntity
import app.fractal.data.WireJson
import app.fractal.design.LocalFractalColors
import app.fractal.ink.InkCanvas
import app.fractal.ink.InkJson
import app.fractal.ink.InkPageState
import app.fractal.ink.InkStroke
import app.fractal.ink.InkToolbar
import app.fractal.ink.InkToolState
import app.fractal.ink.rememberInkToolState
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfTextSelection
import app.fractal.sync.SyncScheduler
import app.fractal.sync.HubClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID
import kotlin.math.roundToInt

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ReaderScreen(app: ReaderApplication, paper: LibraryEntity, onBack: () -> Unit) {
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    val clipboard = remember { app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager }
    val widthClass = LocalConfiguration.current.screenWidthDp
    val compact = widthClass < 600
    val expanded = widthClass >= 840
    val list = rememberLazyListState()
    val translatedList = rememberLazyListState()
    val tool = rememberInkToolState()
    val states = remember(paper.paperKey) { mutableStateMapOf<Int, InkPageState>() }
    val annotations by app.database.annotations().observePaper(paper.paperKey).collectAsState(emptyList())
    var pages by remember(paper.paperKey) { mutableStateOf<PdfPages?>(null) }
    var status by remember(paper.paperKey) { mutableStateOf("") }
    var zoom by remember { mutableStateOf(1f) }
    var panel by remember { mutableStateOf(expanded) }
    var panelTab by remember { mutableStateOf("notes") }
    var barVisible by remember { mutableStateOf(true) }
    var writing by remember { mutableStateOf(false) }
    var viewMenu by remember { mutableStateOf(false) }
    var moreMenu by remember { mutableStateOf(false) }
    var viewMode by remember { mutableStateOf("original") }
    var translatedBlocks by remember(paper.paperKey) { mutableStateOf<List<TranslatedBlock>>(emptyList()) }
    var selected by remember { mutableStateOf<Pair<Int, PdfTextSelection>?>(null) }
    var questionSelection by remember(paper.paperKey) { mutableStateOf<Pair<Int, PdfTextSelection>?>(null) }
    var memo by remember { mutableStateOf("") }
    val activePage = if (viewMode == "translation" && translatedBlocks.isNotEmpty()) {
        translatedBlocks.getOrNull(translatedList.firstVisibleItemIndex)?.page ?: 1
    } else (list.firstVisibleItemIndex + 1).coerceAtMost(pages?.pageCount ?: 1)
    LaunchedEffect(paper.paperKey) {
        translatedBlocks = runCatching {
            val snapshot = app.client.data("/api/papers/${HubClient.keyPath(paper.paperKey)}").jsonObject
            val translations = snapshot["translations"]?.jsonArray.orEmpty().mapNotNull { item ->
                val value = item.jsonObject
                val id = value["blockId"]?.jsonPrimitive?.content ?: return@mapNotNull null
                val text = value["text"]?.jsonPrimitive?.content?.takeUnless { it == "null" }
                if (value["status"]?.jsonPrimitive?.content == "completed" && !text.isNullOrBlank()) id to text else null
            }.toMap()
            if (translations.isEmpty()) emptyList() else snapshot["blocks"]?.jsonArray.orEmpty().mapNotNull { item ->
                val block = item.jsonObject
                val text = translations[block["blockId"]?.jsonPrimitive?.content]
                    ?: block["sourceText"]?.jsonPrimitive?.content
                if (text.isNullOrBlank()) null else TranslatedBlock(
                    page = (block["pageOrdinal"]?.jsonPrimitive?.content?.toIntOrNull() ?: 1).coerceAtLeast(1),
                    kind = block["kind"]?.jsonPrimitive?.content.orEmpty(), text = text,
                )
            }
        }.getOrDefault(emptyList())
    }
    LaunchedEffect(list, translatedList, viewMode) {
        var previous = 0
        snapshotFlow {
            val visibleList = if (viewMode == "translation") translatedList else list
            visibleList.firstVisibleItemIndex * 100000 + visibleList.firstVisibleItemScrollOffset
        }.collectLatest { position ->
            if (!writing && position > previous + 6) barVisible = false
            if (!writing && position < previous - 6) barVisible = true
            previous = position
        }
    }
    LaunchedEffect(paper.paperKey) {
        status = app.getString(R.string.loading_pdf)
        runCatching {
            val local = paper.pdfSha256?.let(app.cache::existing)
            val file = if (local != null) {
                local
            } else {
                val metadata = app.sync.refreshPaperMetadata(paper.paperKey)
                    ?: throw IllegalStateException(app.getString(R.string.pdf_not_on_hub))
                app.downloader.download(paper.paperKey, metadata.first)
            }
            PdfPages(file)
        }.onSuccess {
            pages = it
            status = ""
        }.onFailure { status = app.getString(R.string.offline_unavailable) }
    }
    val openedPages = pages
    DisposableEffect(openedPages) { onDispose { openedPages?.close() } }
    LaunchedEffect(annotations) {
        val grouped = annotations.filter { it.kind == "ink" }.groupBy { it.page }
        for (page in states.keys.toList() + grouped.keys.filterNot { it in states }) {
            val rows = grouped[page].orEmpty()
            val state = states.getOrPut(page) { InkPageState() }
            val strokes = rows.mapNotNull { row ->
                runCatching { InkJson.format.decodeFromString(InkStroke.serializer(), row.json) }.getOrNull()
            }
            if (state.strokes != strokes) state.load(strokes)
        }
    }
    Column(Modifier.fillMaxSize().background(colors.paper)) {
        // Visibility and pen contact must never change the reader's measured viewport.
        Box(Modifier.fillMaxWidth().height(48.5.dp)) {
            if (barVisible) {
                Column {
                    Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = onBack) { Text(stringResource(R.string.back_symbol), fontSize = 24.sp, color = colors.ink) }
                        Text(paper.title ?: paper.paperKey, Modifier.weight(1f), fontFamily = FontFamily.Serif,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.ink)
                        Text(stringResource(R.string.page_count, activePage, pages?.pageCount ?: 0), color = colors.inkSoft, fontSize = 12.sp)
                        Box {
                            TextButton(onClick = { viewMenu = true }) { Text(stringResource(R.string.view), fontSize = 12.sp, color = colors.ink) }
                            DropdownMenu(viewMenu, onDismissRequest = { viewMenu = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.original)) }, onClick = { viewMode = "original"; viewMenu = false })
                                if (translatedBlocks.isNotEmpty()) {
                                    DropdownMenuItem(text = { Text(stringResource(R.string.translation)) }, onClick = { viewMode = "translation"; viewMenu = false })
                                }
                            }
                        }
                        TextButton(onClick = { panelTab = "notes"; panel = true }) { Text(stringResource(R.string.notes), fontSize = 12.sp, color = colors.ink) }
                        TextButton(onClick = { panelTab = "questions"; panel = true }) { Text(stringResource(R.string.questions), fontSize = 12.sp, color = colors.ink) }
                        Box {
                            TextButton(onClick = { moreMenu = true }) { Text(stringResource(R.string.more_symbol), fontSize = 20.sp, color = colors.ink) }
                            DropdownMenu(moreMenu, onDismissRequest = { moreMenu = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.fit_width)) }, onClick = { zoom = 1f; moreMenu = false })
                                DropdownMenuItem(text = { Text(stringResource(if (panel) R.string.close_panel else R.string.open_panel)) },
                                    onClick = { panel = !panel; moreMenu = false })
                            }
                        }
                    }
                    HorizontalDivider(color = colors.rule, thickness = .5.dp)
                }
            } else {
                TextButton(onClick = { barVisible = true }, modifier = Modifier.fillMaxSize()) {
                    Text(stringResource(R.string.show_reader_controls), color = colors.inkSoft)
                }
            }
        }
        Row(Modifier.fillMaxSize()) {
            if (!compact && viewMode == "original") {
                val state = states.getOrPut(activePage) { InkPageState() }
                InkToolbar(state, tool, Modifier.width(48.dp).fillMaxHeight())
            }
            Box(Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize()) {
                if (compact && viewMode == "original") {
                    val state = states.getOrPut(activePage) { InkPageState() }
                    InkToolbar(state, tool)
                }
                val source = pages
                if (viewMode == "translation" && translatedBlocks.isNotEmpty()) {
                    LazyColumn(state = translatedList, modifier = Modifier.fillMaxSize().background(colors.paper)) {
                        items(translatedBlocks) { block ->
                            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 10.dp)) {
                                Text(stringResource(R.string.page_label, block.page), color = colors.inkSoft, fontSize = 11.sp)
                                Text(block.text, fontFamily = FontFamily.Serif,
                                    fontWeight = if (block.kind == "heading") FontWeight.Bold else FontWeight.Normal,
                                    fontSize = if (block.kind == "heading") 19.sp else 16.sp, color = colors.ink)
                            }
                        }
                    }
                } else if (source == null) {
                    Text(status, Modifier.padding(24.dp), color = colors.inkSoft)
                } else {
                    LazyColumn(state = list, modifier = Modifier.fillMaxSize().background(colors.sunken)) {
                        items(source.pageCount) { index ->
                            val state = states.getOrPut(index + 1) { InkPageState() }
                            PdfPage(app, source, paper.paperKey, index, zoom, state, tool,
                                annotations.filter { it.page == index + 1 && it.kind == "highlight" },
                                onFingerGesture = { dy, factor, focusY ->
                                    zoom = (zoom * factor).coerceIn(.5f, 4f)
                                    scope.launch {
                                        if (factor != 1f) androidx.compose.runtime.withFrameNanos { }
                                        list.scrollBy(focusY * (factor - 1f) - dy)
                                    }
                                },
                                onWritingStateChanged = { active ->
                                    writing = active
                                    if (active) barVisible = false
                                },
                                onSelection = { selection -> selected = (index + 1) to selection },
                                onDoubleTap = {
                                    val availableDp = widthClass - (if (compact) 0 else 48) -
                                        (if (expanded && panel) 400 else 0)
                                    val hundredPercent = source.pageWidthPoints(index).toFloat() / availableDp.coerceAtLeast(1)
                                    zoom = if (kotlin.math.abs(zoom - hundredPercent) < .05f) 1f else hundredPercent.coerceIn(.5f, 4f)
                                },
                                onInkChanged = { before, after ->
                                    scope.launch {
                                        val old = before.associateBy { it.id }
                                        val new = after.associateBy { it.id }
                                        for (stroke in after) {
                                            if (old[stroke.id] == stroke) continue
                                            val json = InkJson.format.encodeToString(InkStroke.serializer(), stroke)
                                            app.sync.saveLocal(WireJson.format.parseToJsonElement(json).jsonObject)
                                        }
                                        for (stroke in before.filter { it.id !in new }) {
                                            val tombstone = stroke.copy(deleted = true, updatedAt = Instant.now().toString())
                                            val json = InkJson.format.encodeToString(InkStroke.serializer(), tombstone)
                                            app.sync.saveLocal(WireJson.format.parseToJsonElement(json).jsonObject)
                                        }
                                        SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
                                    }
                                })
                        }
                    }
                }
            }
            if (panel && !compact && !expanded) {
                SidePanel(app, paper.paperKey, annotations, pages, panelTab, { panelTab = it }, onJump = { page ->
                    viewMode = "original"
                    scope.launch { list.animateScrollToItem((page - 1).coerceAtLeast(0)) }
                }, Modifier.align(androidx.compose.ui.Alignment.CenterEnd).width(360.dp).fillMaxHeight(),
                    questionSelection = questionSelection, onClearQuestionSelection = { questionSelection = null })
            }
            }
            if (panel && expanded) {
                SidePanel(app, paper.paperKey, annotations, pages, panelTab, { panelTab = it }, onJump = { page ->
                    viewMode = "original"
                    scope.launch { list.animateScrollToItem((page - 1).coerceAtLeast(0)) }
                }, Modifier.width(400.dp).fillMaxHeight(),
                    questionSelection = questionSelection, onClearQuestionSelection = { questionSelection = null })
            }
        }
    }
    if (panel && compact) {
        ModalBottomSheet(onDismissRequest = { panel = false }) {
            SidePanel(app, paper.paperKey, annotations, pages, panelTab, { panelTab = it }, onJump = { page ->
                panel = false
                viewMode = "original"
                scope.launch { list.animateScrollToItem((page - 1).coerceAtLeast(0)) }
            }, Modifier.fillMaxWidth().height(540.dp),
                questionSelection = questionSelection, onClearQuestionSelection = { questionSelection = null })
        }
    }
    selected?.let { (page, selection) ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { selected = null },
            title = { Text(selection.text.ifBlank { stringResource(R.string.selected_region) }, maxLines = 3) },
            text = {
                Column {
                    if (selection.text.isBlank()) Text(stringResource(R.string.region_selection_hint), color = colors.inkSoft)
                    Row {
                        listOf("yellow", "green", "blue", "pink").forEach { color ->
                            TextButton(onClick = {
                                scope.launch { saveHighlight(app, paper.paperKey, page, selection, color) }
                                selected = null
                            }) { Text(stringResource(R.string.highlight_symbol), color = highlightColor(color), fontSize = 28.sp) }
                        }
                    }
                    OutlinedTextField(memo, { memo = it }, label = { Text(stringResource(R.string.memo)) })
                    Row {
                        TextButton(onClick = {
                            scope.launch { saveMemo(app, paper.paperKey, page, selection, memo) }
                            selected = null
                            memo = ""
                        }) { Text(stringResource(R.string.memo)) }
                        TextButton(onClick = {
                            questionSelection = page to selection
                            selected = null
                            panel = true
                            panelTab = "questions"
                        }) { Text(stringResource(R.string.questions)) }
                        TextButton(enabled = selection.text.isNotBlank(), onClick = {
                            clipboard.setPrimaryClip(android.content.ClipData.newPlainText(app.getString(R.string.clipboard_pdf), selection.text))
                            selected = null
                        }) { Text(stringResource(R.string.copy)) }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch { saveHighlight(app, paper.paperKey, page, selection, "yellow", memo) }
                    selected = null
                    memo = ""
                }) { Text(stringResource(R.string.save)) }
            },
        )
    }
}

private data class TranslatedBlock(val page: Int, val kind: String, val text: String)

private suspend fun saveMemo(
    app: ReaderApplication,
    paperKey: String,
    page: Int,
    selection: PdfTextSelection,
    text: String,
) {
    val rect = selection.rects.firstOrNull()
    val value = buildJsonObject {
        put("id", UUID.randomUUID().toString())
        put("paperKey", paperKey)
        put("updatedAt", Instant.now().toString())
        put("deleted", false)
        put("rev", 0)
        put("deviceId", app.credentials.load()?.deviceId ?: "android")
        put("kind", "memo")
        put("page", page)
        put("text", text)
        put("quote", selection.text)
        val rectJson = rect?.let {
            buildJsonObject {
                put("x", it.x)
                put("y", it.y)
                put("width", it.width)
                put("height", it.height)
            }
        } ?: kotlinx.serialization.json.JsonNull
        put("rect", rectJson)
    }
    app.sync.saveLocal(value)
    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
}

private suspend fun saveHighlight(
    app: ReaderApplication,
    paperKey: String,
    page: Int,
    selection: PdfTextSelection,
    color: String,
    note: String? = null,
) {
    val deviceId = app.credentials.load()?.deviceId ?: "android"
    val rects = selection.rects.map {
        buildJsonObject {
            put("x", it.x)
            put("y", it.y)
            put("width", it.width)
            put("height", it.height)
        }
    }
    val value = buildJsonObject {
        put("id", UUID.randomUUID().toString())
        put("paperKey", paperKey)
        put("updatedAt", Instant.now().toString())
        put("deleted", false)
        put("rev", 0)
        put("deviceId", deviceId)
        put("kind", "highlight")
        put("page", page)
        put("text", selection.text)
        put("color", color)
        put("rects", kotlinx.serialization.json.JsonArray(rects))
        put("note", note)
    }
    app.sync.saveLocal(value)
    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
}

fun highlightColor(name: String) = when (name) {
    "green" -> androidx.compose.ui.graphics.Color(0xFF90CDA2)
    "blue" -> androidx.compose.ui.graphics.Color(0xFF98BEE8)
    "pink" -> androidx.compose.ui.graphics.Color(0xFFE8A6BC)
    else -> androidx.compose.ui.graphics.Color(0xFFE8D46F)
}
