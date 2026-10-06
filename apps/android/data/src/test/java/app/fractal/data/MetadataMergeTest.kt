package app.fractal.data

import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class MetadataMergeTest {
    private fun json(value: String) = WireJson.format.parseToJsonElement(value).jsonObject
    @Test fun independentMembershipsSurviveThreeWayMerge() {
        val base = json("""{"tags":["old","keep"],"collections":["orphan","folder1"],"title":"original"}""")
        val remote = json("""{"tags":["old","keep","remote"],"collections":["orphan","folder1","folder2"],"title":"remote title"}""")
        val result = MetadataMerge.apply(remote, base, json("""{"tags":["keep","local"],"collections":["orphan","folder1","folder3"]}"""))
        assertEquals(result["tags"], json("""{"tags":["keep","remote","local"]}""")["tags"])
        assertEquals(result["collections"]?.jsonArray?.map { it.jsonPrimitive.content }, listOf("orphan", "folder1", "folder2", "folder3"))
        assertEquals(result.text("title"), "remote title")
    }
    @Test fun lastReadNeverMovesBackwards() {
        assertEquals(MetadataMerge.apply(json("""{"lastReadAt":"2026-02-01"}"""), json("{}"),
            json("""{"lastReadAt":"2026-01-01"}""")).text("lastReadAt"), "2026-02-01")
    }
    @Test fun readTimeAndPageBelongToTheSameWinningEvent() {
        val remote = json("""{"lastReadAt":"2026-02-01T00:00:00.000Z","readProgress":{"page":7}}""")
        val old = MetadataMerge.apply(remote, json("{}"), json("""{"lastReadAt":"2026-01-01T00:00:00Z","readProgress":{"page":2}}"""))
        assertEquals(old.text("lastReadAt"), remote.text("lastReadAt")); assertEquals(old["readProgress"], remote["readProgress"])
        val equal = MetadataMerge.apply(remote, json("{}"), json("""{"lastReadAt":"2026-02-01T00:00:00Z","readProgress":{"page":2}}"""))
        assertEquals(equal.text("lastReadAt"), remote.text("lastReadAt")); assertEquals(equal["readProgress"], remote["readProgress"])
        val progressOnly = MetadataMerge.apply(remote, json("{}"), json("""{"readProgress":{"page":8}}"""))
        assertEquals(progressOnly.text("lastReadAt"), remote.text("lastReadAt"))
        assertEquals(progressOnly["readProgress"]!!.jsonObject.text("page"), "8")
        val newer = MetadataMerge.apply(remote, json("{}"), json("""{"lastReadAt":"2026-02-01T00:00:00.000001Z","readProgress":{"page":3}}"""))
        assertEquals(newer.text("lastReadAt"), "2026-02-01T00:00:00.000001Z")
        assertEquals(newer["readProgress"]!!.jsonObject.text("page"), "3")
    }
    @Test fun translationUsesPhysicalRegionsAndStableIds() {
        val snapshot = json("""{"blocks":[{"blockId":"b","order":2,"pageOrdinal":1,"regions":[{"page":7}],"sourceText":"Source"},{"blockId":"unlocated","order":1,"pageOrdinal":2,"regions":[],"sourceText":"Unknown"}],"translations":[{"blockId":"b","status":"completed","text":"Translation"}]}""")
        assertEquals(translatedBlocks(snapshot), listOf(TranslatedBlock("b", 7, "", "Translation")))
    }
    @Test fun translationKeepsSourceCropsInReadingOrderAndCaptionText() {
        val snapshot = json("""{"blocks":[
            {"blockId":"caption","order":3,"kind":"caption","sourceText":"Original caption","regions":[{"page":2}]},
            {"blockId":"figure","order":2,"kind":"figure","regions":[{"page":2,"x":0.1,"y":0.2,"width":0.8,"height":0.3},{"page":3,"x":0.2,"y":0.1,"width":0.5,"height":0.4}]},
            {"blockId":"heading","order":1,"kind":"heading","sourceText":"Heading","regions":[{"page":2}]},
            {"blockId":"table","order":4,"kind":"table","regions":[{"page":3,"x":0,"y":0,"width":1,"height":0.5}]},
            {"blockId":"equation","order":5,"kind":"equation","sourceText":"do not translate","regions":[{"page":3,"x":0.1,"y":0.5,"width":0.7,"height":0.1}]},
            {"blockId":"unsupported","order":6,"kind":"unsupported","regions":[{"page":3,"x":0.1,"y":0.6,"width":0.7,"height":0.2}]},
            {"blockId":"invalid","order":7,"kind":"figure","regions":[{"page":3,"x":1,"y":0,"width":1,"height":1}]}
        ],"translations":[{"blockId":"caption","status":"completed","text":"Translated caption"}]}""")
        val blocks = translatedBlocks(snapshot)
        assertEquals(blocks.map { it.blockId }, listOf("heading", "figure", "caption", "table", "equation", "unsupported"))
        assertEquals(blocks[1].regions, listOf(TranslatedRegion(2, .1f, .2f, .8f, .3f), TranslatedRegion(3, .2f, .1f, .5f, .4f)))
        assertEquals(blocks[2].text, "Translated caption")
        assertFalse(blocks[0].translated)
        assertTrue(blocks.filter { it.isSourceCrop }.all { it.text.isEmpty() && !it.translated })
        assertEquals(translatedBlocks(JsonObject(snapshot + ("translations" to JsonArray(emptyList())))), emptyList<TranslatedBlock>())
    }
    @Test fun lineRegionsOfOneFigureBecomeOneCropPerPage() {
        val snapshot = json("""{"blocks":[
            {"blockId":"eq","order":1,"kind":"equation","regions":[{"page":4,"x":0.2,"y":0.5,"width":0.3,"height":0.02},{"page":4,"x":0.1,"y":0.53,"width":0.5,"height":0.02}]}
        ],"translations":[{"blockId":"other","status":"completed","text":"x"}]}""")
        assertEquals(translatedBlocks(snapshot).single().regions.single().let { listOf(it.page.toFloat(), it.x, it.y) }, listOf(4f, .1f, .5f))
        val crop = translatedBlocks(snapshot).single().regions.single()
        assertEquals(.5f, crop.width, 1e-5f); assertEquals(.05f, crop.height, 1e-5f)
    }

}
