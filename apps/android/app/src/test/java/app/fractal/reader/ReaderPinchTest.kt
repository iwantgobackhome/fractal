package app.fractal.reader

import org.testng.Assert.*
import org.testng.annotations.Test

class ReaderPinchTest {
    @Test fun commitKeepsFocalPointAfterZoomAndPan() {
        for (scale in listOf(.5f, 1f, 1.5f, 4f)) {
            val offset = 120f
            val focus = 300f
            val pan = 45f
            val translation = focus * (1f - scale) + pan
            val committed = committedZoomOffset(offset, scale, translation)
            assertEquals((offset + focus) * scale - committed, focus + pan, .001f)
        }
    }
}
