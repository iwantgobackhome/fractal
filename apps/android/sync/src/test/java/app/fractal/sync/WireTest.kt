package app.fractal.sync

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
