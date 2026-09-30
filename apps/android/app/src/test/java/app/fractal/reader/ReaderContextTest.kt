package app.fractal.reader

import app.fractal.pdf.PdfRect
import app.fractal.pdf.PdfTextSelection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.testng.Assert.*
import org.testng.annotations.Test

class ReaderContextTest {
    @Test fun memoBodyNeverGetsReplacedByItsQuote() {
        fun note(raw: String) = readerNoteText("memo", Json.parseToJsonElement(raw).jsonObject)
        assertEquals(note("""{"quote":"Selected sentence","text":"My observation"}"""), ReaderNoteText("Selected sentence", "My observation"))
        assertEquals(note("""{"quote":"","text":"A region memo"}"""), ReaderNoteText("", "A region memo"))
        assertEquals(note("""{"text":"Legacy memo"}"""), ReaderNoteText("", "Legacy memo"))
        assertEquals(note("""{"quote":null,"text":"Unquoted memo"}"""), ReaderNoteText("", "Unquoted memo"))
        assertEquals(readerNoteText("highlight", Json.parseToJsonElement("""{"text":"Highlighted quote","note":"Highlight note"}""").jsonObject), ReaderNoteText("Highlighted quote", "Highlight note"))
    }

    @Test fun selectedQuoteAndPageReachTheExistingAskPayloadAndCompatibilityRetry() {
        val body = readerQuestionBody("Explain this", "ko", "openai" to "fixture", 3 to PdfTextSelection(
            "Selected passage", listOf(PdfRect(.1f, .2f, .3f, .04f)),
        ))
        val retried = JsonObject(body.filterKeys { it != "answerLanguage" })
        assertEquals(body["question"]?.jsonPrimitive?.content, "Explain this")
        assertEquals(body["selectedText"]?.jsonPrimitive?.content, "Selected passage")
        assertEquals(body["page"]?.jsonPrimitive?.content, "3")
        assertEquals(retried["selectedText"], body["selectedText"])
        assertEquals(retried["rect"], body["rect"])
        assertEquals(body["selection"]?.jsonObject?.get("model")?.jsonPrimitive?.content, "fixture")
    }

    @Test fun regionContextFitsThePageAndOrdinaryQuestionsHaveNoSelection() {
        val body = readerQuestionBody("Explain region", "en", null, 2 to PdfTextSelection("", listOf(PdfRect(.95f, .99f, .16f, .024f))))
        assertFalse("selectedText" in body)
        val rect = body["rect"]!!.jsonObject
        fun number(key: String) = rect[key]!!.jsonPrimitive.content.toDouble()
        assertTrue(number("x") + number("width") <= 1)
        assertTrue(number("y") + number("height") <= 1)
        val plain = readerQuestionBody("General question", "en", null, null)
        assertFalse("selectedText" in plain); assertFalse("page" in plain); assertFalse("rect" in plain)
    }
}
