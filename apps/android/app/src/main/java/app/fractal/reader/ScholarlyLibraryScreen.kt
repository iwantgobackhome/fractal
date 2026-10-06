package app.fractal.reader

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.sync.SyncScheduler
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
internal fun libraryText(en: String, ko: String): String = if (LocalConfiguration.current.locales[0].language == "ko") ko else en

internal fun folderDescendants(id: String, folders: List<FolderEntity>): Set<String> {
    val result = mutableSetOf(id)
    var changed: Boolean
    do { changed = false; folders.filter { !it.deleted && it.parentId in result }.forEach { if (result.add(it.id)) changed = true } } while (changed)
    return result
}

private fun LibraryEntity.record() = WireJson.format.decodeFromString<LibraryRecord>(json)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ScholarlyLibraryScreen(app: ReaderApplication, onSettings: () -> Unit, onRead: (String) -> Unit,
    embedded: Boolean = false, onRelated: ((LibraryEntity) -> Unit)? = null) {
    val colors = LocalFractalColors.current
    val railWidth = 78.dp * LocalConfiguration.current.fontScale.coerceAtLeast(1f)
    val scope = rememberCoroutineScope()
    val papers by app.database.library().observeAll().collectAsState(emptyList())
    val allFolders by app.database.metadata().observeFolders().collectAsState(emptyList())
    val pendingCount by app.database.metadata().observePendingCount().collectAsState(0)
    val conflicts by app.database.metadata().observeConflicts().collectAsState(emptyList())
    val folders = allFolders.filterNot { it.deleted }
    var destination by rememberSaveable { mutableStateOf("saved") }
    var selectedKey by rememberSaveable { mutableStateOf<String?>(null) }
    var folderId by rememberSaveable { mutableStateOf<String?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("newest") }
    var offline by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var syncing by remember { mutableStateOf(false) }
    var showSearch by remember { mutableStateOf(false) }
    var showConflicts by remember { mutableStateOf(false) }
    var showFolders by remember { mutableStateOf(false) }
    var import by remember { mutableStateOf(false) }
    var newFolder by remember { mutableStateOf(false) }
    var editFolder by remember { mutableStateOf<FolderEntity?>(null) }
    var deleteFolder by remember { mutableStateOf<FolderEntity?>(null) }
    var editPaper by remember { mutableStateOf<LibraryEntity?>(null) }
    val labels = listOf("saved" to libraryText("Saved", "저장"), "recent" to libraryText("Recent", "최근 읽음"), "folders" to libraryText("Folders", "폴더"))
    fun mutate(action: suspend () -> Unit) { scope.launch {
        runCatching { action() }.onSuccess { SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false)) }
            .onFailure { error = it.message.orEmpty() }
    } }
    fun refresh() { scope.launch {
        syncing = true
        runCatching {
            app.sync.syncOnce()
            // Drain dependent edits after creation/CAS rebases, without an unbounded retry loop.
            repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
            app.sync.resolveMissingPdfs()
        }.onSuccess { error = "" }.onFailure { error = it.message.orEmpty() }
        syncing = false
    } }
    LaunchedEffect(Unit) { if (app.credentials.load() != null) refresh() }
    val descendants = folderId?.let { folderDescendants(it, folders) }
    val visible = papers.filter { paper ->
        val record = paper.record()
        (destination == "saved" && paper.saved || destination == "recent" && paper.lastReadAt != null ||
            destination == "folders" && (descendants == null || record.collections.any { it in descendants })) &&
            (!offline || paper.pdfSha256?.let(app.cache::contains) == true) &&
            listOf(paper.title.orEmpty(), paper.authors, record.tags.joinToString(" "), paper.venue.orEmpty()).any { it.contains(search, true) }
    }.let { rows -> when {
        destination == "recent" -> rows.sortedByDescending { it.lastReadAt }
        sort == "title" -> rows.sortedBy { it.title.orEmpty().lowercase() }
        else -> rows.sortedByDescending { it.savedAt ?: it.addedAt }
    } }
    val selected = papers.firstOrNull { it.paperKey == selectedKey }
    BoxWithConstraints(Modifier.fillMaxSize().background(colors.paper)) {
        val short = maxHeight < 480.dp
        val phone = maxWidth < 600.dp
        val detail = maxWidth >= 840.dp
        val stackedHeader = phone && LocalConfiguration.current.fontScale >= 1.5f
        Column(Modifier.fillMaxSize()) {
            Column {
            Row(Modifier.fillMaxWidth().padding(horizontal = if (phone) 16.dp else 24.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.branch_mark), contentDescription = "News Papers", Modifier.size(32.dp),
                    colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(colors.ink))
                Spacer(Modifier.width(10.dp))
                Text(libraryText("Research library", "연구 서재"), Modifier.weight(1f), fontFamily = ScholarlySerif,
                    fontSize = if (phone) 28.sp else 30.sp, lineHeight = 34.sp, color = colors.ink)
                if (!stackedHeader) TextButton(onClick = onSettings) { Text(libraryText("Settings", "설정")) }
            }
            if (stackedHeader) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onSettings) { Text(libraryText("Settings", "설정")) }
            }
            }
            HorizontalDivider(color = colors.rule, thickness = .5.dp)
            Row(Modifier.weight(1f)) {
                if (!phone && !embedded) Column(Modifier.width(railWidth).fillMaxHeight().border(.5.dp, colors.rule)) {
                    labels.forEach { (key, label) -> TextButton(onClick = { destination = key; if (key == "folders") showFolders = true },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp).semantics { this.selected = destination == key }) {
                        Text(label, color = if (destination == key) colors.accent else colors.inkSoft)
                    } }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    LazyColumn(Modifier.weight(1f)) {
                    item {
                    if (embedded) ResearchSelector(libraryText("Library view", "서재 보기"), destination, labels, {
                        destination = it; if (it == "folders") showFolders = true
                    }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), showLabel = false)
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(labels.first { it.first == destination }.second, Modifier.weight(1f), fontFamily = ScholarlySerif, fontSize = 24.sp, color = colors.ink)
                        if (short) TextButton(onClick = { showSearch = true }) { Text(libraryText("Search", "검색")) }
                        TextButton(onClick = { import = true }) { Text(libraryText("Import", "가져오기")) }
                        TextButton(enabled = !syncing, onClick = ::refresh) { Text(if (syncing) libraryText("Syncing…", "동기화 중…") else libraryText("Sync", "동기화")) }
                    }
                    if (!short) OutlinedTextField(search, { search = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        label = { Text(libraryText("Search titles, authors and tags", "제목·저자·태그 검색")) }, singleLine = true)
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { showFolders = true }, modifier = Modifier.weight(1f)) {
                            Text(folders.firstOrNull { it.id == folderId }?.name ?: libraryText("All folders", "모든 폴더"))
                        }
                        TextButton(onClick = { offline = !offline }, modifier = Modifier.semantics { this.selected = offline }) {
                            Text(libraryText("Offline", "오프라인"), color = if (offline) colors.accent else colors.inkSoft)
                        }
                        TextButton(onClick = { sort = if (sort == "newest") "title" else "newest" }) {
                            Text(if (sort == "title") libraryText("A–Z", "제목순") else libraryText("Newest", "최신순"))
                        }
                    }
                    if (error.isNotBlank()) Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        Text(libraryText("Hub unavailable. Cached papers and local edits remain available.", "허브에 연결할 수 없습니다. 캐시된 논문과 로컬 변경은 유지됩니다."), color = colors.inkSoft, fontSize = 13.sp)
                        Text(error, color = colors.inkSoft, fontSize = 12.sp, maxLines = 3)
                        TextButton(onClick = ::refresh) { Text(libraryText("Retry", "다시 시도")) }
                    }
                    if (conflicts.isNotEmpty()) Column(Modifier.padding(horizontal = 16.dp)) {
                        Text(libraryText("A folder was deleted elsewhere. Earlier folder edits are retained locally for review.", "다른 기기에서 폴더가 삭제되었습니다. 이전 폴더 편집은 검토를 위해 로컬에 보관됩니다."), color = colors.inkSoft, fontSize = 13.sp)
                        TextButton(onClick = { showConflicts = true }) { Text(libraryText("Review retained edits", "보관된 편집 검토")) }
                    }
                    Text("${visible.size} " + libraryText("papers", "편") + if (pendingCount > 0) " · $pendingCount " + libraryText("changes pending sync", "개 변경 동기화 대기") else "",
                        Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = colors.inkSoft, fontSize = 12.sp)
                    HorizontalDivider(color = colors.ink, thickness = 2.dp, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                        if (visible.isEmpty()) item { Column(Modifier.padding(24.dp)) {
                            Text(libraryText("No papers in this view", "이 보기에는 논문이 없습니다"), fontFamily = ScholarlySerif, fontSize = 22.sp, color = colors.ink)
                            Text(libraryText("Import a paper or change the filters. Saving and reading are recorded separately.", "논문을 가져오거나 필터를 변경하세요. 저장과 읽음은 별도로 기록됩니다."), color = colors.inkSoft)
                        } }
                        items(visible, key = { it.paperKey }) { paper ->
                            val record = paper.record()
                            Column(Modifier.fillMaxWidth().semantics { this.selected = selectedKey == paper.paperKey }
                                .clickable { selectedKey = paper.paperKey }.padding(horizontal = 16.dp, vertical = 16.dp)) {
                                Text(listOfNotNull(paper.venue, paper.year?.toString()).joinToString(" · ").ifBlank { libraryText("Research paper", "연구 논문") }, color = colors.inkSoft, fontSize = 12.sp)
                                Text(paper.title ?: paper.paperKey, fontFamily = ScholarlySerif, fontSize = if (phone) 21.sp else 20.sp,
                                    lineHeight = 27.sp, color = colors.ink)
                                Text(paper.authors, color = colors.inkSoft, fontSize = 13.sp, lineHeight = 20.sp)
                                if (!record.abstract.isNullOrBlank()) Text(record.abstract.orEmpty(), maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                    color = colors.inkSoft, fontSize = 13.sp, lineHeight = 20.sp)
                                if (record.tags.isNotEmpty()) Text(record.tags.joinToString(" · "), color = colors.inkSoft, fontSize = 12.sp)
                                Text(when {
                                    paper.lastReadAt != null -> libraryText("Read ", "읽음 ") + paper.lastReadAt.orEmpty().take(10)
                                    else -> libraryText("Not read yet", "아직 읽지 않음")
                                } + if (paper.pdfSha256?.let(app.cache::contains) == true) libraryText(" · Cached", " · 캐시됨") else "", color = colors.inkSoft, fontSize = 12.sp)
                                FlowRow(Modifier.fillMaxWidth()) {
                                    TextButton(onClick = { if (paper.pdfSha256 == null && onRelated != null) onRelated(paper) else onRead(paper.paperKey) }) {
                                        Text(if (paper.pdfSha256 == null && onRelated != null) libraryText("Metadata / PDF", "논문 정보·PDF") else libraryText("Read", "읽기"))
                                    }
                                    TextButton(onClick = { mutate { app.metadata.save(paper.paperKey, !paper.saved) } }) { Text(if (paper.saved) libraryText("Saved ✓", "저장됨 ✓") else libraryText("Save", "저장")) }
                                    TextButton(onClick = { editPaper = paper }) { Text(libraryText("Organize", "정리")) }
                                    if (onRelated != null) TextButton(onClick = { onRelated(paper) }) { Text(libraryText("Related", "관련")) }
                                }
                            }
                            HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.rule, thickness = .5.dp)
                        }
                    }
                }
                if (detail) Column(Modifier.width(292.dp).fillMaxHeight().border(.5.dp, colors.rule).verticalScroll(rememberScrollState()).padding(20.dp)) {
                    if (selected == null) {
                        Text(libraryText("Paper details", "논문 정보"), fontFamily = ScholarlySerif, fontSize = 22.sp)
                        Text(libraryText("Select a title in the research index.", "연구 목록에서 제목을 선택하세요."), color = colors.inkSoft)
                    } else PaperDetails(app, selected, { scope.launch {
                    // A paper synced from the PC may have a PDF the phone has not learned about yet.
                    val readable = selected.pdfSha256 != null || runCatching { app.sync.refreshPaperMetadata(selected.paperKey) }.getOrNull() != null
                    if (!readable && onRelated != null) onRelated(selected) else onRead(selected.paperKey)
                } }, { editPaper = selected }, { mutate { app.metadata.save(selected.paperKey, !selected.saved) } })
                }
            }
            if (phone && !embedded) Row(Modifier.fillMaxWidth().heightIn(min = 66.dp).border(.5.dp, colors.rule), verticalAlignment = Alignment.CenterVertically) {
                labels.forEachIndexed { index, (key, label) ->
                    if (index > 0) VerticalDivider(Modifier.height(48.dp), color = colors.rule, thickness = .5.dp)
                    TextButton(onClick = { destination = key; if (key == "folders") showFolders = true },
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { this.selected = destination == key }) {
                    Text(label, color = if (destination == key) colors.accent else colors.inkSoft)
                } }
            }
        }
        if (!detail && selected != null) ModalBottomSheet(onDismissRequest = { selectedKey = null }) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp)) {
                PaperDetails(app, selected, { if (selected.pdfSha256 == null && onRelated != null) onRelated(selected) else onRead(selected.paperKey) }, { editPaper = selected }, { mutate { app.metadata.save(selected.paperKey, !selected.saved) } })
            }
        }
    }
    if (showConflicts) ModalBottomSheet(onDismissRequest = { showConflicts = false }) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 580.dp).padding(horizontal = 20.dp)) {
            items(conflicts, key = { it.requestId }) { conflict ->
                val current = WireJson.format.parseToJsonElement(conflict.currentJson).jsonObject
                val retained = WireJson.format.parseToJsonElement(conflict.mutationJson).jsonObject
                val patch = retained["patch"]!!.jsonObject
                val base = retained["base"]!!.jsonObject
                Column(Modifier.padding(vertical = 16.dp)) {
                    Text(current.text("name").orEmpty(), fontFamily = ScholarlySerif, fontSize = 21.sp)
                    Text(libraryText("Deleted on another device", "다른 기기에서 삭제됨"), color = colors.inkSoft, fontSize = 12.sp)
                    Text(libraryText("Earlier name: ", "이전 이름: ") + (patch.text("name") ?: base.text("name").orEmpty()))
                    val parent = if ("parentId" in patch) patch.text("parentId") else base.text("parentId")
                    Text(libraryText("Earlier parent: ", "이전 상위 폴더: ") + (allFolders.firstOrNull { it.id == parent }?.name
                        ?: if (parent == null) libraryText("Top level", "최상위") else libraryText("Folder unavailable", "폴더 사용 불가")))
                }
                HorizontalDivider(color = colors.rule)
            }
        }
    }
    if (showSearch) ModalBottomSheet(onDismissRequest = { showSearch = false }) {
        OutlinedTextField(search, { search = it }, label = { Text(libraryText("Search titles, authors and tags", "제목·저자·태그 검색")) },
            modifier = Modifier.fillMaxWidth().padding(20.dp), singleLine = true)
        TextButton(onClick = { showSearch = false }) { Text(libraryText("Done", "완료")) }
    }
    if (showFolders) ModalBottomSheet(onDismissRequest = { showFolders = false }) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 580.dp)) {
            item { TextButton(onClick = { folderId = null; showFolders = false }) { Text(libraryText("All folders", "모든 폴더")) } }
            fun children(parent: String?, depth: Int) {
                folders.filter { it.parentId == parent }.sortedBy { it.name.lowercase() }.forEach { folder ->
                    item(key = folder.id) {
                        val ids = folderDescendants(folder.id, folders)
                        val count = papers.count { paper -> paper.record().collections.any { it in ids } }
                        Column(Modifier.fillMaxWidth().padding(start = (16 + depth * 12).coerceAtMost(76).dp, end = 16.dp)) {
                            TextButton(onClick = { folderId = folder.id; destination = "folders"; showFolders = false }, Modifier.fillMaxWidth()) {
                                Text(folder.name, Modifier.weight(1f), color = colors.ink); Text("$count", color = colors.inkSoft)
                            }
                            Row { TextButton(onClick = { editFolder = folder }) { Text(libraryText("Edit", "편집")) }
                                TextButton(onClick = { deleteFolder = folder }) { Text(libraryText("Delete", "삭제")) } }
                        }
                    }
                    children(folder.id, depth + 1)
                }
            }
            children(null, 0)
            item { TextButton(onClick = { newFolder = true }) { Text(libraryText("New folder", "새 폴더")) } }
        }
    }
    if (newFolder || editFolder != null) FolderEditor(editFolder, folders, onDismiss = { newFolder = false; editFolder = null }) { name, parent ->
        val id = editFolder?.id
        mutate { if (id == null) app.metadata.folder(name, parent) else app.metadata.folder(name, parent, id) }
        newFolder = false; editFolder = null
    }
    deleteFolder?.let { folder -> AlertDialog(onDismissRequest = { deleteFolder = null },
        title = { Text(libraryText("Delete folder", "폴더 삭제")) }, text = { Text(libraryText("Papers stay in your library. Child folders move to this folder’s parent; only this membership is removed.", "논문은 서재에 유지됩니다. 하위 폴더는 상위 폴더로 이동하며 이 폴더의 소속만 제거됩니다.")) },
        confirmButton = { TextButton(onClick = { mutate { app.metadata.deleteFolder(folder.id) }; if (folderId == folder.id) folderId = null; deleteFolder = null }) { Text(libraryText("Delete", "삭제")) } },
        dismissButton = { TextButton(onClick = { deleteFolder = null }) { Text(libraryText("Cancel", "취소")) } }) }
    editPaper?.let { paper -> PaperOrganizer(app, paper, folders, onDismiss = { editPaper = null }, onSave = { tags, memberships ->
        mutate { app.metadata.patchPaper(paper.paperKey, buildJsonObject {
            put("tags", JsonArray(tags.map(::JsonPrimitive))); put("collections", JsonArray(memberships.map(::JsonPrimitive)))
        }) }; editPaper = null
    }) }
    if (import) ImportPaperDialog(app, onDismiss = { import = false }, onImported = { import = false; refresh() })
}

@Composable
private fun PaperDetails(app: ReaderApplication, paper: LibraryEntity, read: () -> Unit, organize: () -> Unit, save: () -> Unit) {
    val colors = LocalFractalColors.current
    val record = paper.record()
    Text(libraryText("Paper details", "논문 정보"), color = colors.inkSoft, fontSize = 12.sp)
    Text(paper.title ?: paper.paperKey, fontFamily = ScholarlySerif, fontSize = 23.sp, lineHeight = 30.sp, color = colors.ink)
    Text(paper.authors, color = colors.inkSoft, fontSize = 14.sp)
    Text(listOfNotNull(paper.venue, paper.year?.toString()).joinToString(" · "), color = colors.inkSoft, fontSize = 12.sp)
    record.abstract?.let { Text(it, Modifier.padding(top = 16.dp), fontSize = 14.sp, lineHeight = 22.sp, color = colors.ink) }
    Text(if (paper.lastReadAt == null) libraryText("Not read yet", "아직 읽지 않음") else libraryText("Last read ", "최근 읽음 ") + paper.lastReadAt.orEmpty().take(10), Modifier.padding(top = 16.dp), fontSize = 12.sp, color = colors.inkSoft)
    TextButton(onClick = read) { Text(if (paper.pdfSha256 == null) libraryText("Metadata and PDF availability", "논문 정보·PDF 상태") else libraryText("Read paper", "논문 읽기")) }
    TextButton(onClick = save) { Text(if (paper.saved) libraryText("Remove from Saved", "저장 해제") else libraryText("Save paper", "논문 저장")) }
    TextButton(onClick = organize) { Text(libraryText("Folders, tags and cache", "폴더·태그·캐시")) }
}

@Composable
private fun FolderEditor(folder: FolderEntity?, folders: List<FolderEntity>, onDismiss: () -> Unit, onSave: (String, String?) -> Unit) {
    var name by remember(folder?.id) { mutableStateOf(folder?.name.orEmpty()) }
    var parent by remember(folder?.id) { mutableStateOf(folder?.parentId ?: "") }
    val excluded = folder?.id?.let { folderDescendants(it, folders) }.orEmpty()
    AlertDialog(onDismissRequest = onDismiss, title = { Text(libraryText("Folder", "폴더")) }, text = { Column {
        OutlinedTextField(name, { name = it }, label = { Text(libraryText("Name", "이름")) })
        ResearchSelector(libraryText("Parent folder", "상위 폴더"), parent, listOf("" to libraryText("Top level", "최상위")) + folders.filterNot { it.id in excluded }.map { it.id to it.name }, { parent = it })
    } }, confirmButton = { TextButton(enabled = name.isNotBlank(), onClick = { onSave(name, parent.takeIf(String::isNotBlank)) }) { Text(libraryText("Save", "저장")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(libraryText("Cancel", "취소")) } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PaperOrganizer(app: ReaderApplication, paper: LibraryEntity, folders: List<FolderEntity>, onDismiss: () -> Unit,
    onSave: (List<String>, List<String>) -> Unit) {
    val scope = rememberCoroutineScope()
    val record = paper.record()
    var tags by remember { mutableStateOf(record.tags.joinToString(", ")) }
    var memberships by remember { mutableStateOf(record.collections.toSet()) }
    var error by remember { mutableStateOf("") }
    var cached by remember { mutableStateOf(paper.pdfSha256?.let(app.cache::contains) == true) }
    var busy by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 650.dp).padding(horizontal = 20.dp)) {
            item {
                Text(paper.title.orEmpty(), fontFamily = ScholarlySerif, fontSize = 22.sp)
                OutlinedTextField(tags, { tags = it }, label = { Text(libraryText("Tags, separated by commas", "태그 (쉼표로 구분)")) }, modifier = Modifier.fillMaxWidth())
                Text(libraryText("Folder memberships", "폴더 소속"), Modifier.padding(top = 12.dp))
            }
            items(folders, key = { it.id }) { folder -> Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable {
                memberships = if (folder.id in memberships) memberships - folder.id else memberships + folder.id
            }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(folder.id in memberships, { checked -> memberships = if (checked) memberships + folder.id else memberships - folder.id })
                Text(folder.name)
            } }
            item {
                TextButton(enabled = !busy, onClick = {
                    if (cached) { paper.pdfSha256?.let { app.cache.existing(it)?.delete() }; cached = false }
                    else scope.launch {
                        busy = true
                        runCatching { val metadata = app.sync.refreshPaperMetadata(paper.paperKey) ?: error("No PDF available")
                            app.downloader.download(paper.paperKey, metadata.first) }.onSuccess { cached = true }.onFailure { error = it.message.orEmpty() }
                        busy = false
                    }
                }) { Text(if (busy) libraryText("Downloading…", "다운로드 중…") else if (cached) libraryText("Remove cached PDF", "캐시 PDF 제거") else libraryText("Download for offline reading", "오프라인 읽기용 다운로드")) }
                if (error.isNotBlank()) Text(error, color = LocalFractalColors.current.accent)
                TextButton(onClick = { onSave(tags.split(',').map(String::trim).filter(String::isNotBlank).distinct(), memberships.toList()) }) { Text(libraryText("Save changes", "변경 저장")) }
            }
        }
    }
}

@Composable
private fun ImportPaperDialog(app: ReaderApplication, onDismiss: () -> Unit, onImported: () -> Unit) {
    var input by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = onDismiss, title = { Text(libraryText("Import paper", "논문 가져오기")) }, text = { Column {
        Text(libraryText("Enter a DOI, arXiv identifier or PDF URL. Importing does not save or mark the paper read.", "DOI, arXiv 식별자 또는 PDF 주소를 입력하세요. 가져오기는 저장이나 읽음으로 기록되지 않습니다."))
        OutlinedTextField(input, { input = it }, label = { Text(libraryText("Paper source", "논문 출처")) }, modifier = Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error)
    } }, confirmButton = { TextButton(enabled = !busy && input.isNotBlank(), onClick = { scope.launch {
        busy = true
        runCatching { app.client.data("/api/papers/open", "POST", buildJsonObject { put("input", input.trim()) }) }
            .onSuccess { onImported() }.onFailure { error = it.message.orEmpty() }
        busy = false
    } }) { Text(if (busy) libraryText("Importing…", "가져오는 중…") else libraryText("Import", "가져오기")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(libraryText("Cancel", "취소")) } })
}
