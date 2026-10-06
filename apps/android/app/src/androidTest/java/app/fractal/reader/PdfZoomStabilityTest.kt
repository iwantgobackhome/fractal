package app.fractal.reader

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.design.FractalTheme
import app.fractal.ink.InkPageState
import app.fractal.ink.InkToolState
import app.fractal.ink.InkStroke
import app.fractal.ink.InkPoint
import app.fractal.pdf.PdfPages
import org.junit.*
import org.junit.Assert.*
import java.io.File
import android.view.View
import android.view.ViewGroup
import android.view.MotionEvent
import android.view.InputDevice

class PdfZoomStabilityTest {
    @get:Rule val compose = createAndroidComposeRule<ReaderFixtureActivity>()
    @Test fun thirtyZoomChangesRetainRenderedPage() {
        val app = compose.activity.application as ReaderApplication
        val file = File(app.cacheDir, "zoom-stress.pdf")
        InstrumentationRegistry.getInstrumentation().context.assets.open("text-layout.pdf").use { input -> file.outputStream().use { input.copyTo(it) } }
        val pages = PdfPages(file, 128)
        var zoom by mutableStateOf(1f)
        var showing by mutableStateOf(true)
        compose.setContent {
            FractalTheme {
                if (showing) Column {
                    repeat(3) { index ->
                        PdfPage(app, pages, "zoom-stress", index, zoom, remember { InkPageState().apply {
                            load(listOf("pen", "highlighter").map { brush -> InkStroke(
                                paperKey = "zoom-stress", updatedAt = "2026-10-07T00:00:00Z", deviceId = "test", page = index + 1,
                                color = "#222222", width = .002f, brush = brush,
                                points = listOf(InkPoint(.1f, .1f, 1f, 0), InkPoint(.8f, .8f, 1f, 10))) })
                        } }, remember { InkToolState() }, emptyList(),
                            { _, _, _ -> }, {}, {}, {}, { _, _ -> })
                    }
                }
            }
        }
        compose.waitUntil(15000) { (1..3).all { compose.onAllNodesWithTag("pdf-page-$it-bitmap").fetchSemanticsNodes().isNotEmpty() } }
        val fittedWidth = compose.onNodeWithTag("pdf-page-1-bitmap").fetchSemanticsNode().boundsInRoot.width.toInt()
        fun pss(): Int = android.os.Debug.MemoryInfo().also { android.os.Debug.getMemoryInfo(it) }.totalPss
        fun assertViewportInk() {
            val density = compose.activity.resources.displayMetrics.density
            val viewportWidth = compose.activity.window.decorView.width / density
            val viewportHeight = compose.activity.window.decorView.height / density
            compose.onNodeWithTag("pdf-page-1-ink").assertExists()
            (1..3).forEach { page ->
                val pdf = compose.onNodeWithTag("pdf-page-$page-bitmap").fetchSemanticsNode()
                if (pdf.positionInWindow.y >= compose.activity.window.decorView.height ||
                    pdf.positionInWindow.y + pdf.size.height <= 0) {
                    compose.onNodeWithTag("pdf-page-$page-ink").assertDoesNotExist()
                }
                compose.onAllNodesWithTag("pdf-page-$page-ink").fetchSemanticsNodes().forEach {
                    val bounds = compose.onNodeWithTag("pdf-page-$page-ink").getUnclippedBoundsInRoot()
                    assertTrue("Ink surface exceeds viewport width: $bounds", (bounds.right - bounds.left).value <= viewportWidth + 1)
                    assertTrue("Ink surface exceeds viewport height: $bounds", (bounds.bottom - bounds.top).value <= viewportHeight + 1)
                }
            }
        }
        assertViewportInk()
        // A layout change during pen-down must preserve the wet surface and coordinate frame.
        fun inkSurface(view: View): View? = if (view.javaClass.simpleName == "InkSurface") view
            else if (view is ViewGroup) (0 until view.childCount).firstNotNullOfOrNull { inkSurface(view.getChildAt(it)) } else null
        val surface = inkSurface(compose.activity.window.decorView)!!
        val originalWidth = surface.width
        val originalHeight = surface.height
        val started = android.os.SystemClock.uptimeMillis()
        fun pen(action: Int, x: Float, y: Float) {
            val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_STYLUS }
            val coords = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = .7f }
            val event = MotionEvent.obtain(started, android.os.SystemClock.uptimeMillis(), action, 1,
                arrayOf(properties), arrayOf(coords), 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_STYLUS, 0)
            try { compose.runOnUiThread { surface.dispatchTouchEvent(event) } } finally { event.recycle() }
            compose.waitForIdle()
        }
        pen(MotionEvent.ACTION_DOWN, originalWidth * .2f, originalHeight * .2f)
        compose.runOnIdle { zoom = .5f }
        compose.waitForIdle()
        compose.runOnIdle {
            assertSame(surface, inkSurface(compose.activity.window.decorView))
            assertEquals(originalWidth, surface.width)
            assertEquals(originalHeight, surface.height)
        }
        pen(MotionEvent.ACTION_UP, originalWidth * .3f, originalHeight * .3f)
        compose.runOnIdle {
            val stateField = surface.javaClass.getDeclaredField("state").apply { isAccessible = true }
            val point = (stateField.get(surface) as InkPageState).strokes.last().points.last()
            assertEquals(.3f, point.x, .001f)
            assertTrue("surface resize was not applied after pen-up", surface.width < originalWidth)
            zoom = 1f
        }
        compose.waitForIdle()
        val before = pss()
        var peak = before
        fun dump(label: String) {
            val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("dumpsys meminfo app.newspapers.reader")
            val output = android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
            android.util.Log.i("PdfZoomStability", label + " " + output.lineSequence().filter { it.contains("TOTAL") || it.contains("Native Heap") || it.contains("Dalvik Heap") || it.contains("Graphics") }.joinToString("; "))
        }
        dump("before")
        compose.runOnIdle { zoom = 4f }
        compose.waitForIdle()
        assertViewportInk()
        dump("firstZoom4")
        compose.runOnIdle { zoom = 1f }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        repeat(30) { step ->
            compose.runOnUiThread { zoom = if (step % 2 == 0) 4f else .5f }
            compose.mainClock.advanceTimeByFrame()
            (1..3).forEach { compose.onNodeWithTag("pdf-page-$it-bitmap").assertExists() }
            assertFalse(pages.bitmap(step % 3, 800).isRecycled)
            peak = maxOf(peak, pss())
        }
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        compose.runOnIdle { zoom = 3f }
        compose.waitUntil(15000) { compose.onAllNodesWithTag("pdf-page-1-tile").fetchSemanticsNodes().any { it.config[PdfTilePageWidth] == fittedWidth * 3 } }
        compose.onNodeWithTag("pdf-page-1-tile").assertExists()
        compose.runOnIdle { zoom = 4f }
        compose.mainClock.advanceTimeBy(300)
        compose.waitForIdle()
        compose.waitUntil(15000) { compose.onAllNodesWithTag("pdf-page-1-tile").fetchSemanticsNodes().any { it.config[PdfTilePageWidth] == fittedWidth * 4 } }
        assertViewportInk()
        val pixels = compose.onNodeWithTag("pdf-page-1-tile").fetchSemanticsNode().config[PdfTilePixels]
        assertTrue(pixels <= compose.activity.window.decorView.width * compose.activity.window.decorView.height)
        peak = maxOf(peak, pss())
        dump("zoom4")
        android.util.Log.i("PdfZoomStability", "zoom1PssKb=$before zoom4PssKb=${pss()}")
        dump("after")
        android.util.Log.i("PdfZoomStability", "30 zoom changes completed; beforePssKb=$before peakPssKb=$peak afterPssKb=${pss()}")
        // Dispose consumers before closing the renderer.
        compose.runOnIdle { showing = false }
        compose.waitForIdle()
        pages.close()
        file.delete()
    }
}
