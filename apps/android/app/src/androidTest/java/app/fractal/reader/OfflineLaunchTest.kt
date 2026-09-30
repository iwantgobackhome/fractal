package app.fractal.reader

import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class OfflineLaunchTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun launchesCachedLibraryWithoutHubAndReadsWithoutSaving() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as ReaderApplication
        assertNull("Only an unpaired disposable emulator is allowed", app.credentials.load())
        app.settings.edit().putBoolean("languageIntroDone", true).commit()
        val key = "offline-launch-fixture"
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(600, 800, 1).create())
        page.canvas.drawText("Cold offline launch fixture", 40f, 100f, Paint().apply { textSize = 20f })
        pdf.finishPage(page)
        val output = java.io.ByteArrayOutputStream(); pdf.writeTo(output); pdf.close()
        val bytes = output.toByteArray()
        val sha = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        app.cache.file(sha).writeBytes(bytes)
        val record = buildJsonObject {
            put("id", key); put("paperKey", key); put("title", "Cold offline launch fixture")
            put("authors", JsonArray(emptyList())); put("addedAt", "2026-09-30"); put("updatedAt", "2026-09-30")
            put("saved", true); put("savedAt", "2026-09-30"); put("bibtexKey", key)
        }
        app.database.library().upsert(libraryEntity(record, null, false).copy(pdfSha256 = sha, pageCount = 1))
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText("Cold offline launch fixture").assertExists().performClick()
            compose.onNodeWithText("Remove from Saved").performClick()
            compose.onNodeWithText("Read paper").performClick()
            compose.waitUntil(15_000) { runBlocking { app.database.library().get(key)?.lastReadAt != null } }
            assertFalse(app.database.library().get(key)!!.saved)
            assertNotNull(app.database.library().get(key)!!.lastReadAt)
            assertTrue(app.database.metadata().pending("paper", key).isNotEmpty())
        }
        app.database.library().delete(key); app.database.metadata().deletePaperMutations(key); app.cache.file(sha).delete()
        Unit
    }
}
