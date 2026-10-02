package app.fractal.sync

import kotlinx.serialization.json.*
import org.testng.Assert.assertEquals
import org.testng.Assert.assertThrows
import org.testng.Assert.assertTrue
import org.testng.annotations.Test

class WireTest {
    @Test
    fun pairingPayload() {
        val json = """{"v":1,"name":"Office","hubId":"123e4567-e89b-12d3-a456-426614174000","urls":["http://10.0.2.2:7410"],"code":"abc"}"""
        assertEquals(PairingPayloadParser.parse(json).urls.single(), "http://10.0.2.2:7410")
        assertThrows(IllegalArgumentException::class.java) {
            PairingPayloadParser.parse(json.replace("\"v\":1", "\"v\":2"))
        }
    }

    @Test
    fun pairingExtensionsAndEmptyUrls() {
        val raw = """{"v":1,"name":"Office","hubId":"123e4567-e89b-12d3-a456-426614174000","urls":["http://host"],"code":"abc","future":true}"""
        assertEquals(PairingPayloadParser.parse(raw).code, "abc")
        assertThrows(NoPairingUrlsException::class.java) {
            PairingPayloadParser.parse(raw.replace("[\"http://host\"]", "[]"))
        }
    }

    @Test
    fun syncBatchesBoundInkBytesAndPreserveOrder() {
        val ink = (0 until 200).map { buildJsonObject {
            put("id", it); put("kind", "ink"); put("points", "한".repeat(400))
        } }
        val batches = SyncPushBatches.split(buildJsonObject { put("annotations", JsonArray(ink)) })
        assertTrue(JsonArray(ink).toString().toByteArray(Charsets.UTF_8).size > 200 * 1024)
        assertTrue(batches.size > 1)
        assertTrue(batches.all { it.toString().toByteArray(Charsets.UTF_8).size <= SyncPushBatches.MAX_BYTES })
        assertEquals(batches.flatMap { it.getValue("annotations").jsonArray }, ink)
    }

    @Test
    fun syncBatchesBoundArrayCountsAndRejectOversizedItem() {
        val rows = (0 until 2001).map { buildJsonObject { put("id", it) } }
        val batches = SyncPushBatches.split(buildJsonObject { put("folders", JsonArray(rows)) })
        assertEquals(batches.map { it.getValue("folders").jsonArray.size }, listOf(1000, 1000, 1))
        assertEquals(batches.flatMap { it.getValue("folders").jsonArray }, rows)
        assertThrows(IllegalArgumentException::class.java) {
            SyncPushBatches.split(buildJsonObject {
                put("annotations", JsonArray(listOf(JsonPrimitive("x".repeat(50000)))))
            })
        }
    }

    @Test
    fun rangeResume() {
        assertEquals(RangePlan.forPartial(4096, "\"sha\"").range, "bytes=4096-")
        assertEquals(RangePlan.forPartial(4096, "\"sha\"").ifRange, "\"sha\"")
        assertTrue(RangePlan.forPartial(4096, null).appendOnPartial)
        assertEquals(RangePlan.forPartial(0, null).range, null)
    }

    @Test
    fun sseCitations() {
        val parser = SseParser()
        val events = parser.parse("event: delta\ndata: {\"type\":\"delta\",\"text\":\"See [p.3] and [p.12].\"}\n\n")
        assertEquals(events.single().pages, listOf(3, 12))
        assertEquals(events.single().text, "See [p.3] and [p.12].")
    }
}
