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
        // Explicitly unavailable endpoint on this device, no changes to another device/network.
        app.credentials.save(fixture.copy(url = "http://127.0.0.1:1"))
        var offlineFailed = false
        try { app.sync.syncOnce() } catch (_: Exception) { offlineFailed = true }
        assertTrue(offlineFailed)
        app.metadata.save(key, false)
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Reader HTTP bridge fixture").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Reader HTTP bridge fixture").performClick()
            compose.onNodeWithText("Read paper").performClick()
            compose.waitUntil(15_000) { runBlocking { app.database.library().get(key)?.lastReadAt != initial.lastReadAt } }
            val local = app.database.library().get(key)!!
            assertFalse(local.saved)
            assertNotNull(local.lastReadAt)
            assertTrue(app.cache.existing(metadata.first)!!.isFile)
            assertTrue(app.database.metadata().pending("paper", key).isNotEmpty())
        }
        events += "actual MainActivity offline cached PDF read, unsaved flag + queued Recent preserved"
        app.credentials.save(fixture)
        repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
        assertTrue(app.database.metadata().pending().isEmpty())
        val final = app.client.data("/api/library/$key").jsonObject
        assertEquals("false", final.text("saved"))
        assertNotNull(final.text("lastReadAt"))
        assertTrue(final["readProgress"]!!.jsonObject.text("page")!!.toInt() in 1..5)
        app.metadata.deleteFolder(parent)
        repeat(8) { if (app.database.metadata().pending().isNotEmpty()) app.sync.syncOnce() }
        assertTrue(app.database.metadata().pending().isEmpty())
        app.sync.syncOnce()
        assertNull(app.database.metadata().folder(child)!!.parentId)
        assertTrue(app.cache.existing(metadata.first)!!.isFile)
        events += "real reconnect settled offline edits and folder deletion promoted child without losing PDF"
        File(app.getExternalFilesDir(null), "reader-prerequisite-bridge.txt").writeText(events.joinToString("\n") + "\n")
        println(events.joinToString("\n"))
        Unit
    }
}
