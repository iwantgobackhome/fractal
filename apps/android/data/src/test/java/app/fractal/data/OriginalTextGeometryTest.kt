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

    @Test fun malformedRunEdgesFallBackWithoutCrashing() {
        val base = fixtures.first()
        val quad = listOf(listOf(.1,.3), listOf(.1,.2), listOf(.5,.2), listOf(.5,.3))
        val run = OriginalTextRun(0, 4, quad, "ltr", "run", "approximate",
            listOf(OriginalTextUnit(1, 3, quad)), emptyList())
        val geometry = OriginalTextGeometry(base.copy(text = "test", runs = listOf(run), boundaries = listOf(0, 2, 4), rotation = 0))
        assertNotNull(geometry.handlePoint(1, false))
    }

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
    private fun run(start: Int, text: String, x: Double, y: Double, width: Double = .3) = OriginalTextRun(
        start, start + text.length, listOf(listOf(x,y+.03), listOf(x,y), listOf(x+width,y), listOf(x+width,y+.03)),
        "ltr", "run", "approximate", listOf(OriginalTextUnit(start, start+text.length,
            listOf(listOf(x,y+.03),listOf(x,y),listOf(x+width,y),listOf(x+width,y+.03)))), emptyList())
    private fun page(text: String, runs: List<OriginalTextRun>) = OriginalTextPage(1, listOf(0.0,0.0,600.0,800.0),
        600.0,800.0,1.0,0,text,runs,(0..text.length).toList(),"text",emptyList(),"geometric-heuristic")

    @Test fun partialDragInsideRunUsesCharacterGeometryAndHandles() {
        val geometry = OriginalTextGeometry(page("abcdefghij", listOf(run(0,"abcdefghij",.1,.1,.5))))
        val range = geometry.select(.211,.115,.339,.115)!!
        assertEquals(range.text,"cde")
        assertEquals(range.start,2); assertEquals(range.end,5)
        assertEquals(geometry.handlePoint(2,false)!!.x,.2,.00001)
        assertEquals(geometry.handlePoint(5,true)!!.x,.35,.00001)
        assertEquals(geometry.endpointAt(.299,.115),4)
        assertEquals(geometry.wordAt(.211,.115)!!.text,"abcdefghij")
    }

    @Test fun dragDownOneColumnExcludesInterleavedOtherColumn() {
        val geometry = OriginalTextGeometry(page("leftOTHERnext", listOf(
            run(0,"left",.1,.1),run(4,"OTHER",.6,.15),run(9,"next",.1,.2))))
        val range = geometry.select(.11,.115,.38,.215)!!
        assertEquals(range.text,"left\nnext")
        assertEquals(range.displayQuads.size,8)
        assertTrue(range.displayQuads.all { quad -> quad.maxOf { it.x } <= .4 })
    }

    @Test fun nearestUsesRectangleEdgeInsteadOfCenter() {
        val wide = OriginalTextRun(0,1,listOf(listOf(.1,.13),listOf(.1,.1),listOf(.8,.1),listOf(.8,.13)),
            "ltr","glyph-advance","approximate",listOf(OriginalTextUnit(0,1,listOf(listOf(.1,.13),listOf(.1,.1),listOf(.8,.1),listOf(.8,.13)))),emptyList())
        val geometry = OriginalTextGeometry(page("ab",listOf(wide,run(1,"b",.1,.2,.03))))
        assertEquals(geometry.endpointAt(.105,.14),0)
    }

    @Test fun runLongPressFindsOneWordAndInterpolationKeepsUnicodeBoundaries() {
        val words = OriginalTextGeometry(page("one two",listOf(run(0,"one two",.1,.1,.7))))
        assertEquals(words.wordAt(.55,.115)!!.text,"two")
        val unicode = page("a😀b",listOf(run(0,"a😀b",.1,.1,.4))).copy(boundaries=listOf(0,1,3,4))
        val geometry = OriginalTextGeometry(unicode)
        assertEquals(geometry.select(.25,.115,.35,.115)!!.text,"😀")
        assertTrue(geometry.endpointAt(.3,.115) in unicode.boundaries)
    }

    @Test fun runWithOnlyEdgeBoundariesStillSelectsCharacters() {
        val text = "abcdefghij"
        val geometry = OriginalTextGeometry(page(text, listOf(run(0, text, .1, .1, .5))).copy(boundaries = listOf(0, text.length)))
        val range = geometry.select(.211, .115, .339, .115)!!
        assertEquals(range.text, "cde")
        assertEquals(geometry.endpointAt(.299, .115), 4)
        assertEquals(geometry.range(3, 7)!!.text, "defg")
        // Synthesized offsets select characters but are not published layout boundaries.
        assertFalse(geometry.page.publishes(3)); assertTrue(geometry.page.publishes(text.length))
    }

    @Test fun mathRunSlightlyAboveBaselineStaysInItsVisualLine() {
        // Published order puts "6" (a hair higher) before the rest of its own line.
        val text = "6\nprev line\nThe encoder N = \nidentical"
        val geometry = OriginalTextGeometry(page(text, listOf(
            run(0, "6", .52, .199, .02), run(2, "prev line", .1, .15, .5),
            run(12, "The encoder N = ", .1, .2, .4), run(29, "identical", .55, .2, .2))).copy(boundaries = listOf(0, 1, 2, 11, 12, 28, 29, 38)))
        val range = geometry.select(.105, .215, .749, .215)!!
        assertEquals(range.text, "The encoder N = 6 identical")
        assertFalse(range.text.contains("prev"))
        assertTrue(range.text.startsWith("The encoder N = 6"))
    }
}
