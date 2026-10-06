package app.fractal.pdf

import org.testng.Assert.*
import org.testng.annotations.Test

class PdfRenderBudgetTest {
    @Test fun widthsShareBuckets() {
        assertEquals(PdfRenderBudget.width(513, .75f, 4_000_000), PdfRenderBudget.width(639, .75f, 4_000_000))
    }
    @Test fun sixRastersFitMemoryBudget() {
        for (heap in listOf(64, 128, 256, 512)) {
            val pixels = PdfRenderBudget.pagePixels(heap)
            for (aspect in listOf(.5f, .75f, 1.5f)) {
                val width = PdfRenderBudget.width(10000, aspect, pixels)
                assertTrue(width.toLong() * (width / aspect).toInt() * 4 * 6 <= PdfRenderBudget.cacheBytes(heap))
            }
            assertTrue(PdfRenderBudget.cacheBytes(heap) <= heap.toLong() * 1024 * 1024 / 8)
        }
    }
}
