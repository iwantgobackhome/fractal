package app.fractal.reader

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.sync.HubClient
import app.fractal.sync.SyncScheduler
import app.fractal.sync.discoveryScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

internal inline fun <reified T> List<DiscoveryCacheEntity>.cached(resource: String): T? =
    firstOrNull { it.resource == resource }?.let { runCatching { WireJson.format.decodeFromString<T>(it.json) }.getOrNull() }

@Composable
internal fun DiscoveryScreen(app: ReaderApplication, destination: String, onSettings: () -> Unit, onRead: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val hubScope = discoveryScope(app.credentials.load())
    val cache by remember(hubScope) { app.database.discovery().observe(hubScope) }.collectAsState(emptyList())
    val intents by remember(hubScope) { app.database.discovery().observeIntents(hubScope) }.collectAsState(emptyList())
    val library by app.database.library().observeAll().collectAsState(emptyList())
    val feed = cache.cached<DiscoveryFeed>("feed")
    val taxonomy = cache.cached<TaxonomyResponse>("taxonomy")?.items.orEmpty()
    var field by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("") }
    var topicFilter by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var trail by rememberSaveable { mutableStateOf(listOf<String>()) }
    val selected = trail.lastOrNull()
    val details = rememberSaveableStateHolder()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    var deleteTopic by remember { mutableStateOf<FieldTopic?>(null) }
    var interests by remember { mutableStateOf(false) }
    var filters by rememberSaveable { mutableStateOf(false) }
    val state = rememberLazyListState()
    val colors = LocalFractalColors.current
    val ko = LocalConfiguration.current.locales[0].language == "ko"
    val topicField = field.ifBlank { taxonomy.firstOrNull()?.code.orEmpty() }
    val topics = cache.cached<TopicResponse>("topics:$topicField")?.topics.orEmpty().map { topic ->
        val pending = intents.lastOrNull { it.kind == "follow" && it.resource == topic.id }
        if (pending == null) topic else topic.copy(followed = WireJson.format.parseToJsonElement(pending.bodyJson).jsonObject.text("followed") == "true")
    }.filterNot { topic -> intents.any { it.kind == "deleteTopic" && it.resource == topic.id } }
    val news = destination == "news"
    val allRows = if (news) feed?.news().orEmpty() else feed?.papers().orEmpty()
    val fieldRows = if (field.isBlank()) allRows else if (news) {
        val ids = feed?.sections?.newsByField?.filter { it.field == field }?.flatMap { it.items }?.map { it.id }.orEmpty().toSet()
        allRows.filter { it.id in ids || field in it.categories }
    } else allRows.filter { field in it.categories || feed?.sections?.byField?.any { group -> group.field == field && group.items.any { row -> row.id == it.id } } == true }
    val visible = fieldRows.filter { paper -> (source.isBlank() || source in paper.source.split(',').map(String::trim)) &&
        (kind.isBlank() || paper.publication?.publicationKind == kind) &&
        (topicFilter.isBlank() || topicFilter in paper.topicIds || feed?.sections?.newsByTopic?.any { it.topicId == topicFilter && it.items.any { row -> row.id == paper.id } } == true) &&
        listOf(paper.title, paper.titleTranslated.orEmpty(), paper.authors.joinToString(" "), paper.abstract).any { it.contains(search, true) } }
    fun action(block: suspend () -> Unit) { scope.launch {
        try { block(); error = "" } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            error = failure.message.orEmpty()
        }
    } }
    fun refresh(force: Boolean) { if (!busy) action {
        busy = true
        try {
            val failures = app.discovery.flush()
            app.discovery.refresh("taxonomy", "/api/feed/categories")
            app.discovery.refresh("interests", "/api/feed/interests")
            app.discovery.refreshFeed(force)
            if (failures.isNotEmpty()) error(failures.first())
        } finally { busy = false }
    } }
    LaunchedEffect(hubScope) { if (app.credentials.load() != null) refresh(false) }
    LaunchedEffect(topicField, hubScope) { if (topicField.isNotBlank() && app.credentials.load() != null) action {
        app.discovery.refresh("topics:$topicField", "/api/feed/topics?field=${HubClient.keyPath(topicField)}")
    } }
    val selectedPaper = selected?.let { raw -> WireJson.format.decodeFromString<DiscoveryPaper>(raw) }
    @Composable fun dossier() { selectedPaper?.let { paper -> details.SaveableStateProvider(publicationFingerprint(paper)) {
        val back = { trail = trail.dropLast(1) }
        if (paper.kind == "news") NewsDiscoveryDetail(app, paper, onBack = back)
        else PaperDiscoveryDetail(app, paper, back, onRead, { trail = trail + WireJson.format.encodeToString(it) })
    } } }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val expanded = maxWidth >= 840.dp
    if (selected != null && !expanded) {
        dossier()
    } else Row(Modifier.fillMaxSize()) {
    LazyColumn(Modifier.weight(if (expanded) .56f else 1f).fillMaxHeight().background(colors.paper), state = state, contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            DeskHeading(when (destination) { "news" -> libraryText("Field news", "분야 소식"); "topics" -> libraryText("Research topics", "연구 주제"); else -> libraryText("Discovery desk", "논문 발견") }, onSettings)
            FlowRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(enabled = !busy, onClick = { refresh(true) }) { Text(if (busy) libraryText("Refreshing…", "새로 고침 중…") else libraryText("Refresh", "새로 고침")) }
                TextButton(onClick = { interests = true }, enabled = cache.any { it.resource == "interests" }) { Text(libraryText("Research interests", "관심 분야")) }
                if (intents.isNotEmpty()) TextButton(enabled = !busy, onClick = { refresh(false) }) { Text(libraryText("Retry retained changes", "보관된 변경 다시 시도") + " (${intents.size})") }
            }
            if (error.isNotBlank()) StatusParagraph(libraryText("Hub unavailable or request failed. Cached content and retained changes remain available.", "허브 연결 또는 요청에 실패했습니다. 캐시된 콘텐츠와 보관된 변경은 유지됩니다.") + "\n" + error)
            if (destination != "topics") {
                OutlinedTextField(search, { search = it }, label = { Text(libraryText("Search this cached index", "캐시된 목록 검색")) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
            }
            if (destination != "topics") TextButton(onClick = { filters = !filters }, modifier = Modifier.padding(horizontal = 8.dp)) {
                val fieldLabel = taxonomy.firstOrNull { it.code == field }?.name?.get(if (ko) "ko" else "en")
                    ?: (feed?.sections?.byField.orEmpty() + feed?.sections?.newsByField.orEmpty()).firstOrNull { it.field == field }?.label
                    ?: field
                val topicLabel = topics.firstOrNull { it.id == topicFilter }?.label ?: if (topicFilter.isNotBlank()) libraryText("Topic unavailable", "주제 사용 불가") else ""
                Text(libraryText("Filters", "필터") + " · " + listOf(fieldLabel, source, if (kind.isNotBlank()) publicationLabel(kind) else "", topicLabel).filter(String::isNotBlank).joinToString(" · ").ifBlank { libraryText("All", "전체") })
            }
            if (filters || destination == "topics") {
            ResearchSelector(libraryText("Field", "분야"), if (destination == "topics") topicField else field,
                (if (destination == "topics") emptyList() else listOf("" to libraryText("All fields", "모든 분야"))) + taxonomy.map { it.code to "${it.name[if (ko) "ko" else "en"] ?: it.code} · ${it.code}" } +
                (feed?.sections?.byField.orEmpty() + feed?.sections?.newsByField.orEmpty()).filter { group -> taxonomy.none { it.code == group.field } }.distinctBy { it.field }.map { it.field to (it.label ?: it.field) },
                { field = it; topicFilter = "" }, Modifier.padding(horizontal = 16.dp))
            if (destination != "topics") {
                ResearchSelector(libraryText("Source", "출처"), source, listOf("" to libraryText("All sources", "모든 출처")) + allRows.flatMap { it.source.split(',').map(String::trim) }.filter(String::isNotBlank).distinct().map { it to it }, { source = it }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                if (!news) ResearchSelector(libraryText("Publication type", "출판 유형"), kind, listOf("" to libraryText("All publications", "모든 출판 유형")) + listOf("journal", "conference", "preprint", "other", "unknown").map { it to publicationLabel(it) }, { kind = it }, Modifier.padding(horizontal = 16.dp))
                if (topics.any { it.followed }) ResearchSelector(libraryText("Followed topic", "팔로우 주제"), topicFilter,
                    listOf("" to libraryText("All topics", "모든 주제")) + topics.filter { it.followed }.map { it.id to it.label }, { topicFilter = it }, Modifier.padding(16.dp))
            }
            }
            if (destination != "topics") Text("${visible.size} " + libraryText("items", "개 항목") +
                (feed?.generatedAt?.let { " · " + readableDiscoveryTime(it) } ?: ""), Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                fontSize = 14.sp, lineHeight = 21.sp, color = colors.inkSoft)
            HorizontalDivider(Modifier.padding(horizontal = 16.dp), thickness = 2.dp, color = colors.ink)
        }
        if (destination == "topics") {
            item { StatusParagraph(libraryText("Choose a field, follow topics or add a search query.", "분야를 선택하고 주제를 팔로우하거나 검색어를 추가하세요."))
                TextButton(enabled = topicField.isNotBlank(), onClick = { create = true }) { Text(libraryText("Create personal topic", "개인 주제 만들기")) } }
            items(topics.sortedByDescending { it.followed }, key = { it.id }) { topic ->
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    Text(topic.label, fontFamily = ScholarlySerif, fontSize = 22.sp, lineHeight = 29.sp, color = colors.ink)
                    Text(topic.query, color = colors.inkSoft, fontSize = 14.sp)
                    Text(topicOrigin(topic.origin), color = colors.inkSoft, fontSize = 13.sp)
                    FlowRow {
                        TextButton(onClick = { action { app.discovery.follow(topic, !topic.followed); app.discovery.flush().firstOrNull()?.let { error(it) } } }) {
                            Text(if (topic.followed) libraryText("Following ✓ · Unfollow", "팔로우 중 ✓ · 해제") else libraryText("Follow", "팔로우"))
                        }
                        if (topic.origin == "user") TextButton(onClick = { deleteTopic = topic }) { Text(libraryText("Delete", "삭제")) }
                    }
                    HorizontalDivider(color = colors.rule)
                }
            }
            items(intents.filter { it.kind == "topic" && WireJson.format.parseToJsonElement(it.bodyJson).jsonObject.text("field") == topicField }, key = { it.id }) {
                val body = WireJson.format.parseToJsonElement(it.bodyJson).jsonObject
                StatusParagraph(body.text("label").orEmpty() + " · " + libraryText("Creation retained; reconnect to reconcile", "생성 요청 보관됨 · 다시 연결해 확인") + (it.error?.let { message -> "\n$message" } ?: ""))
            }
            if (topics.isEmpty()) item { StatusParagraph(libraryText("No cached topics for this field. Connect and refresh, or choose another field.", "이 분야의 캐시된 주제가 없습니다. 연결 후 새로 고침하거나 다른 분야를 선택하세요.")) }
        } else {
            items(visible, key = { it.id }) { paper ->
                DiscoveryIndexRow(paper, library.firstOrNull { matchesPublication(paper, it) }, intents.any { it.kind == "bookmark" && it.resource == publicationFingerprint(paper) },
                    onOpen = { trail = listOf(WireJson.format.encodeToString(paper)) }, onSave = { action {
                        val row = library.firstOrNull { matchesPublication(paper, it) }
                        if (row != null) {
                            app.metadata.save(row.paperKey, !row.saved)
                            SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false)); app.sync.syncOnce()
                        } else { app.discovery.save(paper); app.discovery.flush().firstOrNull()?.let { error(it) } }
                    } })
            }
            if (visible.isEmpty()) item { StatusParagraph(libraryText("No items in this view. Change the filters or refresh with the Hub connected.", "이 보기에는 항목이 없습니다. 필터를 바꾸거나 허브 연결 후 새로 고침하세요.")) }
            // The same provider may report several field/topic observations. Keep all
            // diagnostics without treating its display label as a unique row identity.
            feed?.sourceStatus?.let { statuses -> itemsIndexed(statuses, key = { index, item -> "provider:$index:${item.source}" }) { _, it ->
                StatusParagraph(it.source + " · " + providerState(it.errorCode ?: it.state) +
                    (it.fetchedAt?.let { time -> " · ${readableDiscoveryTime(time)}" } ?: "") + (it.retryAt?.let { time -> "\n" + libraryText("Retry after ", "다시 시도 가능 시간 ") + readableDiscoveryTime(time) } ?: "") + (it.message?.let { m -> "\n$m" } ?: ""))
            } }
        }
    }
    if (expanded) Box(Modifier.weight(.44f).fillMaxHeight().border(.5.dp, colors.rule)) {
        if (selectedPaper != null) dossier() else Column(Modifier.padding(24.dp)) {
            Text(libraryText("Research detail", "연구 상세"), fontFamily = ScholarlySerif, fontSize = 24.sp)
            Text(libraryText("Select a title to read the complete publication details or article.", "제목을 선택하면 전체 출판 정보나 기사를 읽을 수 있습니다."), fontSize = 15.sp, lineHeight = 23.sp)
        }
    }
    }
    }
    if (create) PersonalTopicDialog(onDismiss = { create = false }) { label, query ->
        create = false; action { app.discovery.createTopic(topicField, label, query); app.discovery.flush().firstOrNull()?.let { error(it) } }
    }
    deleteTopic?.let { topic -> AlertDialog(onDismissRequest = { deleteTopic = null }, title = { Text(libraryText("Delete personal topic?", "개인 주제를 삭제할까요?")) },
        text = { Text(topic.label) }, confirmButton = { TextButton(onClick = { deleteTopic = null; action { app.discovery.deleteTopic(topic); app.discovery.flush().firstOrNull()?.let { error(it) } } }) { Text(libraryText("Delete", "삭제")) } },
        dismissButton = { TextButton(onClick = { deleteTopic = null }) { Text(libraryText("Cancel", "취소")) } }) }
    if (interests) ResearchInterestsDialog(app, cache, taxonomy, { interests = false }) { interests = false; refresh(false) }
}

@Composable internal fun DeskHeading(title: String, onAction: () -> Unit, action: String = libraryText("Settings", "설정")) {
    val colors = LocalFractalColors.current
    Column { Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontFamily = ScholarlySerif, fontSize = 28.sp, lineHeight = 35.sp, color = colors.ink)
        TextButton(onClick = onAction) { Text(action) }
    }; HorizontalDivider(color = colors.rule, thickness = .5.dp) }
}
@Composable internal fun StatusParagraph(text: String) { Text(text, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = LocalFractalColors.current.inkSoft, fontSize = 14.sp, lineHeight = 21.sp) }

@Composable internal fun publicationLabel(kind: String?) = when (kind) {
    "journal" -> libraryText("Journal", "학술지"); "conference" -> libraryText("Conference", "학회"); "preprint" -> libraryText("Preprint", "프리프린트")
    "other" -> libraryText("Other publication", "기타 출판물"); else -> libraryText("Publication type unknown", "출판 유형 미상")
}
@Composable internal fun topicOrigin(origin: String) = when(origin) {
    "curated" -> libraryText("Curated", "선별 주제"); "trending" -> libraryText("Trending", "인기 주제"); "suggested" -> libraryText("Suggested", "추천 주제"); else -> libraryText("Personal topic", "개인 주제")
}
@Composable internal fun providerState(state: String) = when(state) {
    "ok", "ready" -> libraryText("Available", "사용 가능"); "cached" -> libraryText("Cached", "캐시됨"); "stale" -> libraryText("Earlier cached results", "이전 캐시 결과")
    "partial" -> libraryText("Partial results", "일부 결과"); "disabled" -> libraryText("Disabled on Hub", "허브에서 비활성화됨")
    "rate_limited" -> libraryText("Rate limited", "요청 횟수 제한"); "timeout" -> libraryText("Provider timed out", "제공자 응답 시간 초과")
    "auth_required" -> libraryText("Provider authentication required", "제공자 인증 필요"); "not_found" -> libraryText("No verified match", "확인된 일치 항목 없음")
    "budget_exhausted" -> libraryText("Provider budget exhausted", "제공자 사용량 한도 도달"); else -> libraryText("Unavailable", "사용 불가")
}
internal fun matchesPublication(paper: DiscoveryPaper, row: LibraryEntity): Boolean {
    if (paper.id == row.paperKey) return true
    val record = runCatching { WireJson.format.decodeFromString<LibraryRecord>(row.json) }.getOrNull() ?: return false
    val aDoi = canonicalDoi(paper.doi); val bDoi = canonicalDoi(record.doi)
    val aArxiv = canonicalArxiv(paper.arxivId); val bArxiv = canonicalArxiv(record.arxivId)
    if (aDoi != null && bDoi != null && aDoi != bDoi || aArxiv != null && bArxiv != null && aArxiv != bArxiv) return false
    if (aDoi != null && aDoi == bDoi || aArxiv != null && aArxiv == bArxiv) return true
    // No loose title matching: unidentified cards stay independent until the Hub resolves identity.
    return paper.url == record.url && paper.title == record.title && paper.authors.joinToString(", ") == row.authors &&
        (paper.publication?.year ?: paper.year) == row.year
}

@Composable internal fun DiscoveryIndexRow(paper: DiscoveryPaper, saved: LibraryEntity?, pending: Boolean, onOpen: () -> Unit, onSave: () -> Unit) {
    val colors = LocalFractalColors.current
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        TextButton(onClick = onOpen, shape = androidx.compose.ui.graphics.RectangleShape,
            contentPadding = PaddingValues(0.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(paper.titleTranslated ?: paper.title, Modifier.fillMaxWidth(), fontFamily = ScholarlySerif, fontSize = 22.sp, lineHeight = 29.sp, color = colors.ink)
        }
        if (paper.titleTranslated != null) Text(paper.title, color = colors.inkSoft, fontSize = 14.sp, lineHeight = 21.sp)
        Text(paper.authors.take(3).joinToString(", ").ifBlank { libraryText("Author not reported", "저자 정보 없음") } +
            if (paper.authors.size > 3) libraryText(" · +${paper.authors.size - 3} authors", " · 외 ${paper.authors.size - 3}명") else "", color = colors.inkSoft, fontSize = 14.sp, lineHeight = 21.sp)
        Text(if (paper.kind == "news") libraryText("Feed · ", "피드 · ") + paper.source.substringBefore(',') + " · " + paper.publishedAt.take(10) else
            listOf(publicationLabel(paper.publication?.publicationKind), paper.publication?.venue ?: paper.venue ?: libraryText("Venue unknown", "발행처 미상"),
                (paper.publication?.year ?: paper.year)?.toString() ?: libraryText("Year unknown", "연도 미상")).joinToString(" · "), color = colors.inkSoft, fontSize = 14.sp, lineHeight = 21.sp)
        if (paper.abstract.isNotBlank()) Text(paper.abstract, maxLines = 4, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            color = colors.inkSoft, fontSize = 14.sp, lineHeight = 22.sp)
        if (paper.kind != "news") {
            Text(paper.source.ifBlank { paper.provider.orEmpty() } + if (paper.reason.isNotBlank()) " · ${paper.reason}" else "", color = colors.inkSoft, fontSize = 13.sp, lineHeight = 20.sp)
            TextButton(enabled = !pending, onClick = onSave) { Text(when { pending -> libraryText("Save retained · reconnect", "저장 요청 보관됨 · 다시 연결"); saved?.saved == true -> libraryText("Saved ✓ · Unsave", "저장됨 ✓ · 해제"); else -> libraryText("Save metadata", "논문 정보 저장") }) }
        }
        HorizontalDivider(color = colors.rule, thickness = .5.dp)
    }
}

@Composable private fun PersonalTopicDialog(onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var label by rememberSaveable { mutableStateOf("") }; var query by rememberSaveable { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(libraryText("Personal topic", "개인 주제")) }, text = { Column(Modifier.verticalScroll(rememberScrollState())) {
        OutlinedTextField(label, { label = it }, label = { Text(libraryText("Topic name", "주제 이름")) })
        OutlinedTextField(query, { query = it }, label = { Text(libraryText("Search query (optional)", "검색어 (선택)")) })
        Text(libraryText("Offline changes are retained until the Hub reconnects.", "오프라인 변경은 허브에 다시 연결할 때까지 보관됩니다."))
    } }, confirmButton = { TextButton(enabled = label.trim().length in 2..100 && query.length <= 200, onClick = { onSave(label, query) }) { Text(libraryText("Create", "만들기")) } }, dismissButton = { TextButton(onClick = onDismiss) { Text(libraryText("Cancel", "취소")) } })
}
