package app.fractal.reader

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.sync.HubClient
import app.fractal.sync.SyncScheduler
import app.fractal.sync.discoveryScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.security.MessageDigest
import java.time.Instant
import java.util.Locale

@Composable internal fun PaperDiscoveryDetail(app: ReaderApplication, paper: DiscoveryPaper, onBack: () -> Unit,
    onRead: (String) -> Unit, onOpenPaper: (DiscoveryPaper) -> Unit) {
    val scope = rememberCoroutineScope()
    val hubScope = discoveryScope(app.credentials.load())
    val cache by remember(hubScope) { app.database.discovery().observe(hubScope) }.collectAsState(emptyList())
    val intents by remember(hubScope) { app.database.discovery().observeIntents(hubScope) }.collectAsState(emptyList())
    val library by app.database.library().observeAll().collectAsState(emptyList())
    val saved = library.firstOrNull { matchesPublication(paper, it) }
    val relatedKey = saved?.let(::relatedResource)
    val related = relatedKey?.let { cache.cached<RelatedPapers>(it) }
    var relation by rememberSaveable(publicationFingerprint(paper)) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var relatedBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var relatedError by remember { mutableStateOf("") }
    var retryReady by remember { mutableStateOf(true) }
    var organize by remember { mutableStateOf(false) }
    var readBusy by remember(publicationFingerprint(paper), hubScope) { mutableStateOf(false) }
    var readError by remember(publicationFingerprint(paper), hubScope) { mutableStateOf("") }
    val request = remember(publicationFingerprint(paper), hubScope) { Any() }
    val activeRequest = rememberUpdatedState(request)
    var mounted by remember(request) { mutableStateOf(true) }
    DisposableEffect(request) { onDispose { mounted = false } }
    val folders by app.database.metadata().observeFolders().collectAsState(emptyList())
    val colors = LocalFractalColors.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val state = rememberLazyListState()
    fun action(block: suspend () -> Unit) { scope.launch { busy = true
        try { block(); error = "" } catch (failure: Exception) {
            if (failure is CancellationException) throw failure; error = failure.message.orEmpty()
        } finally { busy = false }
    } }
    fun readPdf() {
        if (readBusy || busy) return
        if (saved?.pdfSha256 != null) { onRead(saved.paperKey); return }
        val paired = app.credentials.load()
        scope.launch {
            readBusy = true; readError = ""
            try {
                val key = app.acquisition.open(paper) {
                    check(mounted && activeRequest.value === request && app.credentials.load() == paired) {
                        "Publication or Hub connection changed; retry from the current paper."
                    }
                }
                onRead(key)
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                readError = failure.message ?: "PDF acquisition failed. Retry or choose a PDF."
            } finally { readBusy = false }
        }
    }
    fun loadRelated() { val key = saved?.paperKey ?: return
        if (relatedBusy || !retryReady) return
        scope.launch { relatedBusy = true
            retryReady = false
            try { app.discovery.refresh(relatedKey!!, "/api/papers/${HubClient.keyPath(key)}/related"); relatedError = "" }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; relatedError = failure.message.orEmpty() }
            finally { relatedBusy = false; kotlinx.coroutines.delay(2000); retryReady = true }
        }
    }
    LaunchedEffect(relatedKey) { if (app.credentials.load() != null) loadRelated() }
    BackHandler(onBack = onBack)
    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && saved != null) action {
            val paired = app.credentials.load()
            val session = app.client.captured()
            val guard = { session.ensureCurrent(); check(app.credentials.load() == paired && mounted && activeRequest.value === request) {
                "Publication or Hub changed while linking; reconnect to reconcile."
            } }
            val bytes = withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                    while (true) { val count = input.read(buffer); if (count < 0) break
                        require(output.size() + count <= 50 * 1024 * 1024) { "Choose a PDF no larger than 50 MiB." }; output.write(buffer, 0, count) }
                    output.toByteArray()
                } ?: error("Selected document is unavailable")
            }
            guard()
            val result = app.client.linkPdf(saved.paperKey, bytes, session)
            guard()
            check(result.text("paperKey") == saved.paperKey) { "Hub changed catalog identity" }
            app.sync.acceptPaper(result.getValue("record").jsonObject, guard)
            val metadata = app.sync.refreshPaperMetadata(saved.paperKey, session, guard) ?: error("Linked PDF metadata unavailable")
            app.downloader.download(saved.paperKey, metadata.first, session, guard)
            // Association deliberately does not call metadata.read or start the reader.
        }
    }
    LazyColumn(Modifier.fillMaxSize().background(colors.paper), state = state, contentPadding = PaddingValues(bottom = 24.dp)) {
        item { DeskHeading(libraryText("Paper dossier", "논문 상세"), onBack, libraryText("Back", "뒤로"))
            SelectionContainer { Column(Modifier.padding(16.dp)) {
                DiscoveryImage(app, paper.image, detail = true)
                Text(paper.title, fontFamily = ScholarlySerif, fontSize = 27.sp, lineHeight = 35.sp, color = colors.ink)
                Text(paper.authors.joinToString(", ").ifBlank { libraryText("Author not reported", "저자 정보 없음") }, Modifier.padding(top = 12.dp), fontSize = 15.sp, lineHeight = 23.sp, color = colors.inkSoft)
                Text(listOf(publicationLabel(paper.publication?.publicationKind), paper.publication?.venue ?: paper.venue ?: libraryText("Venue unknown", "발행처 미상"),
                    (paper.publication?.year ?: paper.year)?.toString() ?: libraryText("Year unknown", "연도 미상")).joinToString(" · "), fontSize = 14.sp, lineHeight = 21.sp, color = colors.inkSoft)
                Text(libraryText("Provenance: ", "출처: ") + (paper.publication?.sources?.joinToString(", ")?.ifBlank { null } ?: paper.source.ifBlank { paper.provider ?: libraryText("Not reported", "정보 없음") }), fontSize = 14.sp, color = colors.inkSoft)
                Text(libraryText("Publication date: ", "출판 날짜: ") + (paper.publication?.publicationDate ?: libraryText("Unknown", "미상")), fontSize = 14.sp, color = colors.inkSoft)
                if (paper.dateBasis == "observed") Text(libraryText("Feed timestamp is an observation, not a publication date.", "피드의 날짜는 관측 시간이며 출판 날짜가 아닙니다."), fontSize = 14.sp, color = colors.inkSoft)
                paper.doi?.let { Text("DOI · $it", fontSize = 14.sp) }; paper.arxivId?.let { Text("arXiv · $it", fontSize = 14.sp) }
                if (paper.abstract.isNotBlank()) { HorizontalDivider(Modifier.padding(vertical = 16.dp), color = colors.rule); Text(paper.abstract, fontSize = 16.sp, lineHeight = 26.sp, color = colors.ink) }
            } }
            StatusParagraph(when {
                saved?.pdfSha256?.let(app.cache::contains) == true -> libraryText("Original PDF cached for offline reading", "오프라인 읽기용 원문 PDF 캐시됨")
                saved?.pdfSha256 != null -> libraryText("Original PDF linked · download when reading", "원문 PDF 연결됨 · 읽을 때 다운로드")
                else -> libraryText("Metadata only · saving does not acquire a PDF or mark this paper read", "논문 정보만 있음 · 저장해도 PDF를 받거나 읽음으로 기록하지 않습니다")
            })
            FlowRow(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Button(enabled = !busy && !readBusy, onClick = ::readPdf) {
                    Text(if (readBusy) libraryText("Acquiring PDF…", "PDF 가져오는 중…")
                        else if (readError.isNotBlank()) libraryText("Retry Read PDF", "PDF 읽기 다시 시도")
                        else libraryText("Read PDF", "PDF 읽기"))
                }
                val pending = intents.any { it.kind == "bookmark" && it.resource == publicationFingerprint(paper) }
                TextButton(enabled = !busy && !pending, onClick = { action {
                    if (saved == null) { app.discovery.save(paper); app.discovery.flush().firstOrNull()?.let { error(it) } }
                    else {
                        app.metadata.save(saved.paperKey, !saved.saved)
                        SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
                        app.sync.syncOnce()
                    }
                } }) { Text(if (pending) libraryText("Save retained", "저장 요청 보관됨") else if (saved?.saved == true) libraryText("Saved ✓ · Unsave", "저장됨 ✓ · 해제") else libraryText("Save metadata", "논문 정보 저장")) }
                if (pending) TextButton(enabled = !busy, onClick = { action { app.discovery.flush().firstOrNull()?.let { error(it) } } }) { Text(libraryText("Retry save", "저장 다시 시도")) }
                if (saved != null) {
                    TextButton(enabled = !busy, onClick = { organize = true }) { Text(libraryText("Folders and tags", "폴더·태그")) }
                    if (saved.pdfSha256 == null) TextButton(enabled = !busy, onClick = { upload.launch(arrayOf("application/pdf")) }) { Text(libraryText("Choose PDF to link", "연결할 PDF 선택")) }
                }
                TextButton(onClick = { runCatching { uriHandler.openUri(paper.url) }.onFailure { error = it.message.orEmpty() } }) { Text(libraryText("Publication page", "출판물 페이지")) }
                paper.publication?.oaPdfUrl?.let { url -> TextButton(onClick = { runCatching { uriHandler.openUri(url) }.onFailure { error = it.message.orEmpty() } }) { Text(libraryText("Reported open PDF link", "보고된 공개 PDF 주소")) } }
            }
            if (readBusy || readError.isNotBlank()) Column(Modifier.fillMaxWidth().padding(16.dp)
                .semantics { liveRegion = LiveRegionMode.Polite }) {
                if (readBusy) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(libraryText("Acquiring and verifying the original PDF. Saving and reading are recorded separately.",
                        "원문 PDF를 가져와 확인합니다. 저장과 읽기는 별도로 기록됩니다."))
                } else Text(readError + "\n" + libraryText("Use Retry Read PDF, Publication page, or Choose PDF to link. For a new paper, Save metadata enables manual linking.",
                    "PDF 읽기 다시 시도, 출판물 페이지 또는 PDF 연결을 이용하세요. 새 논문은 메타데이터를 저장하면 수동 연결할 수 있습니다."))
            }
            if (busy) StatusParagraph(libraryText("Working…", "처리 중…"))
            if (error.isNotBlank()) StatusParagraph(error)
            HorizontalDivider(Modifier.padding(16.dp), color = colors.ink, thickness = 2.dp)
            Text(libraryText("Related research", "관련 연구"), Modifier.padding(horizontal = 16.dp), fontFamily = ScholarlySerif, fontSize = 24.sp)
            if (saved == null) StatusParagraph(libraryText("Save this paper to see related research.", "관련 논문을 보려면 먼저 이 논문을 저장하세요."))
            else {
                ResearchSelector(libraryText("Relationship", "관계"), relation, listOf("" to libraryText("All relationships", "모든 관계"), "similar" to libraryText("Similar", "유사 논문"), "cites" to libraryText("References", "참고문헌"), "citedBy" to libraryText("Cited by", "인용한 논문")), { relation = it }, Modifier.padding(16.dp))
                // A local two-second gate wakes once without polling. Provider-specific cooldowns
                // remain Hub-owned, so one provider cannot disable an independent fallback here.
                TextButton(enabled = !relatedBusy && retryReady, onClick = ::loadRelated) { Text(if (relatedBusy) libraryText("Loading related…", "관련 논문 로드 중…") else libraryText("Refresh related", "관련 논문 새로 고침")) }
                if (relatedError.isNotBlank()) StatusParagraph(libraryText("Related provider unavailable; cached rows are retained.", "관련 제공자를 사용할 수 없습니다. 캐시된 결과는 유지됩니다.") + "\n$relatedError")
                related?.let { result ->
                    StatusParagraph(providerState(result.status ?: "ready") + " · ${result.source}" + (result.fetchedAt?.let { "\n" + libraryText("Fetched: ", "받은 시간: ") + readableDiscoveryTime(it) } ?: ""))
                }
            }
        }
        itemsIndexed(related?.items.orEmpty().filter { relation.isBlank() || relation in it.relations || it.relation == relation }, key = { index, item -> publicationFingerprint(item) + ":$index" }) { _, item ->
            val row = library.firstOrNull { matchesPublication(item, it) }
            DiscoveryIndexRow(app, item, row, intents.any { it.kind == "bookmark" && it.resource == publicationFingerprint(item) }, { onOpenPaper(item) }, { action {
                if (row != null) {
                    app.metadata.save(row.paperKey, !row.saved)
                    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false)); app.sync.syncOnce()
                } else { app.discovery.save(item); app.discovery.flush().firstOrNull()?.let { error(it) } }
            } })
        }
        related?.providerStatus?.let { statuses -> items(statuses, key = { it.provider }) {
            StatusParagraph(it.provider + " · " + providerState(it.state) + (it.message?.let { m -> "\n$m" } ?: "") + (it.retryAt?.let { time -> "\n" + libraryText("Retry after ", "다시 시도 가능 시간 ") + readableDiscoveryTime(time) } ?: ""))
        } }
        if (saved != null && related?.items.isNullOrEmpty()) item { StatusParagraph(libraryText("No verified related rows are cached. Provider availability and identity evidence determine coverage.", "확인된 관련 논문 캐시가 없습니다. 제공자 상태와 식별 근거에 따라 결과가 달라집니다.")) }
    }
    if (organize && saved != null) PaperOrganizer(app, saved, folders.filterNot { it.deleted }, { organize = false }) { tags, memberships ->
        organize = false; action { app.metadata.patchPaper(saved.paperKey, buildJsonObject {
            put("tags", JsonArray(tags.map(::JsonPrimitive))); put("collections", JsonArray(memberships.map(::JsonPrimitive)))
        }); SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false)) }
    }
}

private fun translationResource(article: NewsArticle, target: String): String {
    val original = article.title + "\n" + article.blocks.joinToString("\n") { it.text.orEmpty() }
    return "article-translation:$target:" + MessageDigest.getInstance("SHA-256").digest(original.toByteArray()).joinToString("") { "%02x".format(it) }
}
private fun titleTranslationResource(title: String, target: String): String = "title-translation:$target:" + MessageDigest.getInstance("SHA-256").digest(title.toByteArray()).joinToString("") { "%02x".format(it) }

@Composable internal fun NewsDiscoveryDetail(app: ReaderApplication, paper: DiscoveryPaper, onBack: () -> Unit) {
    val hubScope = discoveryScope(app.credentials.load())
    val cache by remember(hubScope) { app.database.discovery().observe(hubScope) }.collectAsState(emptyList())
    val scope = rememberCoroutineScope()
    val article = cache.cached<NewsArticle>("article:${paper.url}")
    var target by rememberSaveable { mutableStateOf(app.settings.getString("newsLanguage", "ko") ?: "ko") }
    val modeKey = "newsTranslated:$hubScope:${java.security.MessageDigest.getInstance("SHA-256").digest(paper.url.toByteArray()).joinToString("") { "%02x".format(it) }}"
    var translated by rememberSaveable { mutableStateOf(app.settings.getBoolean(modeKey, false)) }
    fun displayTranslation(value: Boolean) { translated = value; app.settings.edit().putBoolean(modeKey, value).apply() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val colors = LocalFractalColors.current
    val uri = LocalUriHandler.current
    val state = rememberLazyListState()
    val resourceKey = article?.let { translationResource(it, target) } ?: titleTranslationResource(paper.title, target)
    val translation = cache.firstOrNull { entry -> entry.resource == resourceKey }
    val translatedText = translation?.let { WireJson.format.parseToJsonElement(it.json).jsonObject["translations"]?.jsonArray?.map { text -> text.jsonPrimitive.content } }
    val textBlocks = article?.blocks?.filter { !it.text.isNullOrBlank() }.orEmpty()
    val texts = if (article == null) listOf(paper.title) else listOf(article.title) + textBlocks.map { it.text!! }
    val showingTranslation = translated && translatedText?.size == texts.size
    val canTranslate = texts.size <= 100 && texts.all { it.length in 1..10000 }
    fun action(block: suspend () -> Unit) { if (!busy) scope.launch { busy = true
        try { block(); error = "" } catch (failure: Exception) { if (failure is CancellationException) throw failure; error = failure.message.orEmpty() }
        finally { busy = false }
    } }
    LaunchedEffect(paper.url, hubScope) { if (app.credentials.load() != null) action { app.discovery.refresh("article:${paper.url}", "/api/news/article?url=${HubClient.keyPath(paper.url)}") } }
    BackHandler(onBack = onBack)
    LazyColumn(Modifier.fillMaxSize().background(colors.paper), state = state, contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            DeskHeading(libraryText("News article", "뉴스 기사"), onBack, libraryText("Back", "뒤로"))
            SelectionContainer { Column(Modifier.padding(16.dp)) {
                DiscoveryImage(app, article?.leadImage ?: paper.image, news = true, detail = true)
                Text(if (showingTranslation) translatedText!!.first() else article?.title ?: paper.title, fontFamily = ScholarlySerif, fontSize = 27.sp, lineHeight = 35.sp, color = colors.ink)
                if (showingTranslation) Text(article?.title ?: paper.title, fontSize = 14.sp, lineHeight = 21.sp, color = colors.inkSoft)
                val sourceLabel = article?.siteName?.takeIf { it.isNotBlank() }
                    ?: (libraryText("Feed · ", "피드 · ") + paper.source.substringBefore(',').trim())
                Text(listOfNotNull(sourceLabel, article?.byline,
                    (article?.publishedAt ?: paper.publishedAt).takeIf { it.isNotBlank() }?.let(::readableDiscoveryTime)
                ).joinToString(" · "), fontSize = 14.sp, lineHeight = 21.sp, color = colors.inkSoft)
            } }
            ResearchSelector(libraryText("Translation language", "번역 언어"), target,
                (listOf("ko", "en", "ja", "zh-Hans", "zh-Hant", "de", "fr", "es", "pt", "ar", "hi", "ru") + target).distinct().map { it to Locale.forLanguageTag(it).getDisplayName(Locale.getDefault()) },
                { target = it; displayTranslation(false); app.settings.edit().putString("newsLanguage", it).apply() }, Modifier.padding(horizontal = 16.dp))
            FlowRow(Modifier.padding(horizontal = 8.dp)) {
                TextButton(enabled = !busy && canTranslate, onClick = { action {
                    val resource = resourceKey
                    if (translation == null) app.discovery.translate(resource, texts, target)
                    displayTranslation(true)
                } }) { Text(libraryText("Translate article / title", "기사·제목 번역")) }
                if (showingTranslation) TextButton(onClick = { displayTranslation(false) }) { Text(libraryText("Show original", "원문 보기")) }
                TextButton(enabled = !busy, onClick = { action { app.discovery.refresh("article:${paper.url}", "/api/news/article?url=${HubClient.keyPath(paper.url)}") } }) { Text(libraryText("Retry article", "기사 다시 시도")) }
                TextButton(onClick = { runCatching { uri.openUri(article?.finalUrl ?: paper.url) }.onFailure { error = it.message.orEmpty() } }) { Text(libraryText("Open source", "출처 열기")) }
            }
            if (busy) StatusParagraph(libraryText("Loading… cached content remains below", "로드 중… 아래 캐시된 콘텐츠는 유지됩니다"))
            if (error.isNotBlank()) StatusParagraph(libraryText("Article provider unavailable; retained content is still readable.", "기사 제공자를 사용할 수 없습니다. 보관된 콘텐츠는 계속 읽을 수 있습니다.") + "\n$error")
            if (!canTranslate) StatusParagraph(libraryText("This article exceeds the quick-translation limits. Its complete original remains available; open the source for other translation options.", "이 기사는 빠른 번역 한도를 초과합니다. 전체 원문은 유지되며 다른 번역 방법은 출처에서 확인하세요."))
            if (showingTranslation) StatusParagraph(if (article == null) libraryText("Machine-translated title only", "제목만 기계 번역됨") else libraryText("Machine translation", "기계 번역"))
            cache.firstOrNull { it.resource == "article:${paper.url}" }?.let { StatusParagraph(libraryText("Article cached: ", "기사 캐시 시간: ") + readableDiscoveryTime(it.fetchedAt)) }
            HorizontalDivider(Modifier.padding(16.dp), color = colors.ink, thickness = 2.dp)
            if (article == null || article.blocks.isEmpty()) { StatusParagraph(libraryText("Full article content is not available in this cache. The feed provides this excerpt:", "이 캐시에 전체 기사 내용이 없습니다. 피드에 제공된 발췌문:") + "\n" + paper.abstract) }
        }
        items(article?.blocks.orEmpty().withIndex().toList(), key = { it.index }) { (index, block) ->
            val textIndex = article!!.blocks.take(index).count { !it.text.isNullOrBlank() } + 1
            val text = if (showingTranslation) translatedText?.getOrNull(textIndex) ?: block.text else block.text
            if (!text.isNullOrBlank()) SelectionContainer { Text(text, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                fontFamily = if (block.type in listOf("h2", "h3")) ScholarlySerif else null,
                fontSize = if (block.type in listOf("h2", "h3")) 23.sp else 17.sp, lineHeight = 27.sp, color = colors.ink) }
            if (block.type == "img") StatusParagraph(libraryText("Image in source article", "출처 기사의 이미지") + (block.image?.alt?.let { " · $it" } ?: ""))
        }
    }
}
