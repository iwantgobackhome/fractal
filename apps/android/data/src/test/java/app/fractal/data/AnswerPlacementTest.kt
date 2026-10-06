package app.fractal.data

import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class AnswerPlacementTest {
    private fun row(id: String, date: String, thread: String = "thread") = historyEntity(buildJsonObject {
        put("id", id); put("createdAt", date); put("context", buildJsonObject { put("threadId", thread) })
    })
    @Test fun namedRootWinsAndLegacyUsesOldest() {
        val older = row("old", "2026-01-01T00:00:00Z")
        val newer = row("new", "2026-02-01T00:00:00Z")
        val root = row("thread", "2026-03-01T00:00:00Z")
        assertEquals(answerThreadRoot(listOf(newer, older, root), "thread"), root)
        assertEquals(answerThreadRoot(listOf(newer, older), "thread"), older)
        assertNull(answerThreadRoot(listOf(older), "missing"))
    }
    @Test fun placementRoundTripsWithoutChangingHistoryContext() {
        val placement = AnswerPlacement(3, .25f, .5f, "collapsed", "2026-01-01T00:00:00Z")
        val original = WireJson.format.parseToJsonElement(row("thread", "today").json).jsonObject
        val json = JsonObject(original + ("placement" to placement.json()))
        assertEquals(historyEntity(json).answerPlacement(), placement)
        assertEquals(WireJson.format.decodeFromString<AnswerPlacement>(placement.json().toString()), placement)
        assertEquals(json["context"], original["context"])
    }
    @Test fun newerPlacementWinsAcrossEquivalentIsoFormats() {
        val remote = AnswerPlacement(1, .2f, .3f, "dismissed", "2026-01-02T00:00:00Z")
        val stale = remote.copy(state = "open", updatedAt = "2026-01-01T00:00:00Z")
        val current = buildJsonObject { put("placement", remote.json()); put("text", "kept") }
        assertEquals(MetadataMerge.apply(current, JsonObject(emptyMap()), buildJsonObject { put("placement", stale.json()) })["placement"], remote.json())
        val newer = stale.copy(updatedAt = "2026-01-02T00:00:00.001Z")
        val result = MetadataMerge.apply(current, JsonObject(emptyMap()), buildJsonObject { put("placement", newer.json()) })
        assertEquals(result["placement"], newer.json()); assertEquals(result.text("text"), "kept")
    }
}
