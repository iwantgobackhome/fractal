package app.fractal.data

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

/** Published B fixture: cropped/rotated pages, proportional advances, ligatures and Unicode. */
class OriginalTextGeometryTest {
    private val fixtures = javaClass.getResourceAsStream("/text-layout-pages.json")!!.bufferedReader().use { reader ->
        WireJson.format.parseToJsonElement(reader.readText()).jsonArray.map {
            WireJson.format.decodeFromString<OriginalTextPage>(it.jsonObject.getValue("page").toString())
        }
    }
    private val hash = javaClass.getResourceAsStream("/text-layout.pdf")!!.use {
        java.security.MessageDigest.getInstance("SHA-256").digest(it.readBytes()).joinToString("") { byte -> "%02x".format(byte) }
    }
    private fun envelope(page: OriginalTextPage) = PdfTextLayout("ready", "fixture", PDF_TEXT_LAYOUT_VERSION, hash, 5, page)
    private fun center(quad: List<List<Double>>, rotation: Int): TextPoint = rotateTextPoint(
        TextPoint(quad.map { it[0] }.average(), quad.map { it[1] }.average()), rotation)

    @Test fun publishedRotatedAndCroppedPagesSelectOriginalWords() {
        assertEquals(hash, "f79b45a88b17b236ade1298edf4cafdceae6a9f19907eb29126332a7c9037b96")
        for (page in fixtures.take(3)) {
            assertNotNull(envelope(page).verifiedPage("fixture", hash, page.page, 5), "Invalid published page ${page.page}")
            val word = page.runs.flatMap { it.words }.first { page.text.substring(it.start, it.end) == "iii" }
            val point = center(word.quad!!, page.rotation)
            val result = OriginalTextGeometry(page).wordAt(point.x, point.y)!!
            assertEquals(result.text, "iii")
            assertEquals(result.start, word.start); assertEquals(result.end, word.end)
            assertEquals(result.displayQuads.first().first(), rotateTextPoint(result.originalQuads.first().first(), page.rotation))
        }
    }
    @Test fun glyphGroupsRemainIndivisibleAndTextIsUnmodified() {
        val page = fixtures[4]
        assertNotNull(envelope(page).verifiedPage("fixture", hash, 5, 5))
        val geometry = OriginalTextGeometry(page)
        for (text in listOf("fi", "e\u0301", "😀")) {
            val unit = page.runs.flatMap { it.units }.first { page.text.substring(it.start, it.end) == text }
            val point = center(unit.quad!!, page.rotation)
            val range = geometry.select(point.x, point.y, point.x, point.y)!!
            assertEquals(range.text, text)
            assertEquals(range.start, unit.start); assertEquals(range.end, unit.end)
            assertTrue(range.start in page.boundaries && range.end in page.boundaries)
            if (range.end - range.start > 1) assertNull(geometry.range(range.start, range.start + 1))
        }
        val runs = fixtures[0].runs.take(3)
        val range = OriginalTextGeometry(fixtures[0]).range(runs.first().start, runs.last().end)!!
        assertEquals(range.text, fixtures[0].text.substring(runs.first().start, runs.last().end))
        assertTrue(range.text.contains('\n'))
    }
    @Test fun staleHashVersionPageCountAndIllegalUnicodeBoundariesCannotHit() {
        val value = envelope(fixtures[4])
        assertNull(value.verifiedPage("other-paper", hash, 5, 5))
        assertNull(value.verifiedPage("fixture", "0".repeat(64), 5, 5))
        assertNull(value.copy(extractionVersion = "unknown-version").verifiedPage("fixture", hash, 5, 5))
        assertNull(value.verifiedPage("fixture", hash, 4, 5)); assertNull(value.verifiedPage("fixture", hash, 5, 4))
        val surrogate = fixtures[4].text.indexOf("😀") + 1
        val invalid = fixtures[4].copy(boundaries = (fixtures[4].boundaries + surrogate).distinct().sorted())
        assertNull(value.copy(page = invalid).verifiedPage("fixture", hash, 5, 5))
    }
    @Test fun noTextHasNoFabricatedRangeAndHandlesSnapToLegalEdges() {
        val empty = fixtures[3]
        assertNotNull(envelope(empty).verifiedPage("fixture", hash, 4, 5))
        assertNull(OriginalTextGeometry(empty).wordAt(.5, .5))
        val page = fixtures[4]; val geometry = OriginalTextGeometry(page)
        for (unit in page.runs.flatMap { it.units }.filter { it.quad != null }) {
            val point = center(unit.quad!!, page.rotation)
            assertTrue(geometry.endpointAt(point.x, point.y) in page.boundaries)
        }
    }
}
