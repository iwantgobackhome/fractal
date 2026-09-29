package app.fractal.data

import org.testng.Assert.assertEquals
import org.testng.Assert.assertFalse
import org.testng.Assert.assertTrue
import org.testng.annotations.Test

class MergeRulesTest {
    private fun row(time: String, device: String, deleted: Boolean) = AnnotationEntity(
        id = "1", paperKey = "p", page = 1, kind = "highlight", updatedAt = time,
        deleted = deleted, rev = 0, deviceId = device, dirty = false, json = "{}",
    )

    @Test
    fun tombstoneAndDeviceTieBreak() {
        val live = row("2026-01-01T00:00:00Z", "a", false)
        assertTrue(MergeRules.remoteWins(live, row(live.updatedAt, "b", true)))
        assertFalse(MergeRules.remoteWins(row(live.updatedAt, "b", true), live))
        assertTrue(MergeRules.remoteWins(live, row("2026-01-02T00:00:00Z", "a", true)))
    }

    @Test
    fun cursorIsDecimalNotLexical() {
        assertEquals(MergeRules.newerCursor("9", "10"), "10")
        assertEquals(MergeRules.newerCursor("100", "99"), "100")
        assertEquals(MergeRules.newerCursor("0", "0"), "0")
    }
}
