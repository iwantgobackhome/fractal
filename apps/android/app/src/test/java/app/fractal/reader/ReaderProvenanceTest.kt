package app.fractal.reader

import app.fractal.data.WireJson
import app.fractal.pdf.*
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class ReaderProvenanceTest {
    @Test fun legacyAndRenderedPositionsStayUnchangedAndDeclaredUnrotatedTransformsOnce() {
        val rect = PdfRect(.2f, .3f, .1f, .2f)
        assertSame(renderedRect(rect, null, 90), rect)
        val declared = WireJson.format.parseToJsonElement("""{"coordinateSpace":"rendered-page-normalized-v1"}""").jsonObject
        assertSame(renderedRect(rect, declared, 90), rect)
        val unrotated = WireJson.format.parseToJsonElement("""{"coordinateSpace":"unrotated-crop-normalized-v1","pdfSha256":"${"a".repeat(64)}"}""").jsonObject
        val before = unrotated.toString(); val displayed = renderedRect(rect, unrotated, 90)
        assertEquals(displayed.x.toDouble(), .5, .00001); assertEquals(displayed.y.toDouble(), .2, .00001)
        assertEquals(displayed.width.toDouble(), .2, .00001); assertEquals(displayed.height.toDouble(), .1, .00001)
        assertEquals(unrotated.toString(), before)
        assertEquals(sourceContextStatus(unrotated, "b".repeat(64), 2, null), "pdf_changed")
    }
    @Test fun translatedQuoteHasNoOriginalOffsetsOrRectAndOriginalRangeBindsOnePhysicalPage() {
        val translated = readerQuestionBody("Quote", "zh-Hant", null, 4 to PdfTextSelection("原文ではない引用", listOf(PdfRect(.1f, .1f, .2f, .2f)), 0, 3, origin = "translated"))
        assertFalse("rect" in translated)
        assertEquals(translated["provenance"]!!.jsonObject.toString(), "{\"textSource\":\"translated\"}")
        val original = selectionProvenance(2, PdfTextSelection("iii", emptyList(), 17, 20, provenance = "cached-original-approximate", pdfSha256 = "a".repeat(64), extractionVersion = "pdfjs6-original-advances-v1"))
        assertEquals(original["layoutRange"]!!.jsonObject["page"]!!.jsonPrimitive.int, 2)
        assertEquals(sourceContextStatus(original, "a".repeat(64), 3, null), "range_invalid")
    }
}
