package app.fractal.reader

import app.fractal.data.*
import app.fractal.pdf.*
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class ReaderThreadsTest {
    private fun history(id: String, time: String, thread: String? = null) = HistoryEntity(id, "paper", "completed", false, 1, time, buildJsonObject {
        put("kind", "question"); put("question", "Question $id"); put("text", "Answer $id"); put("createdAt", time)
        put("context", buildJsonObject { thread?.let { put("threadId", it) } })
    }.toString())
    private fun request(id: String, thread: String, historyId: String? = null) = AiRequestEntity(id, "paper", "question",
        """{"question":"Pending turn","threadId":"$thread"}""", "{}", "sending", historyId, null, false, "03", "03")

    @Test fun groupsThreadsChronologicallyAndKeepsLegacySingleTurns() {
        val threads = readerThreads(listOf(history("b", "02", "chat"), history("old", "01"), history("a", "01", "chat"), history("other", "00")), emptyList())
        assertEquals(threads.first { it.id == "chat" }.turns.map { it.id }, listOf("a", "b"))
        assertEquals(threads.first { it.id == "chat" }.title, "Question a")
        assertEquals(threads.first { it.id == "old" }.turns.size, 1)
        assertEquals(threads.size, 3)
    }
    @Test fun legacyFollowUpsUseOriginalEntryId() {
        val threads = readerThreads(listOf(history("legacy", "01"), history("follow", "02", "legacy")), listOf(request("pending", "legacy")))
        assertEquals(threads.size, 1)
        assertEquals(threads.single().turns.map { it.id }, listOf("legacy", "follow", "pending"))
        assertEquals(readerThreadId("legacy", readerJson("{}")), "legacy")
    }
    @Test fun localIntentDoesNotDuplicateAttachedHistoryAndSurvivesMissingRemoteContext() {
        val threads = readerThreads(listOf(history("remote", "02")), listOf(request("local", "chat", "remote")))
        assertEquals(threads.single().id, "chat")
        assertEquals(threads.single().turns.size, 1)
        assertEquals(threads.single().turns.single().request?.requestId, "local")
    }
    @Test fun attachedIntentStaysVisibleWhileHistoryRefreshIsInFlight() {
        val threads = readerThreads(emptyList(), listOf(request("pending", "chat", "not-yet-cached")))
        assertEquals(threads.single().id, "chat")
        assertEquals(threads.single().turns.single().status, "sending")
    }
    @Test fun askAndExplainCarryThreadWithoutOverridingHubLanguage() {
        val selection = 3 to PdfTextSelection("Excerpt", listOf(PdfRect(.1f, .2f, .3f, .04f)))
        val ask = readerQuestionBody("Why?", null, null, selection, "chat")
        val explain = readerExplainBody(null, null, selection, threadId = "chat")
        for (body in listOf(ask, explain)) {
            assertEquals(body["threadId"]?.jsonPrimitive?.content, "chat")
            assertFalse("answerLanguage" in body)
            assertEquals(body["page"]?.jsonPrimitive?.int, 3)
        }
    }
}
