package app.fractal.reader

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.sync.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType

/** QA-only test, installed exclusively on the separately owned read-only AVD. */
class HubHttpBridgeTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun actualHubClientMetadataSnapshotOfflineReconnectAndMainActivity() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as ReaderApplication
        assertNull("Fresh QA read-only device required", app.credentials.load())
        val args = InstrumentationRegistry.getArguments()
        val fixture = HubCredentials("http://127.0.0.1:" + args.getString("hubPort"), "QA isolated Hub", "QA", args.getString("deviceId")!!, args.getString("deviceToken")!!)
        val key = "qa-reader-catalog"
        app.credentials.save(fixture)
        app.settings.edit().putBoolean("languageIntroDone", true).putString("uiLanguage", "en").commit()
        val events = mutableListOf<String>()
        suspend fun captureState(phase: String) {
            val value = buildJsonObject {
                put("phase", phase)
                put("library", WireJson.format.parseToJsonElement(app.database.library().get(key)!!.json))
                put("pending", JsonArray(app.database.metadata().pending().map { mutation -> buildJsonObject {
                    put("requestId", mutation.requestId); put("kind", mutation.kind); put("entityId", mutation.entityId)
                    put("baseRev", mutation.baseRev); put("base", WireJson.format.parseToJsonElement(mutation.baseJson))
                    put("patch", WireJson.format.parseToJsonElement(mutation.patchJson))
                } }))
            }
            File(app.getExternalFilesDir(null), "bridge-$phase.json").writeText(value.toString())
        }
        fun control(path: String) {
            OkHttpClient().newCall(Request.Builder().url("http://127.0.0.1:6175/E/$path")
                .post("{}".toRequestBody("application/json".toMediaType())).build()).execute().use { assertEquals(200, it.code) }
        }
        app.sync.syncOnce()
        val initial = app.database.library().get(key)!!
        assertEquals("Reader HTTP bridge fixture", initial.title)
        events += "real HubClient Bearer pull + Room projection passed"
        val metadata = app.sync.refreshPaperMetadata(key)!!
        assertEquals(5, metadata.second)
        val pdf = app.downloader.download(key, metadata.first)
        assertTrue(pdf.isFile)
        assertEquals(metadata.first, java.security.MessageDigest.getInstance("SHA-256").digest(pdf.readBytes()).joinToString("") { "%02x".format(it) })
        val snapshot = app.database.metadata().snapshot(key)!!
        assertNotNull(WireJson.format.parseToJsonElement(snapshot.json).jsonObject["blocks"])
        val positions = app.client.data("/api/papers/$key/text-layout?page=2").jsonObject
        assertEquals(metadata.first, positions.text("pdfSha256"))
        assertEquals("pdfjs6-original-advances-v1", positions.text("extractionVersion"))
        assertEquals("90", positions["page"]!!.jsonObject.text("rotation"))
        events += "real snapshot + PDF download SHA + rotated page layout envelope passed"
        val parent = app.metadata.folder("Bridge parent", null, "qa-bridge-parent")
        val child = app.metadata.folder("Bridge child", parent, "qa-bridge-child")
        app.metadata.patchPaper(key, buildJsonObject {
            put("tags", JsonArray(listOf(JsonPrimitive("actual-android"))))
            put("collections", JsonArray(listOf(JsonPrimitive(child))))
        })
        repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
        assertTrue(app.database.metadata().pending().isEmpty())
        assertEquals(parent, app.database.metadata().folder(child)!!.parentId)
        val remote = app.client.data("/api/library/$key").jsonObject
        assertEquals(listOf("actual-android"), remote["tags"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(listOf(child), remote["collections"]!!.jsonArray.map { it.jsonPrimitive.content })
        events += "real parent-before-child folder CAS + metadata queue settled on HTTP"
        app.metadata.patchPaper(key, buildJsonObject { put("tags", JsonArray(listOf(JsonPrimitive("actual-android"), JsonPrimitive("lost-response")))) })
        val lost = app.database.metadata().pending("paper", key).single()
        control("drop-next-push")
        var lostFailed = false
        try { app.sync.syncOnce() } catch (_: Exception) { lostFailed = true }
        if (lostFailed) {
            assertEquals("Retain immutable request after committed response loss", lost, app.database.metadata().pending("paper", key).single())
            app.sync.syncOnce()
        }
        assertTrue(app.database.metadata().pending().isEmpty())
        events += "lost HTTP response replay settled; OkHttp transparent retry=${!lostFailed}; requestId=${lost.requestId}"
        app.metadata.patchPaper(key, buildJsonObject { put("tags", JsonArray(listOf(JsonPrimitive("actual-android"), JsonPrimitive("lost-response"), JsonPrimitive("local-conflict")))) })
        val stale = app.database.metadata().pending("paper", key).single()
        control("conflict-next-push")
        app.sync.syncOnce()
        val rebased = app.database.metadata().pending("paper", key).single()
        assertNotEquals(stale.requestId, rebased.requestId)
        assertTrue(rebased.baseRev > stale.baseRev)
        app.sync.syncOnce()
        assertTrue(app.database.metadata().pending().isEmpty())
        val tags = app.client.data("/api/library/$key").jsonObject["tags"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertTrue(tags.containsAll(listOf("local-conflict", "remote-conflict")))
        events += "real conflict returned authority; native rebase used new requestId and retained concurrent tags"
        val annotationId = java.util.UUID.randomUUID().toString()
        app.sync.saveLocal(buildJsonObject {
            put("id", annotationId); put("paperKey", key); put("page", 2); put("updatedAt", java.time.Instant.now().toString())
            put("deleted", false); put("rev", 0); put("deviceId", fixture.deviceId); put("kind", "memo"); put("text", "Bridge retained annotation")
            put("quote", "iii"); put("rect", buildJsonObject { put("x", .2); put("y", .3); put("width", .1); put("height", .05) })
        })
        app.sync.syncOnce()
        assertFalse(app.database.annotations().get(annotationId)!!.dirty)
        // Explicitly unavailable endpoint on this device, no changes to another device/network.
        app.credentials.save(fixture.copy(url = "http://127.0.0.1:1"))
        var offlineFailed = false
        try { app.sync.syncOnce() } catch (_: Exception) { offlineFailed = true }
        assertTrue(offlineFailed)
        app.metadata.save(key, false)
        app.metadata.read(key, 2)
        val beforeUiRead = app.database.library().get(key)!!.lastReadAt
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Recent").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Recent").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Reader HTTP bridge fixture").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Reader HTTP bridge fixture").performClick()
            compose.onNodeWithText("Read paper").performClick()
            try {
                // The reader intentionally auto-hides its page header; PdfPages opening
                // is observed through its durable read event, then visually checked.
                compose.waitUntil(15_000) { runBlocking { app.database.library().get(key)?.lastReadAt != beforeUiRead } }
            } finally {
                File(app.getExternalFilesDir(null), "offline-reader-diagnostic.png").outputStream().use { stream ->
                    instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
                }
                compose.onRoot().printToLog("E-native-bridge")
            }
            val local = app.database.library().get(key)!!
            assertFalse(local.saved)
            assertNotNull(local.lastReadAt)
            assertTrue(app.cache.existing(metadata.first)!!.isFile)
            assertTrue(app.database.metadata().pending("paper", key).isNotEmpty())
            captureState("offline")
            compose.waitForIdle()
            File(app.getExternalFilesDir(null), "offline-cached-reader.png").outputStream().use { stream ->
                instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
            }
        }
        events += "actual MainActivity offline cached PDF read, unsaved flag + queued Recent preserved"
        app.credentials.save(fixture)
        val newerAt = "2030-01-01T00:00:00.000Z"
        app.client.data("/api/library/$key", "PATCH", buildJsonObject {
            put("lastReadAt", newerAt); put("readProgress", buildJsonObject { put("page", 4); put("scrollOffset", .75) })
        })
        repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
        assertTrue(app.database.metadata().pending().isEmpty())
        val final = app.client.data("/api/library/$key").jsonObject
        assertEquals("false", final.text("saved"))
        assertNotNull(final.text("lastReadAt"))
        assertTrue(final["readProgress"]!!.jsonObject.text("page")!!.toInt() in 1..5)
        assertEquals(newerAt, final.text("lastReadAt"))
        assertEquals("4", final["readProgress"]!!.jsonObject.text("page"))
        assertEquals(newerAt, app.database.library().get(key)!!.lastReadAt)
        assertEquals("4", WireJson.format.parseToJsonElement(app.database.library().get(key)!!.readProgressJson!!).jsonObject.text("page"))
        captureState("reconnected")
        events += "reconnect preserved newer remote timestamp/page pair while settling older offline read and unsave"
        app.metadata.patchPaper(key, buildJsonObject { put("collections", JsonArray(listOf(JsonPrimitive(parent), JsonPrimitive(child)))) })
        repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
        app.metadata.deleteFolder(parent)
        repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
        assertTrue(app.database.metadata().pending().isEmpty())
        app.sync.syncOnce()
        assertNull(app.database.metadata().folder(child)!!.parentId)
        assertTrue(app.cache.existing(metadata.first)!!.isFile)
        assertNotNull(app.database.annotations().get(annotationId))
        val afterDelete = app.client.data("/api/library/$key").jsonObject
        assertEquals(listOf(child), afterDelete["collections"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(listOf(child), WireJson.format.parseToJsonElement(app.database.library().get(key)!!.json).jsonObject["collections"]!!.jsonArray.map { it.jsonPrimitive.content })
        captureState("folder-deleted")
        events += "real reconnect settled offline edits and folder deletion promoted child without losing PDF"
        File(app.getExternalFilesDir(null), "native-bridge.txt").writeText(events.joinToString("\n") + "\n")
        println(events.joinToString("\n"))
        Unit
    }
}
