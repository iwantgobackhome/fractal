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
}
