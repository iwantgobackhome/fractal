package app.fractal.reader

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.design.FractalTheme
import app.fractal.pdf.PdfTextSelection
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class ReaderQuestionThreadTest {
    @get:Rule val compose = createAndroidComposeRule<ReaderFixtureActivity>()
    private val key = "question-thread-fixture"
    private val thread = "android-qa-thread"
    private fun app() = compose.activity.application as ReaderApplication
    private fun seed(id: String, question: String, answer: String, created: String, threadId: String? = thread) {
        runBlocking { app().database.metadata().upsert(HistoryEntity(id, key, "completed", false, 1, created, buildJsonObject {
            put("kind", "question"); put("question", question); put("text", answer); put("createdAt", created)
            put("context", buildJsonObject { threadId?.let { put("threadId", it) }; put("page", 3); if (id == "qa-first") put("selectedText", "The model uses earlier turns as context.") })
        }.toString())) }
    }
    private fun panel(tabStart: String = "questions") {
        app().credentials.clear()
        runBlocking {
            app().database.metadata().observeHistory(key).first().forEach { app().database.metadata().upsert(it.copy(deleted = true)) }
            // Each test uses a fresh local request table on this dedicated emulator.
            app().database.openHelper.writableDatabase.execSQL("DELETE FROM ai_requests WHERE paperKey = ?", arrayOf(key))
        }
        app().settings.edit().remove("cachedReaderProviders").commit()
        seed("qa-first", "How does the method use context?", "It combines the current passage with earlier turns.", "2026-10-01T00:00:00Z")
        seed("qa-second", "Why keep the earlier turns?", "They preserve the reasoning behind your follow-up.", "2026-10-01T00:01:00Z")
        seed("qa-legacy", "An older question", "A retained legacy answer.", "2026-09-01T00:00:00Z", null)
        compose.setContent {
            var tab by remember { mutableStateOf(tabStart) }
            var active by remember { mutableStateOf(thread) }
            var quote by remember { mutableStateOf<Pair<Int, PdfTextSelection>?>(3 to PdfTextSelection("The model uses earlier turns as context.", emptyList())) }
            FractalTheme { DurableReaderPanel(app(), key, emptyList(), null, tab, { tab = it }, {}, Modifier.fillMaxSize(), quote, { quote = null }, {}, threadId = active, onThreadChange = { active = it }) }
        }
        compose.waitUntil(10000) { compose.onAllNodesWithTag("reader-quote-attachment").fetchSemanticsNodes().isNotEmpty() || tabStart == "history" }
    }
    private fun snapshot(name: String) {
        compose.waitForIdle()
        val image = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val dir = File(compose.activity.getExternalFilesDir(null), "question-thread").apply { mkdirs() }
        File(dir, name).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }; image.recycle()
    }
    @Test fun twoTurnsAttachmentEditingAndSendingKeepAnswers() {
        panel()
        compose.onNodeWithTag("reader-thread-input").performTextInput("What changes for a follow-up?")
        compose.activity.runOnUiThread { (compose.activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(compose.activity.window.decorView.windowToken, 0) }
        compose.onNodeWithText("They preserve the reasoning behind your follow-up.").assertExists()
        snapshot("two-turn-thread-with-chip.png")
        compose.onNodeWithTag("reader-remove-attachment").performClick()
        compose.onNodeWithTag("reader-quote-attachment").assertDoesNotExist()
        compose.onNodeWithText("They preserve the reasoning behind your follow-up.").assertExists()
        compose.onNodeWithTag("reader-thread-input").performTextClearance()
        compose.onNodeWithText("They preserve the reasoning behind your follow-up.").assertExists()
        compose.onNodeWithTag("reader-thread-model").performClick()
        compose.onNodeWithText(if (compose.activity.resources.configuration.locales[0].language == "ko") "허브 기본값" else "Hub default").performClick()
        compose.onNodeWithText("They preserve the reasoning behind your follow-up.").assertExists()
        compose.onNodeWithTag("reader-thread-input").performTextInput("What changes for a follow-up?")
        compose.onNodeWithTag("reader-thread-send").performClick()
        compose.waitUntil(10000) { runBlocking { app().database.reader().observeRequests(key).first().any { it.kind == "question" } } }
        val request = runBlocking { app().database.reader().observeRequests(key).first().first { it.kind == "question" } }
        val body = readerJson(request.bodyJson)
        assertEquals(thread, body.threadText("threadId")); assertFalse("answerLanguage" in body); assertFalse("selectedText" in body)
        compose.onNodeWithTag("reader-thread-input").assertTextContains("", substring = false)
        compose.onNodeWithTag("reader-new-question").performClick()
        compose.onNodeWithText("They preserve the reasoning behind your follow-up.").assertDoesNotExist()
        assertEquals(3, readerThreads(runBlocking { app().database.metadata().observeHistory(key).first() }, runBlocking { app().database.reader().observeRequests(key).first() }).first { it.id == thread }.turns.size)
    }
    @Test fun historyOpensLegacyAndFollowUpUsesLegacyIdentity() {
        panel("history")
        compose.waitUntil(10000) { compose.onAllNodesWithTag("reader-thread-qa-legacy").fetchSemanticsNodes().isNotEmpty() }
        snapshot("thread-history.png")
        compose.onNodeWithTag("reader-thread-qa-legacy").performClick()
        compose.onNodeWithText("A retained legacy answer.").assertExists()
        compose.onNodeWithTag("reader-thread-input").performTextInput("Continue the older question")
        compose.onNodeWithTag("reader-thread-send").performClick()
        compose.waitUntil(10000) { runBlocking { app().database.reader().observeRequests(key).first().any { it.kind == "question" } } }
        val request = runBlocking { app().database.reader().observeRequests(key).first().first { it.kind == "question" } }
        assertEquals("qa-legacy", readerJson(request.bodyJson).threadText("threadId"))
        assertEquals("The model uses earlier turns as context.", readerJson(request.bodyJson).threadText("selectedText"))
        compose.onNodeWithTag("reader-quote-attachment").assertDoesNotExist()
    }
}
