package app.fractal.reader

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Ordinary MainActivity, actual Hub/Room/downloader/cache. No replacement composition. */
class PublicationAcquisitionNativeTest {
    private val app get() = ApplicationProvider.getApplicationContext<ReaderApplication>()
    private lateinit var config: JsonObject
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var native: NativeDeskDriver
    private fun value(name: String) = config.getValue(name).jsonPrimitive.content
    private val available = DiscoveryPaper(id = "acq-public", title = "Scikit-learn: Machine Learning in Python",
        authors = listOf("Fabian Pedregosa", "Gaël Varoquaux"), source = "user", year = 2011,
        url = "https://jmlr.org/papers/v12/pedregosa11a.html", publication = PublicationMetadata(year = 2011,
            venue = "Journal of Machine Learning Research", publicationKind = "journal", oaAvailability = "open", sources = listOf("user")))
    private val savedPaper = DiscoveryPaper(id = "acq-saved", title = "Dropout: A Simple Way to Prevent Neural Networks from Overfitting",
        authors = listOf("Nitish Srivastava", "Geoffrey Hinton"), source = "user", year = 2014,
        url = "https://jmlr.org/papers/v15/srivastava14a.html", publication = PublicationMetadata(year = 2014,
            venue = "Journal of Machine Learning Research", publicationKind = "journal", oaAvailability = "open",
            oaPdfUrl = "https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf", sources = listOf("user")))
    private val failurePaper = DiscoveryPaper(id = "acq-failure", title = "Controlled unavailable publication",
        url = "https://jmlr.org/qa-acquisition-login", source = "user", publication = PublicationMetadata(
            oaAvailability = "open", oaPdfUrl = "https://jmlr.org/qa-acquisition-login.pdf", sources = listOf("user")))
    @Before fun setup(): Unit = runBlocking {
        val file = File("/data/local/tmp/fractal-pdf-acquisition-private.json")
        Assume.assumeTrue("Requires fresh owned 5562 acquisition profile", file.isFile)
        config = WireJson.format.parseToJsonElement(file.readText()).jsonObject
        check(value("hubId") == "pdf-acquisition-owned-5562")
        app.credentials.save(HubCredentials(value("baseUrl"), "Owned PDF acquisition QA", value("hubId"), value("deviceId"), value("deviceToken")))
        app.settings.edit().putBoolean("languageIntroDone", true).putBoolean("autoDownload", false).commit()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { setAppLanguage(app, "en", explicit = true) }
        control(buildJsonObject { put("offline", false); put("oldHub", false); put("loginHtml", false); put("delayOpen", false); put("release", true) })
        val feed = DiscoveryFeed("2026-W40", sections = FeedSections(top = listOf(available, savedPaper, failurePaper)))
        app.discovery.cache("feed", WireJson.format.encodeToJsonElement(feed))
        app.discovery.cache("taxonomy", buildJsonObject { put("items", JsonArray(emptyList())) })
    }
    @After fun finish(): Unit = runBlocking {
        if (::scenario.isInitialized) scenario.close()
        if (::config.isInitialized) control(buildJsonObject { put("offline", false); put("oldHub", false); put("loginHtml", false); put("delayOpen", false); put("release", true) })
    }
    private suspend fun control(body: JsonObject? = null): JsonObject = withContext(Dispatchers.IO) {
        val connection = URL("http://127.0.0.1:${value("controlPort")}/qa/${if (body == null) "state" else "mode"}").openConnection() as HttpURLConnection
        if (body != null) { connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray()) } }
        check(connection.responseCode == 200)
        val result = WireJsonAdapter.data(connection.inputStream.bufferedReader().use { it.readText() }).jsonObject
        connection.disconnect(); result
    }
    private fun launch() {
        scenario = ActivityScenario.launch(MainActivity::class.java); native = NativeDeskDriver(scenario)
        scenario.onActivity { setAppLanguage(app, "en", explicit = true) }
        native.waitFor("real MainActivity desk") { native.node("Discover") != null }
    }
    private fun dossier(paper: DiscoveryPaper) {
        native.click("Discover"); native.scrollTo(paper.title); native.click(paper.title); native.scrollTo("Read PDF")
    }
    private suspend fun until(label: String, condition: suspend () -> Boolean) = withTimeout(60000) {
        while (!condition()) delay(100); Log.i("PdfAcquisitionQA", "observed=$label")
    }
    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation(); SystemClock.sleep(500)
        val shot = instrumentation.uiAutomation.takeScreenshot()
        val directory = File(app.getExternalFilesDir(null), "pdf-acquisition/${InstrumentationRegistry.getArguments().getString("captureProfile") ?: "native"}").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }; shot.recycle()
    }
    private suspend fun row(paper: DiscoveryPaper) = app.database.library().all().firstOrNull { matchesPublication(paper, it) }

    @Test fun a_unbookmarkedPublicPublisherPdfReadsUnsavedAndReopensCachedOffline(): Unit = runBlocking {
        assertNull(row(available)); launch(); dossier(available); capture("unbookmarked-read-action")
        native.click("Read PDF")
        until("verified PDF cache") { row(available)?.pdfSha256?.let(app.cache::contains) == true }
        native.waitFor("original native reader") { native.findSurface() != null }
        until("Recent after reader only") { row(available)?.lastReadAt != null }
        val record = row(available)!!; assertFalse(record.saved)
        val bytes = app.cache.file(record.pdfSha256!!).readBytes()
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        assertEquals(record.pdfSha256, hash)
        val remotePdf = control().getValue("pdfs").jsonArray.map { it.jsonObject }.first { it.text("paperKey") == record.paperKey }
        assertEquals(remotePdf.text("sha256"), hash); assertEquals(remotePdf.getValue("bytes").jsonPrimitive.int, bytes.size)
        capture("actual-unsaved-reader")
        control(buildJsonObject { put("offline", true) }); scenario.recreate()
        native.waitFor("offline original reader recreation") { native.findSurface() != null }; capture("cached-offline-reader")
        assertFalse(row(available)!!.saved)
        Log.i("PdfAcquisitionQA", "PASS public publisher no reported URL -> actual reader, key=${record.paperKey}, bytes=${bytes.size}, sha256=$hash, unsaved=true, offline=true")
    }

    @Test fun b_savedMetadataAcquiresWithoutLosingNestedFoldersTagsMemoHistory(): Unit = runBlocking {
        val response = app.client.data("/api/library/bookmarks", "POST", savedPaper.bookmarkBody()).jsonObject
        val key = response.text("paperKey")!!; app.sync.acceptPaper(response.getValue("record").jsonObject)
        assertNull(app.database.library().get(key)!!.pdfSha256)
        val parent = app.metadata.folder("Owned parent", null); val child = app.metadata.folder("Owned nested folder", parent)
        app.metadata.patchPaper(key, buildJsonObject { put("tags", JsonArray(listOf(JsonPrimitive("preserve-me")))); put("collections", JsonArray(listOf(JsonPrimitive(child)))) })
        val memo = WireJson.annotationEntity(WireJson.format.parseToJsonElement("""{"id":"acquisition-retained-memo","paperKey":"$key","kind":"memo","page":1,"text":"Full durable memo body","quote":"Separate retained quote","rev":2,"deleted":false}""").jsonObject, true)
        app.database.annotations().upsert(memo)
        app.database.reader().upsert(ReaderPositionEntity(key, "{\"page\":1,\"fraction\":0,\"mode\":\"original\"}"))
        val position = app.database.reader().position(key)
        launch(); dossier(savedPaper); capture("saved-metadata-read-action"); native.click("Read PDF")
        native.waitFor("saved acquired original reader") { native.findSurface() != null }
        val record = app.database.library().get(key)!!; val retained = WireJson.format.decodeFromString<LibraryRecord>(record.json)
        assertTrue(record.saved); assertEquals(listOf("preserve-me"), retained.tags); assertEquals(listOf(child), retained.collections)
        assertEquals(parent, app.database.metadata().folders().first { it.id == child }.parentId)
        val currentMemo = app.database.annotations().get(memo.id)!!
        val originalNote = WireJson.format.parseToJsonElement(memo.json).jsonObject
        val retainedNote = WireJson.format.parseToJsonElement(currentMemo.json).jsonObject
        assertEquals(originalNote["text"], retainedNote["text"]); assertEquals(originalNote["quote"], retainedNote["quote"])
        assertNotNull(position); assertNotNull(app.database.reader().position(key))
        capture("saved-retained-reader")
        Log.i("PdfAcquisitionQA", "PASS saved metadata actual acquisition key=$key; saved/tags/nested-folder/memo/reader-position retained")
    }

    @Test fun c_oldHubAndLoginHtmlExposeRetryAndExplicitFallbackWithoutExternalLaunch(): Unit = runBlocking {
        launch(); dossier(failurePaper); control(buildJsonObject { put("oldHub", true) }); native.click("Read PDF")
        native.waitFor("old Hub truthful retry") { native.node("Retry Read PDF") != null }
        native.scrollTo("This Hub does not support Read PDF", true); capture("old-hub-explicit-fallback")
        assertNull(row(failurePaper)?.lastReadAt); assertFalse(row(failurePaper)?.saved == true)
        control(buildJsonObject { put("oldHub", false); put("loginHtml", true) }); native.click("Retry Read PDF")
        native.waitFor("login HTML acquisition finished") { native.node("Retry Read PDF") != null && native.node("Acquiring PDF…") == null }
        native.scrollTo("Use Retry Read PDF", true); capture("login-html-explicit-fallback")
        assertNull(row(failurePaper)?.pdfSha256); assertNull(row(failurePaper)?.lastReadAt); assertFalse(row(failurePaper)?.saved == true)
        native.onMain { assertTrue(it.hasWindowFocus()) }
        Log.i("PdfAcquisitionQA", "PASS controlled old-Hub and login HTML retry/source/manual fallback; no reader/save/external launch")
    }

    @Test fun d_actualHttpDelayedAccountAndRequestChangesRejectAllLateLocalEffects(): Unit = runBlocking {
        for (accountChange in listOf(true, false)) {
            val db = Room.inMemoryDatabaseBuilder(app, FractalDatabase::class.java).build()
            val paired = app.credentials.load()!!; var current = true
            val acquisition = PublicationAcquisition(app.client, SyncEngine(db, app.client), { discoveryScope(app.credentials.load()) }) { _, _, _, _ -> error("Late download must not run") }
            try {
                control(buildJsonObject { put("delayOpen", true) })
                val request = async(Dispatchers.IO) { runCatching { acquisition.open(available) { check(current) } } }
                until("actual response blocked") { control().getValue("blocked").jsonPrimitive.boolean }
                if (accountChange) app.credentials.save(paired.copy(deviceId = "different-device", token = "different-account-token")) else current = false
                control(buildJsonObject { put("release", true); put("delayOpen", false) })
                assertTrue(request.await().isFailure); assertTrue(db.library().all().isEmpty()); assertTrue(db.metadata().pending().isEmpty())
            } finally { app.credentials.save(paired); db.close() }
        }
        Log.i("PdfAcquisitionQA", "PASS actual HTTP same-Hub device/account change and superseded request; no late Room/download/navigation")
    }
}
