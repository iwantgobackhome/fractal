package app.fractal.pdf

import org.testng.Assert.*
import org.testng.annotations.Test

class PdfPageSizesTest {
    @Test fun lookupsNeverReopenPages() {
        var opens = 0
        val sizes = PdfPageSizes(3) { opens++; (it + 1) * 100 to 200 }
        assertEquals(opens, 3)
        repeat(100) { assertEquals(sizes.width(1), 200); assertEquals(sizes.aspectRatio(0), .5f) }
        assertEquals(opens, 3)
    }
    @Test fun cropOnlyBookLoadsJustTheRequestedPage() {
        var opens = 0
        val sizes = PdfPageSizes(1200, precompute = false) { opens++; 600 to 800 }
        assertEquals(opens, 0)
        repeat(100) { assertEquals(sizes.width(1199), 600); assertEquals(sizes.aspectRatio(1199), .75f) }
        assertEquals(opens, 1)
    }

    @Test fun readerBookWarmsEveryPageBeforeLookups() {
        var opens = 0
        val sizes = PdfPageSizes(1200) { opens++; 600 to 800 }
        assertEquals(opens, 1200)
        repeat(1200) { assertEquals(sizes.aspectRatio(it), .75f) }
        assertEquals(opens, 1200)
    }
}
