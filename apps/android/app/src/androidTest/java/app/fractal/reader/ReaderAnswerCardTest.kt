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
    private val key = "answer-card-fixture-${java.util.UUID.randomUUID()}"
    private fun reader(tall: Boolean = false) {
        val app = compose.activity.application as ReaderApplication
        app.credentials.clear()
        app.settings.edit().remove("cachedReaderProviders").commit()
        val bytes = java.io.ByteArrayOutputStream()
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(600, if (tall) 1400 else 800, 1).create())
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
        Thread.sleep(600)
        compose.waitForIdle()
        val before = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("reader-answer-drag").performTouchInput { swipe(center, center + androidx.compose.ui.geometry.Offset(15f, -90f), 400) }
        val after = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        assertTrue("Header drag should reposition card $before -> $after", kotlin.math.abs(after.top - before.top) > 10f)
        compose.onNodeWithTag("reader-answer-drag").performTouchInput { swipe(center, center + androidx.compose.ui.geometry.Offset(0f, -40f), 400) }
        val secondDrag = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        assertTrue("A later drag continues from the current position", secondDrag.top < after.top - 10f)
        compose.waitUntil(15000) { runBlocking { app.database.reader().observeRequests(key).first().any { it.kind == "explanation" && it.requestId !in previous } } }
        val row = runBlocking { app.database.reader().observeRequests(key).first().first { it.kind == "explanation" && it.requestId !in previous } }
        // Minimizing leaves a marker on the page; the marker reopens the same answer.
        compose.onNodeWithTag("reader-answer-collapse").performClick()
        compose.onNodeWithTag("reader-answer-card").assertDoesNotExist()
        compose.waitUntil(15000) { compose.onAllNodesWithTag("reader-answer-pin-${row.requestId}").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("reader-answer-pin-${row.requestId}").performClick()
        compose.onNodeWithTag("reader-answer-question").assertExists()
        val body = WireJson.format.parseToJsonElement(row.bodyJson).jsonObject
        assertEquals("equation", body["kind"]?.jsonPrimitive?.content)
        assertTrue(body["surroundingText"]?.jsonPrimitive?.content.orEmpty().contains("E=mc^2"))
        assertTrue(body["croppedPngBase64"]?.jsonPrimitive?.content.orEmpty().isNotBlank())
        compose.onNodeWithTag("reader-answer-drag").performTouchInput {
            down(center); moveTo(center + androidx.compose.ui.geometry.Offset(25f, -30f), delayMillis = 200)
        }
        compose.onNodeWithTag("reader-answer-source-${body["threadId"]!!.jsonPrimitive.content}").assertExists()
        screenshot("06-drag-source-highlight")
        compose.onNodeWithTag("reader-answer-drag").performTouchInput { up() }
        runBlocking {
            app.database.metadata().upsert(HistoryEntity("answer-fixture-${row.requestId}", key, "running", false, 1,
                "2026-10-02T00:00:00Z", buildJsonObject {
                    put("id", "answer-fixture-${row.requestId}"); put("requestId", row.requestId); put("paperKey", key)
                    put("context", buildJsonObject { put("threadId", body["threadId"]!!); put("page", 1); put("rect", buildJsonObject { put("x", .1); put("y", .15); put("width", .5); put("height", .15) }) })
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
        val followUp = runBlocking { app.database.reader().observeRequests(key).first().first {
            it.kind == "question" && it.bodyJson.contains("Why is mass squared?")
        } }
        assertEquals(body["threadId"], WireJson.format.parseToJsonElement(followUp.bodyJson).jsonObject["threadId"])
        compose.onNodeWithTag("reader-answer-question").assertTextContains("", substring = false)
        compose.onNodeWithText("Energy is conserved. [p.1]").assertExists()
        compose.onNodeWithTag("reader-answer-close").performClick()
        compose.onNodeWithTag("reader-answer-delete-confirm").performClick()
        compose.onNodeWithTag("reader-answer-card").assertDoesNotExist()
    }
    private fun screenshot(name: String) {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val folder = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "answer-cards").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        java.io.File(folder, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun pageScrollMultipleCardsCollapseDeleteAndRestore() {
        reader(tall = true)
        val app = compose.activity.application as ReaderApplication
        val now = java.time.Instant.now().toString()
        runBlocking {
            app.database.metadata().upsert(historyEntity(buildJsonObject {
                put("id", "retained-root-$key"); put("paperKey", key); put("kind", "question"); put("status", "completed")
                put("question", "Retained first question"); put("text", "Retained first answer"); put("createdAt", now)
                put("context", buildJsonObject {
                    put("threadId", "retained-root-$key"); put("page", 1); put("selectedText", "Equation fixture")
                    put("rect", buildJsonObject { put("x", .1); put("y", .15); put("width", .5); put("height", .15) })
                })
                put("placement", AnswerPlacement(1, .02f, .35f, "open", now).json())
            }))
        }
        compose.waitUntil(15000) { compose.onAllNodesWithTag("reader-answer-card").fetchSemanticsNodes().size == 1 }
        Thread.sleep(600)
        compose.waitForIdle()
        val before = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("reader-source-pages").performTouchInput {
            swipe(androidx.compose.ui.geometry.Offset(width - 10f, height * .75f), androidx.compose.ui.geometry.Offset(width - 10f, height * .75f - 100f), 400)
        }
        compose.waitForIdle()
        val after = compose.onNodeWithTag("reader-answer-card").fetchSemanticsNode().boundsInRoot
        assertTrue("Card scrolls with the PDF page", after.top < before.top - 20f)
        screenshot("01-page-scroll")
        compose.onNodeWithTag("reader-answer-collapse").performClick()
        compose.onNodeWithTag("reader-answer-pin-retained-root-$key").assertExists().performClick()
        compose.onNodeWithTag("reader-answer-card").assertExists()
        compose.onNodeWithTag("reader-answer-question").performTouchInput { click() }
        compose.waitUntil(5000) { compose.onAllNodesWithTag("reader-answer-source-retained-root-$key").fetchSemanticsNodes().isNotEmpty() }
        screenshot("02-source-highlight")
        compose.activityRule.scenario.onActivity { activity ->
            (activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                .hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
            activity.window.decorView.clearFocus()
        }
        compose.onNodeWithTag("explain-structure-equation-1").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithTag("reader-answer-card").fetchSemanticsNodes().size == 2 }
        compose.onNodeWithText("Retained first answer").assertExists()
        screenshot("03-two-cards")
        val newer = runBlocking { app.database.reader().requests(key).first { it.kind == "explanation" } }
        val newerThread = readerJson(newer.bodyJson).threadText("threadId")
        compose.onNode(hasTestTag("reader-answer-collapse") and hasAnyAncestor(hasContentDescription("Answer thread $newerThread"))).performClick()
        compose.onNode(hasTestTag("reader-answer-close") and hasAnyAncestor(hasContentDescription("Answer thread retained-root-$key"))).performClick()
        compose.onNodeWithTag("reader-answer-delete-confirm").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithTag("reader-answer-card").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("reader-answer-pin-retained-root-$key").assertDoesNotExist()
        compose.onNodeWithTag("reader-answer-pin-${newer.requestId}").performClick()
        screenshot("04-deleted")
        compose.waitUntil(5000) { runBlocking { app.database.metadata().history("retained-root-$key")?.answerPlacement()?.state == "dismissed" } }
        runBlocking {
            assertEquals("dismissed", app.database.metadata().history("retained-root-$key")!!.answerPlacement()!!.state)
            assertFalse(app.database.metadata().history("retained-root-$key")!!.deleted)
            assertTrue(app.database.metadata().pending("history", "retained-root-$key").any { it.patchJson.contains("placement") })
        }
        compose.onNodeWithTag("reader-tools").performClick()
        compose.onNodeWithTag("reader-history-open").performClick()
        compose.onNodeWithTag("reader-thread-retained-root-$key").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("reader-answer-card").fetchSemanticsNodes().size == 2 }
        compose.onNodeWithText("Retained first answer").assertExists()
        screenshot("05-reopened-from-history")
    }

}
