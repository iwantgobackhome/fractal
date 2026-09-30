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
}
