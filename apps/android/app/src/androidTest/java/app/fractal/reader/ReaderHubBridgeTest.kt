package app.fractal.reader

import android.util.Log
import android.view.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.pdf.*
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** Opt-in actual accepted local Hub fixture; E owns its lifecycle and its other device/dataset. */
class ReaderHubBridgeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = compose.activity.application as ReaderApplication
    private lateinit var config: JsonObject
    private lateinit var credentials: HubCredentials
    private lateinit var paper: LibraryEntity
    private val key = "D-reader-catalog"
    private var show by mutableStateOf(true)
    private fun string(json: JsonObject, name: String) = json[name]!!.jsonPrimitive.content
    @Before fun connectDesignatedFixture(): Unit = runBlocking {
        val private = File("/data/local/tmp/fractal-D-private.json")
        assumeTrue("Requires E's private disposable fixture and own5554 reverse", private.isFile)
        config = WireJson.format.parseToJsonElement(private.readText()).jsonObject
        assertNull("Must begin with an unpaired disposable emulator", app.credentials.load())
        // Delete only this suite's unrelated generated fixture queues before allowing actual HTTP sync.
        // Cached D Hub papers, annotations and history are deliberately retained.
        withContext(Dispatchers.IO) {
            val database = app.database.openHelper.writableDatabase
            for (fixture in listOf("gesture-fixture", "stage3-reader-fixture", "D-lifecycle-fixture")) {
                database.execSQL("DELETE FROM annotations WHERE paperKey = ?", arrayOf(fixture))
                database.execSQL("DELETE FROM metadata_mutations WHERE kind = 'paper' AND entityId = ?", arrayOf(fixture))
            }
        }
        assertTrue("No foreign dirty annotation may reach the disposable D Hub fixture", app.database.annotations().dirty().all { it.paperKey == key })
        assertTrue("Only D-designated fixtures may have unsent paper mutations", app.database.metadata().pending().all { it.kind != "paper" || it.entityId == key })
        credentials = HubCredentials(string(config, "baseUrl"), "Disposable native QA", "qa", string(config, "deviceId"), string(config, "deviceToken"))
        app.credentials.save(credentials)
        val remote = app.client.data("/api/library").jsonArray.first { it.jsonObject["paperKey"]?.jsonPrimitive?.content == key }.jsonObject
        val prior = app.database.library().get(key)
        paper = libraryEntity(remote, prior, false)
        app.database.library().upsert(paper)
        val identity = app.sync.refreshPaperMetadata(key)!!
        app.downloader.download(key, identity.first)
        paper = app.database.library().get(key)!!
        PdfPages(app.cache.file(identity.first)).use { pdf ->
            assertEquals(identity.first, pdf.pdfSha256)
            assertEquals(5, pdf.pageCount)
            for (page in 1..5) assertNotNull(app.originalText.page(key, pdf.pdfSha256, page, pdf.pageCount).page)
        }
        compose.runOnUiThread {
            val content = compose.activity.findViewById<ViewGroup>(android.R.id.content)
            fun dispose(v: View) { if (v is ComposeView) v.disposeComposition() else if (v is ViewGroup) repeat(v.childCount) { dispose(v.getChildAt(it)) } }
            repeat(content.childCount) { dispose(content.getChildAt(it)) }; content.removeAllViews()
        }
        compose.setContent { FractalTheme { if (show) ReaderScreen(app, paper, { show = false }) } }
        compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("Reading pane").fetchSemanticsNodes().isNotEmpty() }
        Log.i("ReaderBridgeQA", "connected accepted Hub, actual PDF hash/count/layout cached; process=${android.os.Process.myPid()}")
    }
    @After fun unpair() { app.credentials.clear() }
    private fun request(question: String, page: Int = 2): JsonObject = buildJsonObject {
        put("question", question); put("page", page); put("answerLanguage", "ko")
        put("selection", buildJsonObject { put("provider", "codex"); put("model", "gpt-6-sol") })
    }
    private suspend fun waitStatus(id: String, status: String) = withTimeout(15000) {
        while (app.database.reader().request(id)?.status != status) delay(50)
    }
    private suspend fun serverHistory(id: String) = app.client.data("/api/papers/$key/history/${HubClient.keyPath(id)}").jsonObject["history"]!!.jsonObject
    private suspend fun release(flight: String) = withContext(Dispatchers.IO) {
        require(flight.startsWith("D-FLIGHT-"))
        val connection = URL("http://127.0.0.1:${config["controlPort"]!!.jsonPrimitive.int}/D/release").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(buildJsonObject { put("flightId", flight) }.toString().toByteArray()) }
        assertEquals(200, connection.responseCode); connection.inputStream.close(); connection.disconnect()
    }
    private fun stateFile() = File(app.getExternalFilesDir(null), "D-bridge-restart.json")

    @Test fun dActualFigureFailureAndUiExplicitCancel(): Unit = runBlocking {
        val figureFlight = "D-FLIGHT-figure-${UUID.randomUUID()}"
        val bbox = buildJsonObject { put("x", .12); put("y", .12); put("width", .4); put("height", .3) }
        val png = withContext(Dispatchers.IO) { PdfPages(app.cache.file(paper.pdfSha256!!)).use { pdf ->
            val bitmap = pdf.bitmap(0, 900)
            val crop = android.graphics.Bitmap.createBitmap(bitmap, (bitmap.width * .12).toInt(), (bitmap.height * .12).toInt(), (bitmap.width * .4).toInt(), (bitmap.height * .3).toInt())
            val out = java.io.ByteArrayOutputStream(); crop.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out); crop.recycle()
            android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
        } }
        val body = buildJsonObject {
            put("kind", "figure"); put("page", 1); put("bbox", bbox); put("croppedPngBase64", png)
            put("surroundingText", "$figureFlight QA_WAIT Deliberate physical source region")
            put("answerLanguage", "en"); put("selection", buildJsonObject { put("provider", "codex"); put("model", "gpt-6-sol") })
            put("provenance", buildJsonObject { put("coordinateSpace", "rendered-page-normalized-v1"); put("textSource", "original"); put("pdfSha256", paper.pdfSha256) })
        }
        val id = app.history.create(key, "explanation", body, buildJsonObject { put("page", 1); put("origin", "original"); put("text", "Deliberate source region") })
        waitStatus(id, "attached"); val historyId = app.database.reader().request(id)!!.historyId!!
        release(figureFlight)
        withTimeout(15000) { while (string(serverHistory(historyId), "status") != "completed") delay(100) }
        val answer = serverHistory(historyId)
        assertEquals("figure", answer["context"]!!.jsonObject["explanationKind"]!!.jsonPrimitive.content)
        assertEquals(bbox, answer["context"]!!.jsonObject["rect"])
        assertEquals("current", answer["answer"]!!.jsonObject["contextSourceStatus"]!!.jsonPrimitive.content)
        assertTrue("Region without original text range receives honest page citation", answer["answer"]!!.jsonObject["citations"]!!.jsonArray.all { it.jsonObject["region"] == null })
        app.history.refresh(key)
        assertEquals("completed", app.database.metadata().history(historyId)!!.status)

        val failureFlight = "D-FLIGHT-failure-${UUID.randomUUID()}"
        val failed = app.history.create(key, "question", request("$failureFlight QA_WAIT QA_ERROR provider failure with retained context"), buildJsonObject { put("text", "Full failure quote"); put("page", 2) })
        waitStatus(failed, "attached"); val failedHistory = app.database.reader().request(failed)!!.historyId!!
        release(failureFlight)
        withTimeout(15000) { while (string(serverHistory(failedHistory), "status") != "failed") delay(100) }
        app.history.refresh(key); app.history.send(failed); delay(300)
        assertEquals("Full failure quote", WireJson.format.parseToJsonElement(app.database.reader().request(failed)!!.contextJson).jsonObject["text"]!!.jsonPrimitive.content)
        assertEquals(1, app.client.data("/api/papers/$key/history").jsonObject["history"]!!.jsonArray.count { it.jsonObject["requestId"]?.jsonPrimitive?.content == failed })

        val cancelFlight = "D-FLIGHT-ui-cancel-${UUID.randomUUID()}"
        val cancel = app.history.create(key, "question", request("$cancelFlight QA_WAIT explicit UI cancel"), buildJsonObject { put("text", "Cancel preserves this quote"); put("page", 2) })
        waitStatus(cancel, "attached"); val cancelHistory = app.database.reader().request(cancel)!!.historyId!!
        compose.onNodeWithText("Notes", substring = false).performClick()
        compose.onNodeWithContentDescription("Reader panel").performClick(); compose.onAllNodesWithText("History").onLast().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Cancel generation", substring = false).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Cancel generation", substring = false).performScrollTo().performClick()
        withTimeout(15000) { while (string(serverHistory(cancelHistory), "status") != "canceled") delay(100) }
        assertNotNull(app.database.metadata().history(cancelHistory))
        compose.onNodeWithText("Close", substring = false).performClick()
        Log.i("ReaderBridgeQA", "actual figure PNG/context/page-only citation, provider failure retained context/idempotent history, explicit UI Cancel distinct from Close verified")
    }

    @Test fun aActualCloseReopenOfflineRetryAndExplicitCancel(): Unit = runBlocking {
        val flight = "D-FLIGHT-close-${UUID.randomUUID()}"
        val text = app.originalText.page(key, paper.pdfSha256!!, 2, 5).page!!
        val start = text.text.indexOf("iii")
        val range = OriginalTextGeometry(text).range(start, start + 3)!!
        fun bounds(points: List<TextPoint>): PdfRect {
            val x = points.minOf { it.x }; val y = points.minOf { it.y }
            return PdfRect(x.toFloat(), y.toFloat(), (points.maxOf { it.x } - x).toFloat(), (points.maxOf { it.y } - y).toFloat())
        }
        val selection = PdfTextSelection(range.text, range.displayQuads.map(::bounds), range.start, range.end,
            provenance = "cached-original-approximate", originalRects = range.originalQuads.map(::bounds), pdfSha256 = paper.pdfSha256, extractionVersion = PDF_TEXT_LAYOUT_VERSION, rotation = text.rotation)
        compose.onNodeWithText("Notes", substring = false).performClick()
        val body = readerQuestionBody("$flight QA_WAIT Explain this selected source passage.", "ko", "codex" to "gpt-6-sol", 2 to selection)
        val id = app.history.create(key, "question", body, buildJsonObject { put("text", range.text); put("origin", "original"); put("page", 2) })
        waitStatus(id, "attached")
        val historyId = app.database.reader().request(id)!!.historyId!!
        assertEquals("running", string(serverHistory(historyId), "status"))
        compose.onNodeWithText("Close", substring = false).performClick()
        compose.runOnIdle { show = false }
        compose.waitForIdle()
        assertEquals("running", string(serverHistory(historyId), "status"))
        release(flight)
        withTimeout(15000) { while (string(serverHistory(historyId), "status") != "completed") delay(100) }
        val answer = serverHistory(historyId)
        assertEquals("ko", answer["context"]!!.jsonObject["answerLanguage"]!!.jsonPrimitive.content)
        assertEquals("current", answer["answer"]!!.jsonObject["contextSourceStatus"]!!.jsonPrimitive.content)
        assertEquals("unrotated-crop-normalized-v1", answer["answer"]!!.jsonObject["citations"]!!.jsonArray.first().jsonObject["region"]!!.jsonObject["provenance"]!!.jsonObject["coordinateSpace"]!!.jsonPrimitive.content)
        compose.runOnIdle { show = true }; compose.waitForIdle()
        compose.onNodeWithText("Notes", substring = false).performClick()
        withTimeout(10000) { while (app.database.metadata().history(historyId)?.status != "completed") delay(50) }
        compose.onNodeWithText("Close", substring = false).performClick()
        app.credentials.save(credentials.copy(url = "http://127.0.0.1:1"))
        assertNotNull(app.cache.existing(paper.pdfSha256!!))
        assertNotNull(app.originalText.page(key, paper.pdfSha256!!, 2, 5).page)
        assertTrue(translatedBlocks(WireJson.format.parseToJsonElement(app.database.metadata().snapshot(key)!!.json).jsonObject).isNotEmpty())
        val parent = "D-folder-${UUID.randomUUID()}"; val child = "D-folder-${UUID.randomUUID()}"
        app.metadata.folder("D offline reader notes", null, parent)
        app.metadata.folder("D source passages", parent, child)
        val prior = WireJson.format.parseToJsonElement(app.database.library().get(key)!!.json).jsonObject
        app.metadata.patchPaper(key, buildJsonObject {
            put("saved", true); put("tags", JsonArray((prior["tags"] as? JsonArray).orEmpty() + JsonPrimitive("D-reader-offline")))
            put("collections", JsonArray((prior["collections"] as? JsonArray).orEmpty() + listOf(JsonPrimitive(parent), JsonPrimitive(child))))
        })
        val memoId = UUID.randomUUID().toString()
        val memo = buildJsonObject {
            put("id", memoId); put("paperKey", key); put("page", 2); put("kind", "memo"); put("text", "Complete offline bridge memo body, independent of quote")
            put("quote", "iii"); put("color", "blue"); put("collapsed", true); put("rev", 0); put("deleted", false); put("deviceId", credentials.deviceId)
            put("updatedAt", "2026-10-01T00:00:00Z"); put("rect", buildJsonObject { put("x", .3); put("y", .4); put("width", .02); put("height", .02) })
            put("provenance", buildJsonObject { put("coordinateSpace", "rendered-page-normalized-v1"); put("textSource", "original"); put("pdfSha256", paper.pdfSha256) })
        }
        app.sync.saveLocal(memo)
        assertTrue(app.database.annotations().get(memoId)!!.dirty)
        assertTrue(app.database.metadata().pending().any { it.entityId == parent })
        app.credentials.save(credentials)
        app.sync.syncOnce()
        val remoteMemo = app.client.data("/api/papers/$key/annotations").jsonArray.first { it.jsonObject["id"]!!.jsonPrimitive.content == memoId }.jsonObject
        assertEquals(memo["text"], remoteMemo["text"]); assertEquals(memo["rect"], remoteMemo["rect"])
        assertEquals(memo["color"], remoteMemo["color"]); assertEquals(memo["collapsed"], remoteMemo["collapsed"])
        val remotePaper = app.client.data("/api/library").jsonArray.first { it.jsonObject["paperKey"]!!.jsonPrimitive.content == key }.jsonObject
        assertTrue(remotePaper["saved"]!!.jsonPrimitive.boolean)
        assertTrue(remotePaper["tags"]!!.jsonArray.any { it.jsonPrimitive.content == "D-reader-offline" })
        assertTrue(remotePaper["collections"]!!.jsonArray.any { it.jsonPrimitive.content == child })
        assertFalse(app.database.annotations().get(memoId)!!.dirty)
        Log.i("ReaderBridgeQA", "actual native dirty queue reconnect preserved full memo/position/color/collapse, saved/tags and D-only nested folder memberships")
        app.credentials.save(credentials.copy(url = "http://127.0.0.1:1"))
        val retryFlight = "D-FLIGHT-retry-${UUID.randomUUID()}"
        val retry = app.history.create(key, "question", request("$retryFlight retained offline question"), buildJsonObject { put("text", "Complete offline quote"); put("page", 2) })
        waitStatus(retry, "failed")
        app.credentials.save(credentials); app.history.send(retry)
        waitStatus(retry, "attached")
        val retriedHistory = app.database.reader().request(retry)!!.historyId!!
        assertEquals(retry, string(serverHistory(retriedHistory), "requestId"))
        app.history.send(retry); delay(300)
        val matching = app.client.data("/api/papers/$key/history").jsonObject["history"]!!.jsonArray.count { it.jsonObject["requestId"]?.jsonPrimitive?.content == retry }
        assertEquals(1, matching)
        val lostFlight = "D-FLIGHT-lost-${UUID.randomUUID()}"
        val admissionScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var loseOnce = true
        val lostResponseClient = object : HubHistoryClient {
            override suspend fun data(path: String, method: String, body: JsonElement?) = app.client.data(path, method, body)
            override suspend fun attachHistory(path: String, body: JsonObject): String {
                if (loseOnce) {
                    loseOnce = false
                    withContext(Dispatchers.IO) { app.client.execute(path, "POST", body).use { response -> assertTrue(response.isSuccessful) } }
                    throw java.io.IOException("Intentionally closed actual admission response before reading its ID")
                }
                return app.client.attachHistory(path, body)
            }
        }
        try {
            val lostRepo = HistoryRepository(app.database, lostResponseClient, admissionScope)
            val lost = lostRepo.create(key, "question", request("$lostFlight QA_WAIT retained lost-response context"), buildJsonObject { put("text", "Loss must not duplicate history") })
            waitStatus(lost, "failed")
            lostRepo.send(lost); waitStatus(lost, "attached")
            val entries = app.client.data("/api/papers/$key/history").jsonObject["history"]!!.jsonArray.filter { it.jsonObject["requestId"]?.jsonPrimitive?.content == lost }
            assertEquals(1, entries.size)
            assertEquals(app.database.reader().request(lost)!!.historyId, entries.single().jsonObject["id"]!!.jsonPrimitive.content)
            release(lostFlight)
        } finally { admissionScope.cancel() }
        val cancelFlight = "D-FLIGHT-cancel-${UUID.randomUUID()}"
        val cancel = app.history.create(key, "question", request("$cancelFlight QA_WAIT cancel only explicitly"), JsonObject(emptyMap()))
        waitStatus(cancel, "attached")
        val canceledHistory = app.database.reader().request(cancel)!!.historyId!!
        app.credentials.save(credentials.copy(url = "http://127.0.0.1:1"))
        val action = app.history.action(key, canceledHistory, "cancel"); waitStatus(action, "failed")
        app.credentials.save(credentials); app.history.send(action); waitStatus(action, "done")
        assertEquals("canceled", string(serverHistory(canceledHistory), "status"))
        Log.i("ReaderBridgeQA", "actual HTTP close/reader detach→completion→reopen, cached offline PDF/layout/translation, same-ID offline/lost-admission retry and explicit offline cancel PASS")
    }

    @Test fun bAdmitBeforeExternalProcessRestart(): Unit = runBlocking {
        val flight = "D-FLIGHT-restart-${UUID.randomUUID()}"
        val id = app.history.create(key, "question", request("$flight QA_WAIT survive Android restart"), buildJsonObject { put("text", "Full restart context"); put("page", 2) })
        waitStatus(id, "attached")
        val historyId = app.database.reader().request(id)!!.historyId!!
        stateFile().writeText(buildJsonObject { put("requestId", id); put("historyId", historyId); put("flightId", flight); put("pid", android.os.Process.myPid()) }.toString())
        assertEquals("running", string(serverHistory(historyId), "status"))
        Log.i("ReaderBridgeQA", "restart phase admitted durable request; process=${android.os.Process.myPid()}")
    }
    @Test fun cRecoverAfterExternalProcessRestart(): Unit = runBlocking {
        assumeTrue("Run phase b, externally force-stop, and release D flight first", stateFile().isFile)
        val state = WireJson.format.parseToJsonElement(stateFile().readText()).jsonObject
        assertNotEquals(state["pid"]!!.jsonPrimitive.int, android.os.Process.myPid())
        val id = string(state, "requestId"); val historyId = string(state, "historyId")
        assertTrue(app.database.reader().request(id)!!.contextJson.contains("Full restart context"))
        app.history.reconnect(key)
        withTimeout(10000) { while (app.database.metadata().history(historyId)?.status != "completed") delay(50) }
        assertTrue(app.database.metadata().history(historyId)!!.json.contains("survive Android restart"))
        Log.i("ReaderBridgeQA", "actual external Android process restart recovered retained context and completed Hub answer; process=${android.os.Process.myPid()}")
    }
}
