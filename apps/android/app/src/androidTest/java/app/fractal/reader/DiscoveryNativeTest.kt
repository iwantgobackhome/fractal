package app.fractal.reader

import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.pdf.PdfPages
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** Opt-in D-owned real HTTP/storage + ordinary Activity/window; no private tokens in evidence. */
class DiscoveryNativeTest {
    private val app get() = ApplicationProvider.getApplicationContext<ReaderApplication>()
    private lateinit var config: JsonObject
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var native: NativeDeskDriver
    private fun string(name: String) = config.getValue(name).jsonPrimitive.content
    @Before fun connect(): Unit = runBlocking {
        val private = File("/data/local/tmp/fractal-D-stage4-private.json")
        Assume.assumeTrue("Requires independently owned discovery harness", private.isFile)
        config = WireJson.format.parseToJsonElement(private.readText()).jsonObject
        check(string("hubId") == "D-stage4-isolated")
        app.credentials.save(HubCredentials(string("baseUrl"), "D isolated discovery", string("hubId"), string("deviceId"), string("deviceToken")))
        app.settings.edit().putBoolean("languageIntroDone", true).putBoolean("autoDownload", false).commit()
        val offlineLaunch = InstrumentationRegistry.getArguments().getString("offlineLaunch") == "true"
        val language = InstrumentationRegistry.getArguments().getString("captureLanguage") ?: "en"
        InstrumentationRegistry.getInstrumentation().runOnMainSync { setAppLanguage(app, language, explicit = true) }
        InstrumentationRegistry.getArguments().getString("captureTheme")?.let { app.settings.edit().putString("theme", it).commit() }
        control(buildJsonObject { put("offline", offlineLaunch); put("textUnavailable", false); put("articleUnavailable", false); put("provider", "ready") })
        if (!offlineLaunch) { app.discovery.refresh("taxonomy", "/api/feed/categories"); app.discovery.refresh("interests", "/api/feed/interests"); app.discovery.refreshFeed() }
    }
    @After fun finish() { if (::scenario.isInitialized) { native.capture("native-test-end"); scenario.close() } }
    private fun open() {
        scenario = ActivityScenario.launch(MainActivity::class.java); native = NativeDeskDriver(scenario)
        // API33+ LocaleManager is discovered through an active AppCompat delegate.
        // Apply the product language action after launch as well as the cold preference.
        val language = InstrumentationRegistry.getArguments().getString("captureLanguage") ?: "en"
        scenario.onActivity { setAppLanguage(app, language, explicit = true) }
        SystemClock.sleep(700)
        native.waitFor("active product language") { native.node(if (language == "ko") "발견" else "Discover") != null }
    }
    private suspend fun control(body: JsonObject): JsonObject = withContext(Dispatchers.IO) {
        val connection = URL("http://127.0.0.1:${config.getValue("controlPort").jsonPrimitive.int}/D/mode").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toString().toByteArray()) }; check(connection.responseCode == 200)
        val result = WireJsonAdapter.data(connection.inputStream.bufferedReader().use { it.readText() }).jsonObject; connection.disconnect(); result
    }
    private suspend fun remoteLibrary() = app.client.data("/api/library").jsonArray.map { it.jsonObject }
    private suspend fun importRetry(): LibraryEntity {
        val key = string("paperKey"); val record = remoteLibrary().first { it.text("paperKey") == key }
        app.sync.acceptPaper(record)
        val identity = app.sync.refreshPaperMetadata(key)!!; app.downloader.download(key, identity.first)
        return app.database.library().get(key)!!
    }
    private suspend fun waitUntil(predicate: suspend () -> Boolean) = withTimeout(25000) { while (!predicate()) delay(100) }

    @Test fun liveNavigationMetadataSaveTopicsNewsOfflineAndReconnect(): Unit = runBlocking {
        // The retained input-test ink references three D-owned QA catalogs from the
        // previous disposable Hub. Publish only those known fixtures into this fresh Hub.
        val remoteKeys = remoteLibrary().mapNotNull { it.text("paperKey") }.toSet()
        for (key in listOf("gesture-fixture", "D-lifecycle-fixture", "stage3-reader-fixture")) {
            val local = app.database.library().get(key)
            if (key !in remoteKeys) {
                val fixture = LibraryRecord(id = key, paperKey = key, title = local?.title ?: "D retained input fixture", authors = emptyList(),
                    addedAt = "2026-10-01T00:00:00Z", updatedAt = "2026-10-01T00:00:00Z", bibtexKey = key, deviceId = string("deviceId"))
                val complete = WireJson.format.encodeToJsonElement(fixture).jsonObject
                app.client.data("/api/library/metadata", "POST", JsonObject(complete.filterKeys { it != "publication" }))
            }
            try { app.client.data("/api/papers/$key") } catch (missing: HubHttpException) {
                if (missing.code != 404) throw missing
                val hash = local?.pdfSha256 ?: "a".repeat(64)
                app.client.linkPdf(key, app.cache.file(hash).readBytes())
            }
        }
        app.sync.syncOnce() // Includes retained legacy ink with absent optional shape.
        // Repeated runs only change the designated QA publication; never clear a library.
        val card = WireJson.format.decodeFromString<DiscoveryFeed>(app.discovery.refreshFeed().toString()).papers().first { it.arxivId == "2106.09685" }
        app.database.library().all().firstOrNull { matchesPublication(card, it) }?.let { prior ->
            repeat(12) { if (app.database.metadata().pending().any { it.kind == "paper" && it.entityId == prior.paperKey }) app.sync.syncOnce() }
            check(app.database.metadata().pending().none { it.kind == "paper" && it.entityId == prior.paperKey }) { "QA precondition: earlier LoRA receipts must settle" }
            val isolated = androidx.room.Room.inMemoryDatabaseBuilder(app, FractalDatabase::class.java).build()
            try {
                isolated.library().upsert(prior)
                MetadataStore(isolated) { string("deviceId") }.save(prior.paperKey, false)
                val sync = SyncEngine(isolated, app.client); repeat(4) { if (isolated.metadata().pending().isNotEmpty()) sync.syncOnce() }
                check(isolated.metadata().pending().isEmpty()); app.sync.acceptPaper(remoteLibrary().first { it.text("paperKey") == prior.paperKey })
                check(!app.database.library().get(prior.paperKey)!!.saved) { "QA precondition: existing metadata is unsaved" }
            } finally { isolated.close() }
        }
        open(); native.click("Discover"); native.waitFor("discovery heading") { native.node("Discovery desk") != null }; native.scrollTo("LoRA: Low-Rank Adaptation of Large Language Models")
        native.click("LoRA: Low-Rank Adaptation of Large Language Models"); native.scrollTo("Save metadata"); native.click("Save metadata")
        waitUntil { app.database.library().all().any { WireJson.format.decodeFromString<LibraryRecord>(it.json).arxivId == "2106.09685" } }
        val row = app.database.library().all().first { WireJson.format.decodeFromString<LibraryRecord>(it.json).arxivId == "2106.09685" }
        assertTrue(row.saved); assertNull(row.pdfSha256); assertNull(row.lastReadAt)
        waitUntil { remoteLibrary().first { it.text("paperKey") == row.paperKey }.text("saved") == "true" }
        val remote = remoteLibrary().first { it.text("paperKey") == row.paperKey }; assertEquals("true", remote.text("saved")); assertNull(remote.text("lastReadAt"))
        native.capture("metadata-only-dossier")
        native.click("Back"); native.click("Topics")
        // Select the actual taxonomy field, not an invented topic type.
        native.click("Field"); native.click("Computation and Language · cs.CL")
        native.waitFor("field topic list") { native.node("Create personal topic") != null }
        val label = "D reproducible language models ${UUID.randomUUID().toString().take(8)}"
        native.click("Create personal topic"); native.type("Topic name", label); native.type("Search query (optional)", "language models"); native.click("Create")
        waitUntil { WireJson.format.decodeFromString<TopicResponse>(app.client.data("/api/feed/topics?field=cs.CL").toString()).topics.any { it.label == label } }
        val created = WireJson.format.decodeFromString<TopicResponse>(app.client.data("/api/feed/topics?field=cs.CL").toString()).topics.first { it.label == label }
        assertTrue(created.followed)
        control(buildJsonObject { put("offline", true) })
        app.discovery.follow(created, false); assertTrue(app.discovery.flush().isNotEmpty()); assertTrue(app.database.discovery().pending(discoveryScope(app.credentials.load())).any { it.resource == created.id })
        control(buildJsonObject { put("offline", false) }); assertTrue(app.discovery.flush().isEmpty())
        assertFalse(WireJson.format.decodeFromString<TopicResponse>(app.client.data("/api/feed/topics?field=cs.CL").toString()).topics.first { it.id == created.id }.followed)
        // Ambiguous admission is the same actual POST/storage route; the proxy loses its response once.
        val lost = "D admission ${UUID.randomUUID().toString().take(8)}"
        control(buildJsonObject { put("dropTopic", true) }); app.discovery.createTopic("cs.CL", lost, "language models"); app.discovery.flush(); app.discovery.flush()
        assertEquals(1, WireJson.format.decodeFromString<TopicResponse>(app.client.data("/api/feed/topics?field=cs.CL").toString()).topics.count { it.label == lost })
        native.click("News"); native.waitFor("news title") { native.node("QA research field report:", true) != null }; native.click("QA research field report:", true)
        native.waitFor("article content") { native.node("This isolated QA article tests", true) != null }
        native.scrollTo("Translate article / title"); native.click("Translate article / title")
        native.waitFor("real translation response") { native.node("QA 연구 분야 소식:", true) != null }; native.capture("news-machine-translated")
        control(buildJsonObject { put("offline", true) }); scenario.recreate(); SystemClock.sleep(500)
        native.waitFor("offline retained article") { native.node("QA 연구 분야 소식:", true) != null }
        native.capture("news-offline-recreated"); native.click("Back"); native.click("Discover")
        native.waitFor("offline feed") { native.node("Discovery desk") != null }; native.scrollTo("LoRA: Low-Rank Adaptation of Large Language Models"); native.capture("discovery-offline")
        control(buildJsonObject { put("offline", false) }); native.click("Refresh")
        waitUntil { app.database.discovery().pending(discoveryScope(app.credentials.load())).isEmpty() }
        assertEquals(1, app.database.library().all().count { it.paperKey == row.paperKey }); assertNull(app.database.library().get(row.paperKey)!!.lastReadAt)
        Log.i("DiscoveryNativeQA", "PASS actual HTTP metadata-only save, follow/create/ambiguous retry, article/translation, offline recreate/feed and reconnect")
    }

    @Test fun mountedUncachedTextRetryRecoversRangeCopyQuoteWithoutChangingMemoOrViewport(): Unit = runBlocking {
        val row = importRetry(); val key = row.paperKey
        app.database.reader().deleteTextPages(row.pdfSha256!!)
        app.database.reader().upsert(ReaderPositionEntity(key, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}"))
        val memo = buildJsonObject {
            put("id", "D-stage4-retained-memo"); put("paperKey", key); put("page", 1); put("kind", "memo"); put("text", "Complete retained offline memo body"); put("quote", "Independent quote")
            put("updatedAt", "2026-10-01T00:00:00Z"); put("deleted", false); put("rev", 1); put("deviceId", string("deviceId")); put("collapsed", true); put("color", "pink")
            put("rect", buildJsonObject { put("x", .8); put("y", .15); put("width", .05); put("height", .05) })
        }
        app.database.annotations().upsert(WireJson.annotationEntity(memo, false))
        control(buildJsonObject { put("textUnavailable", true) })
        open(); native.type("Search titles, authors and tags", row.title!!); native.click("Read")
        native.waitFor("mounted cached paper") { native.findSurface() != null }
        native.waitFor("explicit mounted page retry") { native.node("Retry original text · page 1") != null }
        val before = native.findSurface()!!; native.capture("reader-text-unavailable")
        control(buildJsonObject { put("textUnavailable", false) }); native.click("Retry original text · page 1")
        waitUntil { app.database.reader().textPage(row.pdfSha256!!, PDF_TEXT_LAYOUT_VERSION, 1) != null }
        native.waitFor("retry dismissed") { native.node("Retry original text · page 1") == null }; assertEquals(before, native.findSurface())
        val layout = WireJson.format.decodeFromString<PdfTextLayout>(app.database.reader().textPage(row.pdfSha256!!, PDF_TEXT_LAYOUT_VERSION, 1)!!.json).verifiedPage(key, row.pdfSha256!!, 1, row.pageCount!!)!!
        val geometry = OriginalTextGeometry(layout); val range = geometry.range(4, 7)!!
        val startQuad = range.displayQuads.first(); val endQuad = range.displayQuads.last()
        val x = startQuad.map { it.x }.average().toFloat(); val y = startQuad.map { it.y }.average().toFloat()
        val endX = endQuad.map { it.x }.average().toFloat(); val endY = endQuad.map { it.y }.average().toFloat()
        native.event(MotionEvent.ACTION_DOWN, before.left + x * before.width(), before.top + y * before.height(), MotionEvent.TOOL_TYPE_FINGER)
        SystemClock.sleep(450)
        native.event(MotionEvent.ACTION_MOVE, before.left + endX * before.width(), before.top + endY * before.height(), MotionEvent.TOOL_TYPE_FINGER)
        native.event(MotionEvent.ACTION_UP, before.left + endX * before.width(), before.top + endY * before.height(), MotionEvent.TOOL_TYPE_FINGER)
        native.waitFor("legal selected range") { native.node("iii", true) != null }; native.click("Copy")
        var clip = ""; native.onMain { clip = (it.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).primaryClip?.getItemAt(0)?.text?.toString().orEmpty() }
        assertEquals("iii", clip)
        native.click("Quote / explain"); native.waitFor("quote context") { native.node("iii", true) != null }
        assertEquals(memo.toString(), app.database.annotations().get("D-stage4-retained-memo")!!.json)
        assertEquals(before, native.findSurface()); native.capture("reader-recovered-quote")
        Log.i("DiscoveryNativeQA", "PASS mounted actual HTTP retry hash=${row.pdfSha256} page=1 range=[4,7) copy=iii viewport=$before unchanged; memo bytes retained")
    }

    @Test fun actualRelated429TimeoutRetainsRowsAndIdentityScopedCache(): Unit = runBlocking {
        val feed = WireJson.format.decodeFromString<DiscoveryFeed>(app.discovery.refreshFeed().toString())
        val card = feed.papers().first { it.arxivId == "1706.03762" }; app.discovery.save(card); app.discovery.flush()
        val row = app.database.library().all().first { matchesPublication(card, it) }; val resource = relatedResource(row)
        val ready = WireJson.format.decodeFromString<RelatedPapers>(app.discovery.refresh(resource, "/api/papers/${row.paperKey}/related").toString())
        assertTrue(ready.items.isNotEmpty()); assertTrue(ready.items.any { "cites" in it.relations || it.relation == "cites" }); assertTrue(ready.items.any { "citedBy" in it.relations || it.relation == "citedBy" })
        control(buildJsonObject { put("provider", "429") })
        val limited = WireJson.format.decodeFromString<RelatedPapers>(app.discovery.refresh(resource, "/api/papers/${row.paperKey}/related").toString())
        assertTrue(limited.items.isNotEmpty()); assertEquals("stale", limited.status); assertTrue(limited.providerStatus.any { it.state == "rate_limited" })
        delay(1300); control(buildJsonObject { put("provider", "timeout") })
        val timeout = WireJson.format.decodeFromString<RelatedPapers>(app.discovery.refresh(resource, "/api/papers/${row.paperKey}/related").toString())
        assertTrue(timeout.items.isNotEmpty()); assertTrue(timeout.providerStatus.any { it.state == "timeout" }); assertEquals(limited.fetchedAt, timeout.fetchedAt)
        app.metadata.patchPaper(row.paperKey, buildJsonObject { put("title", "D changed bibliographic identity") })
        assertNotEquals(resource, relatedResource(app.database.library().get(row.paperKey)!!))
        assertNull(app.database.discovery().get(discoveryScope(app.credentials.load()), relatedResource(app.database.library().get(row.paperKey)!!)))
        control(buildJsonObject { put("provider", "ready") })
        // Restore through a normal queued edit, retaining both receipts for the real sync gate.
        app.metadata.patchPaper(row.paperKey, buildJsonObject { put("title", card.title) })
        Log.i("DiscoveryNativeQA", "PASS real Hub provider429/timeout stale useful rows with actual fetch time and edited-identity isolation")
    }

    @Test fun actualMetadataPdfAssociationPreservesFoldersHistoryNotesAndOfflineRead(): Unit = runBlocking {
        val publication = WireJson.format.decodeFromString<DiscoveryFeed>(app.discovery.refreshFeed().toString()).papers().first { it.arxivId == "1706.03762" }
        app.discovery.save(publication); app.discovery.flush()
        val saved = app.database.library().all().first { matchesPublication(publication, it) }
        val key = saved.paperKey
        val db = androidx.room.Room.inMemoryDatabaseBuilder(app, FractalDatabase::class.java).build()
        val synced = SyncEngine(db, app.client); val metadata = MetadataStore(db) { string("deviceId") }
        val historyId = "D-prelink-history-${UUID.randomUUID()}"
        val memoId = UUID.randomUUID().toString()
        val now = java.time.Instant.now().toString()
        try {
            db.library().upsert(saved)
            val folder = metadata.folder("D discovery acquisition ${UUID.randomUUID().toString().take(8)}", null)
            metadata.patchPaper(key, buildJsonObject { put("tags", JsonArray(listOf(JsonPrimitive("D representative")))); put("collections", JsonArray(listOf(JsonPrimitive(folder)))) })
            metadata.settledHistory(buildJsonObject {
                put("id", historyId); put("paperKey", key); put("kind", "question"); put("question", "QA retained pre-link question"); put("text", "Complete pre-link retained answer")
                put("status", "completed"); put("createdAt", now); put("updatedAt", now); put("completedAt", now); put("requestId", JsonNull)
                put("context", buildJsonObject {}); put("answer", JsonNull); put("error", JsonNull); put("rev", 0); put("deviceId", string("deviceId")); put("deleted", false)
            })
            repeat(8) { if (db.metadata().pending().isNotEmpty()) synced.syncOnce() }
            assertTrue("Actual folder/history CAS receipts drain", db.metadata().pending().isEmpty())
            val before = remoteLibrary().first { it.text("paperKey") == key }
            val bytes = File("/data/local/tmp/fractal-D-attention.pdf").readBytes()
            assertEquals("bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697", java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
            val linked = app.client.linkPdf(key, bytes); assertEquals(key, linked.text("paperKey")); assertEquals("true", linked.text("hasPdf"))
            val after = linked.getValue("record").jsonObject
            assertEquals(before["tags"], after["tags"]); assertEquals(before["collections"], after["collections"]); assertNull(after.text("lastReadAt"))
            app.sync.acceptPaper(after); val identity = app.sync.refreshPaperMetadata(key)!!; app.downloader.download(key, identity.first)
            assertArrayEquals(bytes, app.cache.file(identity.first).readBytes())
            val memo = buildJsonObject {
                put("id", memoId); put("paperKey", key); put("kind", "memo"); put("page", 1); put("text", "Full retained original-paper note"); put("quote", "Attention Is All You Need")
                put("rect", buildJsonObject { put("x", .7); put("y", .16); put("width", .05); put("height", .05) }); put("color", "pink"); put("collapsed", true)
                put("updatedAt", now); put("deleted", false); put("rev", 0); put("deviceId", string("deviceId"))
                put("provenance", buildJsonObject { put("textSource", "original"); put("coordinateSpace", "rendered-page-normalized-v1"); put("pdfSha256", identity.first) })
            }
            synced.saveLocal(memo); synced.syncOnce(); assertFalse(db.annotations().get(memoId)!!.dirty)
            val repeated = app.client.linkPdf(key, bytes); assertEquals(key, repeated.text("paperKey")); assertEquals(identity.first, repeated.getValue("paper").jsonObject.text("pdfSha256"))
            val history = app.client.data("/api/papers/$key/history").jsonObject.getValue("history").jsonArray
            assertTrue(history.any { it.jsonObject.text("id") == historyId && it.jsonObject.text("text") == "Complete pre-link retained answer" })
            val serverNotes = app.client.data("/api/papers/$key/annotations").jsonArray
            assertTrue(serverNotes.any { it.jsonObject.text("id") == memoId && it.jsonObject.text("text") == "Full retained original-paper note" })
            app.database.annotations().upsert(db.annotations().get(memoId)!!)
            app.history.refresh(key)
            // Unsave is independent of acquisition; restore Saved without a read event.
            metadata.save(key, false); synced.syncOnce(); assertEquals("false", remoteLibrary().first { it.text("paperKey") == key }.text("saved"))
            metadata.save(key, true); synced.syncOnce(); app.sync.acceptPaper(remoteLibrary().first { it.text("paperKey") == key })
            app.database.reader().upsert(ReaderPositionEntity(key, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}"))
            control(buildJsonObject { put("offline", true) })
            open(); native.type("Search titles, authors and tags", publication.title); native.click("Read")
            native.waitFor("cached real publication PDF") { native.findSurface() != null }; native.capture("reader-real-publication-offline")
            scenario.recreate(); native.waitFor("cached real publication after restart") { native.findSurface() != null }; native.capture("reader-real-publication-recreated")
            assertArrayEquals(bytes, app.cache.file(identity.first).readBytes()); assertEquals("Full retained original-paper note", WireJson.format.parseToJsonElement(app.database.annotations().get(memoId)!!.json).jsonObject.text("text"))
            control(buildJsonObject { put("offline", false) })
            Log.i("DiscoveryNativeQA", "PASS actual stable metadata-to-PDF identity=$key hash=${identity.first}, folders/tags/history/memo/idempotent link/unsave and cached real original read/recreate")
        } finally { db.close() }
    }

    @Test fun capturesCurrentScholarlyDestinations(): Unit = runBlocking {
        val ko = InstrumentationRegistry.getArguments().getString("captureLanguage") == "ko"
        fun label(en: String, korean: String) = if (ko) korean else en
        // Real reported metadata is admitted through production routes, never embedded in product UI.
        val feed = WireJson.format.decodeFromString<DiscoveryFeed>(app.discovery.refreshFeed().toString())
        feed.papers().forEach { app.discovery.save(it) }; app.discovery.flush()
        open(); native.click(label("Discover", "발견")); native.waitFor("discovery heading") { native.node(label("Discovery desk", "논문 발견")) != null }; native.capture("discover-index"); native.scrollTo("LoRA: Low-Rank Adaptation of Large Language Models")
        native.click("LoRA: Low-Rank Adaptation of Large Language Models"); native.capture("discover-dossier"); native.click(label("Back", "뒤로"))
        native.click(label("News", "뉴스")); native.waitFor("news list") { native.node("QA research field report:", true) != null }; native.capture("news-index")
        native.click("QA research field report:", true); native.waitFor("article header") { native.node(label("News article", "뉴스 기사")) != null }; native.capture("news-article")
        native.scrollTo("This isolated QA article tests", true, .8f); native.capture("news-article-body"); native.scrollToTop()
        if (ko) {
            native.scrollTo("기사·제목 번역", xFraction = .8f); native.click("기사·제목 번역")
            native.waitFor("complete cached article translation") { native.node("기계 번역") != null }; native.capture("news-article-translated")
            native.scrollTo("QA 기계 번역: This isolated QA article tests", true, .8f); native.capture("news-article-translated-body"); native.scrollToTop()
        }
        native.click(label("Back", "뒤로")); native.click(label("Topics", "주제")); native.capture("topics-index")
        if (InstrumentationRegistry.getArguments().getString("captureProfile") == "phone360-portrait") {
            val taxonomy = WireJson.format.decodeFromString<TaxonomyResponse>(app.database.discovery().get(discoveryScope(app.credentials.load()), "taxonomy")!!.json).items
            native.click("Field"); native.capture("field-selector-selected")
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_DOWN)
            InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ENTER)
            val next = taxonomy[1]; native.waitFor("keyboard-selected actual field") { native.node("${next.name["en"]} · ${next.code}") != null }
            waitUntil { app.database.discovery().get(discoveryScope(app.credentials.load()), "topics:${next.code}") != null }
            native.capture("topics-keyboard-selected")
        }
        native.click(label("Library", "서재"))
        val searchLabel = label("Search titles, authors and tags", "제목·저자·태그 검색")
        if (native.node(searchLabel) == null) { native.click(label("Search", "검색")); native.type(searchLabel, "D representative"); native.click(label("Done", "완료")) }
        else native.type(searchLabel, "D representative")
        native.scrollTo("Attention Is All You Need"); native.capture("library-index")
    }

    @Test fun restoresOwnedQaProfile() {
        check(InstrumentationRegistry.getArguments().getString("captureTheme") == "Light")
        check(InstrumentationRegistry.getArguments().getString("captureLanguage") == "en")
        open()
        assertEquals("Light", app.settings.getString("theme", null))
        assertEquals(1f, app.resources.configuration.fontScale)
        native.capture("restored-owned-profile")
    }

    @Test fun capturesCurrentNewsArticleSourceFallback(): Unit = runBlocking {
        val ko = InstrumentationRegistry.getArguments().getString("captureLanguage") == "ko"
        fun label(en: String, korean: String) = if (ko) korean else en
        val feed = WireJson.format.decodeFromString<DiscoveryFeed>(app.database.discovery().get(discoveryScope(app.credentials.load()), "feed")!!.json)
        val paper = feed.news().first { it.title.startsWith("QA research field report:") }
        open(); native.click(label("News", "뉴스")); native.click(paper.title)
        native.waitFor("article header") { native.node(label("News article", "뉴스 기사")) != null }
        val article = WireJson.format.decodeFromString<NewsArticle>(app.database.discovery().get(discoveryScope(app.credentials.load()), "article:${paper.url}")!!.json)
        val expectedSource = article.siteName?.takeIf { it.isNotBlank() }
            ?: (label("Feed · ", "피드 · ") + paper.source.substringBefore(',').trim())
        native.waitFor("honest article source metadata") { native.node(expectedSource, true) != null }
        assertNull(native.node(paper.source))
        native.scrollTo(label("Translate article / title", "기사·제목 번역"), xFraction = .8f)
        native.click(label("Translate article / title", "기사·제목 번역"))
        native.waitFor("cached complete article translation") { native.node(label("Machine translation", "기계 번역")) != null }
        native.scrollToTop(.8f); native.capture("news-article-translated-source-final")
        native.scrollTo("QA 기계 번역: This isolated QA article tests", true, .8f)
        native.capture("news-article-translated-body-final")
    }

    @Test fun processColdOfflineCachedFeedArticleAndOriginalPdf(): Unit = runBlocking {
        check(InstrumentationRegistry.getArguments().getString("offlineLaunch") == "true")
        open(); native.click("Discover"); native.waitFor("cold cached feed") { native.node("Discovery desk") != null }
        native.scrollTo("LoRA: Low-Rank Adaptation of Large Language Models"); native.capture("cold-offline-discovery")
        native.click("News"); native.waitFor("cold cached news") { native.node("QA research field report:", true) != null }
        native.click("QA research field report:", true); native.waitFor("cold cached body") { native.node("This isolated QA article tests", true) != null }
        native.capture("cold-offline-article"); native.click("Back"); native.click("Library")
        native.type("Search titles, authors and tags", "Attention Is All You Need"); native.click("Read")
        native.waitFor("cold cached actual PDF") { native.findSurface() != null }; native.capture("cold-offline-original")
        Log.i("DiscoveryNativeQA", "PASS process-cold offline launch cached discovery/news/full article/actual original PDF pid=${android.os.Process.myPid()}")
    }

    @Test fun articleUnavailableTitleOnlyTranslationOriginalLanguageAndOfflineCache(): Unit = runBlocking {
        val hubScope = discoveryScope(app.credentials.load())
        val originalFeedSettings = app.client.data("/api/feed/settings").jsonObject
        val preferences = app.client.data("/api/preferences").jsonObject
        var originalArticle: DiscoveryCacheEntity? = null
        try {
            app.client.data("/api/preferences", "PUT", JsonObject(preferences + ("uiLanguage" to JsonPrimitive("ko"))))
            app.client.data("/api/feed/settings", "PUT", JsonObject(originalFeedSettings + ("translateNewsTitles" to JsonPrimitive(true))))
            val feed = WireJson.format.decodeFromString<DiscoveryFeed>(app.discovery.refreshFeed(true).toString())
            val card = feed.news().first { it.title.startsWith("QA research field report:") }
            check(card.titleTranslated?.startsWith("QA 연구 분야 소식:") == true) { "Actual Hub feed title translation must pre-exist this fallback" }
            val articleKey = "article:${card.url}"
            originalArticle = app.database.discovery().get(hubScope, articleKey)
            withContext(Dispatchers.IO) { app.database.openHelper.writableDatabase.execSQL("DELETE FROM discovery_cache WHERE scope=? AND resource=?", arrayOf(hubScope, articleKey)) }
            app.settings.edit().putString("newsLanguage", "ko").commit()
            control(buildJsonObject { put("articleUnavailable", true) })
            open(); native.click("News"); native.waitFor("prefetched feed title") { native.node("QA 연구 분야 소식:", true) != null }; native.click("QA 연구 분야 소식:", true)
            native.waitFor("actual original title") { native.node(card.title) != null }
            native.scrollTo("Translate article / title"); native.click("Translate article / title")
            native.waitFor("title-only KO result") { native.node("Machine-translated title only") != null && native.node("QA 연구 분야 소식:", true) != null }
            native.capture("news-title-only-ko"); native.click("Show original"); native.waitFor("original restored") { native.node(card.title) != null && native.node("Machine-translated title only") == null }
            native.click("Translation language"); native.click("Japanese"); native.click("Translate article / title")
            native.waitFor("current target JA title") { native.node("QA研究分野ニュース：", true) != null }; native.capture("news-title-only-ja")
            control(buildJsonObject { put("offline", true) }); scenario.recreate()
            native.waitFor("offline target-specific retained title") { native.node("QA研究分野ニュース：", true) != null && native.node("Machine-translated title only") != null }
            native.capture("news-title-only-ja-offline"); native.click("Show original"); native.waitFor("offline source title") { native.node(card.title) != null }
            Log.i("DiscoveryNativeQA", "PASS actual prefetched feed translation, article-only503 with reachable quick route, explicit title-only KO/JA, original restoration and target-specific offline recreation")
        } finally {
            control(buildJsonObject { put("offline", false); put("articleUnavailable", false) })
            originalArticle?.let { app.database.discovery().upsert(it) }
            app.client.data("/api/preferences", "PUT", preferences); app.client.data("/api/feed/settings", "PUT", originalFeedSettings)
            app.settings.edit().putString("newsLanguage", "ko").commit(); app.discovery.refreshFeed(true)
        }
    }
}
