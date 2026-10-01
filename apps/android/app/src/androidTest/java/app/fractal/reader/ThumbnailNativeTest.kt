package app.fractal.reader

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.semantics.SemanticsActions
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
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Opt-in exclusive 5572 fixture; ordinary Activity + real Hub bytes, never a replacement UI. */
class ThumbnailNativeTest {
    private val app get() = ApplicationProvider.getApplicationContext<ReaderApplication>()
    private lateinit var paired: HubCredentials
    private lateinit var feed: DiscoveryFeed
    private var scenario: ActivityScenario<MainActivity>? = null
    @Before fun connect(): Unit = runBlocking {
        val documentation = InstrumentationRegistry.getArguments().getString("documentation") == "true"
        val config = File(if (documentation) "/data/local/tmp/fractal-v020-thumbnails-private-documentation.json" else "/data/local/tmp/fractal-v020-thumbnails-private.json")
        Assume.assumeTrue("Requires exclusive thumbnail helper", config.isFile)
        val json = WireJson.format.parseToJsonElement(config.readText()).jsonObject
        fun value(name: String) = json.getValue(name).jsonPrimitive.content
        check(value("hubId") == "v020-thumbnails-exclusive-5572")
        paired = HubCredentials(value("baseUrl"), "Thumbnail QA", value("hubId"), value("deviceId"), value("deviceToken"))
        app.credentials.save(paired)
        app.settings.edit().putBoolean("languageIntroDone", true).putBoolean("autoDownload", false).putString("theme", "Sepia").commit()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { setAppLanguage(app, "en", explicit = true) }
        app.discovery.refresh("taxonomy", "/api/feed/categories")
        app.discovery.refresh("interests", "/api/feed/interests")
        feed = WireJson.format.decodeFromString(app.discovery.refreshFeed().toString())
    }
    @After fun finish() { if (scenario != null) capture("end"); scenario?.close(); app.credentials.save(paired) }
    private fun capture(name: String) {
        SystemClock.sleep(450)
        val instrument = InstrumentationRegistry.getInstrumentation()
        val screen = instrument.uiAutomation.takeScreenshot()
        val profile = InstrumentationRegistry.getArguments().getString("captureProfile") ?: "native"
        val directory = File(app.getExternalFilesDir(null), "v020-thumbnails/$profile").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { screen.compress(Bitmap.CompressFormat.PNG, 100, it) }
        screen.recycle(); Log.i("ThumbnailNativeQA", "capture=$profile/$name")
    }
    @Test fun capturesPublicationDocumentation(): Unit = runBlocking {
        Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("documentation") == "true")
        val paper = feed.papers().first { it.id == "qa-paper" }
        val news = feed.news().first { it.id == "qa-news" }
        assertEquals("WorldAuditBench: Interactive 3D World Auditing with Multimodal Agents", paper.title)
        assertEquals(8, paper.authors.size)
        assertTrue(app.discoveryImages.load(paper.image!!.url, paired) {}.width in 1..1024)
        assertTrue(app.discoveryImages.load(news.image!!.url, paired) {}.height in 1..1024)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        val native = NativeDeskDriver(scenario!!)
        scenario!!.onActivity { setAppLanguage(app, "en", explicit = true) }
        native.click("Discover"); native.scrollToTop()
        native.waitFor("actual publication image") { native.node(paper.image!!.alt!!) != null }
        capture("paper-index")
        native.click(paper.image!!.alt!!); native.waitFor("paper dossier") { native.node("Paper dossier") != null }
        capture("paper-dossier")
        native.click("Back"); native.click("News"); native.scrollToTop()
        native.waitFor("actual article image") { native.node(news.image!!.alt!!) != null }
        capture("news-index")
        native.click(news.image!!.alt!!); native.waitFor("article dossier") { native.node("News article") != null }
        capture("news-dossier")
        assertTrue(app.database.library().all().isEmpty())
        assertTrue(app.database.discovery().pending(discoveryScope(paired)).isEmpty())
        Log.i("ThumbnailNativeQA", "documentation actual publication metadata and public bytes; no Save or Read invocation")
    }
    @Test fun capturesActualImagesAndCompactFallbacks(): Unit = runBlocking {
        val papers = feed.papers(); val paper = papers.first { it.id == "qa-paper" }; val news = feed.news().first { it.id == "qa-news" }
        // Decode through current authenticated transport first, then observe actual screen content.
        assertTrue(app.discoveryImages.load(paper.image!!.url, paired) {}.width in 1..1024)
        assertTrue(app.discoveryImages.load(news.image!!.url, paired) {}.height in 1..1024)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        val native = NativeDeskDriver(scenario!!)
        val listX = if (app.resources.configuration.screenWidthDp >= 840) .25f else .5f
        fun show(label: String, xFraction: Float = listX) {
            try { native.scrollTo(label, xFraction = xFraction) } catch (failure: IllegalStateException) {
                val node = native.node(label)
                val height = app.resources.displayMetrics.heightPixels
                check(node != null && node.boundsInWindow.top > 24 && node.boundsInWindow.bottom < height * .94f) { failure.message.orEmpty() }
            }
        }
        fun indexRow(id: String, newsIndex: Boolean = false) {
            val rows = if (newsIndex) feed.news() else feed.papers()
            val index = rows.indexOfFirst { it.id == id } + 1 // Header is the first LazyColumn item.
            check(index > 0)
            val list = native.nodes().first { it.config.contains(SemanticsActions.ScrollToIndex) }
            native.onMain { check(list.config[SemanticsActions.ScrollToIndex].action!!.invoke(index)) }
            SystemClock.sleep(550)
        }
        scenario!!.onActivity { setAppLanguage(app, "en", explicit = true) }
        native.click("Discover"); indexRow("qa-paper"); native.waitFor("paper image") { native.node(paper.image!!.alt!!) != null }
        show(paper.title); capture("paper-index")
        native.click(paper.image!!.alt!!); native.waitFor("same paper dossier") { native.node("Paper dossier") != null }
        capture("paper-dossier")
        show("Read PDF", xFraction = .8f); capture("paper-dossier-actions")
        native.click("Back"); native.scrollToTop(xFraction = listX)
        indexRow("qa-absent"); capture("paper-absent")
        indexRow("qa-broken"); capture("paper-broken")
        native.click("News"); indexRow("qa-news", true); native.waitFor("news image") { native.node(news.image!!.alt!!) != null }
        show(news.title); capture("news-index")
        native.click(news.image!!.alt!!); native.waitFor("news article") { native.node("News article") != null }
        // Actual public HTML extracted by the backend worker into this isolated Hub cache.
        native.waitFor("article image") { native.nodes().any { it.config.contains(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription) } }
        capture("news-dossier")
        native.click("Back"); native.scrollToTop(xFraction = listX)
        indexRow("qa-news-absent", true); capture("news-absent")
        indexRow("qa-news-broken", true); capture("news-broken")
        assertTrue(app.database.library().all().isEmpty())
        assertTrue(app.database.discovery().pending(discoveryScope(paired)).isEmpty())
        Log.i("ThumbnailNativeQA", "actual public paper/news bytes rendered; no Save or Read invocation")
    }

    @Test fun rejectsRoutesAndCancelsDiscardedCapturedSession(): Unit = runBlocking {
        val path = feed.papers().first { it.id == "qa-paper" }.image!!.url
        val bytes = app.client.captured().feedImage(path)
        assertEquals(3086692, bytes.size)
        for (bad in listOf("https://publisher.org/p.png", "$path?x=1", "$path/..", "//hub$path")) {
            assertNull(validatedFeedImagePath(bad))
            assertTrue(runCatching { app.client.captured().feedImage(bad) }.isFailure)
        }
        assertNotEquals(imageSessionIdentity(paired), imageSessionIdentity(paired.copy(token = "replacement")))
        assertNotEquals(imageSessionIdentity(paired), imageSessionIdentity(paired.copy(url = paired.url + "/other")))
        val before = File(app.cacheDir, "discovery-images").listFiles()?.map { it.name }?.toSet().orEmpty()
        val accepted = CountDownLatch(1)
        val server = ServerSocket(0)
        val remote = paired.copy(url = "http://127.0.0.1:${server.localPort}", hubId = "delayed-thumbnail-owned")
        val worker = thread(name = "thumbnail-owned-delayed-response") {
            server.use { listener -> listener.accept().use { socket ->
                val input = socket.getInputStream().bufferedReader()
                var authorization = false
                while (true) { val line = input.readLine() ?: break; if (line.isEmpty()) break
                    if (line.equals("Authorization: Bearer ${remote.token}", ignoreCase = true)) authorization = true
                }
                check(authorization); accepted.countDown()
                Thread.sleep(500)
                runCatching { socket.getOutputStream().apply {
                    write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(bytes); flush()
                } }
            } }
        }
        app.credentials.save(remote)
        var mounted = true
        val pending = async(Dispatchers.Default) { app.discoveryImages.load(path, remote) { check(mounted) } }
        assertTrue(accepted.await(5, TimeUnit.SECONDS))
        mounted = false; app.credentials.save(paired)
        val started = SystemClock.uptimeMillis(); pending.cancelAndJoin()
        assertTrue(SystemClock.uptimeMillis() - started < 1500)
        worker.join(3000); assertFalse(worker.isAlive)
        assertEquals(before, File(app.cacheDir, "discovery-images").listFiles()?.map { it.name }?.toSet().orEmpty())
        assertTrue(app.database.library().all().isEmpty())
        Log.i("ThumbnailNativeQA", "validated paths, credential identities, cancelled delayed session, no stale cache admission")
    }
}
