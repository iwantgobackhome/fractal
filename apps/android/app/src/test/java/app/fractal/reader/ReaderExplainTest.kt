package app.fractal.reader

import app.fractal.pdf.*
import app.fractal.sync.*
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class ReaderExplainTest {
    @Test fun imageQuestionKeepsShortQuestionAndHiddenContext() {
        val item = StructureItem("id", "figure", 2, StructureBox(.1, .2, .3, .4), "Figure 3", "Caption", null)
        val selected = structureSelection(item, "a".repeat(64))
        val body = readerBodyWithImage(readerExplainBody("ko", null, selected, item, "x".repeat(6000)), "png")
        assertEquals(body["croppedPngBase64"]?.jsonPrimitive?.content, "png")
        assertEquals(body["question"]?.jsonPrimitive?.content, "Figure 3 설명")
        assertTrue(body["surroundingText"]!!.jsonPrimitive.content.length < 1600)
        val region = 1 to PdfTextSelection("", listOf(PdfRect(.1f, .2f, .3f, .4f)), provenance = "deliberate-region")
        val ask = readerBodyWithImage(readerQuestionBody("Why?", null, null, region), "png")
        assertEquals(ask["question"]!!.jsonPrimitive.content, "Why?")
        assertEquals(ask["attachment"]!!.jsonObject["kind"]!!.jsonPrimitive.content, "region")
        assertEquals(ask["croppedPngBase64"]!!.jsonPrimitive.content, "png")
    }

    @Test fun structureKindsContextAndOriginalProvenanceSurvive() {
        for (kind in listOf("figure", "table", "equation")) {
            val item = StructureItem("id", kind, 2, StructureBox(.1, .2, .3, .4), "Label", "Caption", "x=y")
            val selected = structureSelection(item, "a".repeat(64))
            val body = readerExplainBody("ko", "provider" to "model", selected, item, "Page context")
            assertEquals(body["kind"]?.jsonPrimitive?.content, kind)
            assertEquals(body["surroundingText"]?.jsonPrimitive?.content, "Label\nCaption\nx=y\nPage context")
            assertEquals(body["page"]?.jsonPrimitive?.int, 2)
            assertEquals(body["provenance"]?.jsonObject?.get("pdfSha256")?.jsonPrimitive?.content, "a".repeat(64))
            assertEquals(body["selection"]?.jsonObject?.get("model")?.jsonPrimitive?.content, "model")
            assertEquals(body["question"]?.jsonPrimitive?.content, "Label 설명"); assertFalse(body.containsKey("rect"))
            assertTrue(body.containsKey("bbox")); assertTrue(body.containsKey("attachment"))
        }
    }
    @Test fun pageContextUsesPhysicalRegionsAndOriginalText() {
        val snapshot = app.fractal.data.WireJson.format.parseToJsonElement("""{"blocks":[
            {"order":2,"pageOrdinal":1,"sourceText":"second","regions":[{"page":3}]},
            {"order":1,"pageOrdinal":99,"sourceText":"first","regions":[{"page":3},{"page":3}]}
        ],"translations":[{"text":"translated"}]}""").jsonObject
        assertEquals(structurePageContext(snapshot), mapOf(3 to "first\nsecond"))
    }
    @Test fun textAndRegionRequestsKeepExistingKinds() {
        val region = PdfTextSelection("", listOf(PdfRect(.1f, .2f, .3f, .4f)))
        assertEquals(readerExplainBody("auto", null, 1 to region)["kind"]?.jsonPrimitive?.content, "figure")
        assertEquals(readerExplainBody("auto", null, 1 to region.copy(text = "quote"))["kind"]?.jsonPrimitive?.content, "text")
    }
}
