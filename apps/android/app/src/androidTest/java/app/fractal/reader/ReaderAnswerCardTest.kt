package app.fractal.reader

import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fractal.data.*
import app.fractal.design.FractalTheme
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ReaderAnswerCardTest {
    @get:Rule val compose = createAndroidComposeRule<ReaderFixtureActivity>()
    private val key = "answer-card-fixture"
    private fun reader() {
        val app = compose.activity.application as ReaderApplication
        app.credentials.clear()
        app.settings.edit().remove("cachedReaderProviders").commit()
        val bytes = java.io.ByteArrayOutputStream()
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(600, 800, 1).create())
        page.canvas.drawText("Equation fixture", 40f, 100f, Paint().apply { textSize = 20f })
        pdf.finishPage(page); pdf.writeTo(bytes); pdf.close()
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()).joinToString("") { "%02x".format(it) }
        app.cache.file(hash).writeBytes(bytes.toByteArray())
        runBlocking {
            app.history.saveDraft(key, buildJsonObject { put("model", ""); put("language", "auto") })
            app.database.reader().upsert(ReaderPositionEntity(key, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}"))
            app.structure.retain(key, hash, WireJson.format.parseToJsonElement("""{"version":"v1","status":"ready","items":[
                {"id":"equation-1","kind":"equation","page":1,"bbox":{"x":0.1,"y":0.15,"width":0.5,"height":0.15},
                "label":"Eq. 1","caption":"Energy relation","latex":"E=mc^2"}]}"""))
        }
        compose.setContent { FractalTheme { ReaderScreen(app, LibraryEntity(key, "Answer fixture", "[]", null, null,
            "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", "ready", hash, 1, false, "{}"), {}) } }
        compose.waitUntil(15000) { compose.onAllNodesWithTag("explain-structure-equation-1").fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun explainChipOpensMovableCollapsibleCardAndDurableEquationRequest() {
        reader()
        val app = compose.activity.application as ReaderApplication
        val previous = runBlocking { app.database.reader().observeRequests(key).first().map { it.requestId }.toSet() }
        compose.onNodeWithTag("explain-structure-equation-1").performClick()
        compose.onNodeWithTag("reader-answer-card").assertIsDisplayed()
        val before = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("reader-answer-drag").performTouchInput { swipe(center, center + androidx.compose.ui.geometry.Offset(15f, -90f), 400) }
        val after = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        assertTrue("Header drag should reposition card", kotlin.math.abs(after.top - before.top) > 10f)
        compose.onNodeWithTag("reader-answer-drag").performTouchInput { swipe(center, center + androidx.compose.ui.geometry.Offset(0f, -40f), 400) }
        val secondDrag = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        assertTrue("A later drag continues from the current position", secondDrag.top < after.top - 10f)
        compose.onNodeWithTag("reader-answer-collapse").performClick()
        compose.onNodeWithTag("reader-answer-question").assertDoesNotExist()
        compose.onNodeWithTag("reader-answer-collapse").performClick()
        compose.onNodeWithTag("reader-answer-question").assertExists()
        compose.waitUntil(15000) { runBlocking { app.database.reader().observeRequests(key).first().any { it.kind == "explanation" && it.requestId !in previous } } }
        val row = runBlocking { app.database.reader().observeRequests(key).first().first { it.kind == "explanation" && it.requestId !in previous } }
        val body = WireJson.format.parseToJsonElement(row.bodyJson).jsonObject
        assertEquals("equation", body["kind"]?.jsonPrimitive?.content)
        assertTrue(body["surroundingText"]?.jsonPrimitive?.content.orEmpty().contains("E=mc^2"))
        assertTrue(body["croppedPngBase64"]?.jsonPrimitive?.content.orEmpty().isNotBlank())
        runBlocking {
            app.database.metadata().upsert(HistoryEntity("answer-fixture-${row.requestId}", key, "running", false, 1,
                "2026-10-02T00:00:00Z", buildJsonObject {
                    put("id", "answer-fixture-${row.requestId}"); put("requestId", row.requestId); put("paperKey", key)
                    put("kind", "explanation"); put("question", "Explain Eq. 1"); put("text", "Energy is conserved. [p.1]"); put("status", "running")
                }.toString()))
        }
        compose.waitUntil(15000) { compose.onAllNodesWithText("Energy is conserved. [p.1]").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Energy is conserved. [p.1]").assertExists()
        compose.onNodeWithText("[p.1]", substring = false).performScrollTo().performClick()
        compose.onNodeWithTag("reader-answer-question").performScrollTo().performTextInput("Why is mass squared?")
        compose.onAllNodesWithText(if (compose.activity.resources.configuration.locales[0].language == "ko") "질문" else "Ask").onLast().performScrollTo().performClick()
        compose.waitUntil(15000) { runBlocking { app.database.reader().observeRequests(key).first().any {
            it.kind == "question" && it.requestId !in previous && it.bodyJson.contains("Why is mass squared?")
        } } }
        compose.onNodeWithTag("reader-answer-close").performClick()
        compose.onNodeWithTag("reader-answer-card").assertDoesNotExist()
    }
}
