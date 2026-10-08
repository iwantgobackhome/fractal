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
    @Test fun downPanCanCommitToANegativeOffset() {
        val offset = committedZoomOffset(20f, 1.5f, 100f)
        assertEquals(offset, -70f)
        assertEquals((20f + 200f) * 1.5f - offset, 400f)
    }

    @Test fun zoomOutClearsPanBelowFitWidth() {
        assertEquals(boundedReaderPan(-800f, 1000f, .5f), 0f)
        assertEquals(boundedReaderPan(-800f, 1000f, 1f), 0f)
        assertEquals(boundedReaderPan(-800f, 1000f, 1.5f), -500f)
        assertEquals(boundedReaderPan(100f, 1000f, 4f), 0f)
        val pinch = ReaderPinch().apply { scale = .5f; x = 200f; y = 400f; committing = true }
        pinch.reset()
        assertEquals(pinch.scale, 1f); assertEquals(pinch.x, 0f); assertEquals(pinch.y, 0f)
        assertFalse(pinch.committing)
    }

    @Test fun doubleTapTogglesFromFitAndReturnsFromAnyZoom() {
        assertEquals(doubleTapReaderZoom(1f), 1.5f)
        for (zoom in listOf(.5f, 1.5f, 4f)) assertEquals(doubleTapReaderZoom(zoom), 1f)
    }
}
