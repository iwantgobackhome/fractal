package app.fractal.sync

import app.fractal.data.*
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class HistoryPlacementWireTest {
    @Test fun placementPushRetainsFullHubEntryShape() {
        val base = WireJson.format.parseToJsonElement("""{
          "id":"root","paperKey":"paper","kind":"question","question":"Why?","text":"Answer",
          "status":"completed","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z",
          "completedAt":"2026-01-01T00:00:00Z","requestId":"request","context":{"threadId":"root","page":1},
          "answer":null,"error":null,"rev":3,"deviceId":"hub","deleted":false,
          "conversation":{"conversationId":"conversation","messages":[]}
        }""").jsonObject
        val placement = AnswerPlacement(1, .2f, .4f, "collapsed", "2026-01-02T00:00:00Z")
        val mutation = MetadataMutation("edit", "history", "root", 3, base.toString(),
            buildJsonObject { put("id", "root"); put("placement", placement.json()) }.toString(), "android", 1)
        val pushed = historyMutationEntry(mutation)
        assertTrue(pushed.keys.containsAll(setOf("id", "paperKey", "kind", "question", "text", "status", "createdAt", "updatedAt", "completedAt", "requestId", "context", "answer", "error", "rev", "deviceId", "deleted")))
        base.filterKeys { it != "deviceId" }.forEach { (field, value) -> assertEquals(pushed[field], value, field) }
        assertEquals(pushed["placement"], placement.json()); assertEquals(pushed.text("deviceId"), "android")
        assertEquals(mutation.baseRev, 3)
    }
}
