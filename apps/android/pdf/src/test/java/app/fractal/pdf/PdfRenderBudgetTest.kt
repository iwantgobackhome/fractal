package app.fractal.pdf

import org.testng.Assert.*
import org.testng.annotations.Test

class PdfRenderBudgetTest {
    @Test fun widthsShareBuckets() {
        assertEquals(PdfRenderBudget.width(513, .75f, 4_000_000), PdfRenderBudget.width(639, .75f, 4_000_000))
    }
    @Test fun tabletBaseKeepsFullViewportResolution() {
        for (heap in listOf(128, 256, 512)) {
            assertEquals(PdfRenderBudget.baseWidth(2560, .707f, heap), 2560)
            assertEquals(PdfRenderBudget.baseWidth(3840, .707f, heap), 3840)
            assertTrue(PdfRenderBudget.cacheBytes(heap) >= heap.toLong() * 1024 * 1024 / 3 - 1)
        }
    }
    @Test fun fourTimesZoomTileNeverExceedsViewport() {
        val tile = PdfRenderBudget.tile(2560 * 4, 3620 * 4, 3000, 8000, 2560, 1600)!!
        assertEquals(tile.width * tile.height, 2560 * 1600)
        assertEquals(tile.left, 3000); assertEquals(tile.top, 8000)
        val edge = PdfRenderBudget.tile(10240, 14480, 10000, 14000, 2560, 1600)!!
        assertEquals(edge.width, 240); assertEquals(edge.height, 480)
        assertNull(PdfRenderBudget.tile(10240, 14480, 10240, 0, 2560, 1600))
    }
}
