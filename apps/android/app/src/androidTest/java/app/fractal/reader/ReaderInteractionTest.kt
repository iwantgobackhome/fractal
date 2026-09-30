package app.fractal.reader

import android.graphics.Paint
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.pdf.PdfDocument
import android.os.SystemClock
import android.util.Log
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import app.fractal.ink.InkCanvas
import app.fractal.ink.InkPageState
import app.fractal.ink.InkTool
import app.fractal.ink.InkToolState
import org.junit.Assert.assertFalse
import app.fractal.data.LibraryEntity
import app.fractal.design.FractalTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import androidx.compose.ui.platform.ComposeView
import kotlin.math.abs

/** Software routing tests; injected tool types are not evidence of physical palm rejection. */
class ReaderInteractionTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private var downTime = 0L

    @Before fun replaceInitialContentWithControlledReaderFixture() {
        compose.runOnUiThread {
            val content = compose.activity.findViewById<ViewGroup>(android.R.id.content)
            fun dispose(view: View) {
                if (view is ComposeView) view.disposeComposition()
                else if (view is ViewGroup) repeat(view.childCount) { dispose(view.getChildAt(it)) }
            }
            repeat(content.childCount) { dispose(content.getChildAt(it)) }
            content.removeAllViews()
        }
    }

    private fun reader() {
        val app = compose.activity.application as ReaderApplication
        val sha = "a".repeat(64)
        val pdf = PdfDocument()
        try {
            repeat(4) { index ->
                val page = pdf.startPage(PdfDocument.PageInfo.Builder(600, 800, index + 1).create())
                page.canvas.drawText("Reader gesture fixture page ${index + 1}", 40f, 120f, Paint().apply { textSize = 20f })
                page.canvas.drawRect(280f, 340f, 292f, 348f, Paint().apply { color = Color.RED })
                pdf.finishPage(page)
            }
            app.cache.file(sha).outputStream().use(pdf::writeTo)
        } finally { pdf.close() }
        compose.setContent {
            FractalTheme {
                ReaderScreen(app, LibraryEntity(
                    paperKey = "gesture-fixture", title = "Fixture", authors = "[]", year = null, venue = null,
                    addedAt = "2026-10-01T00:00:00Z", updatedAt = "2026-10-01T00:00:00Z",
                    status = "ready", pdfSha256 = sha, pageCount = 4, dirty = false, json = "{}",
                ), {})
            }
        }
        compose.waitUntil(15_000) { surfaces().any { it.width > 0 } }
        compose.waitForIdle()
    }

    private fun surfaces(): List<View> {
        fun walk(view: View): List<View> = when {
            view.javaClass.simpleName == "InkSurface" -> listOf(view)
            view is ViewGroup -> (0 until view.childCount).flatMap { walk(view.getChildAt(it)) }
            else -> emptyList()
        }
        var result = emptyList<View>()
        compose.runOnUiThread { result = walk(compose.activity.window.decorView) }
        return result
    }

    private fun top(): Int {
        var y = 0
        compose.runOnIdle { y = IntArray(2).also { surfaces().first().getLocationInWindow(it) }[1] }
        return y
    }

    private fun event(action: Int, x: Float, y: Float, type: Int = MotionEvent.TOOL_TYPE_STYLUS) {
        pointers(action, listOf(Contact(0, type, x, y)), source =
            if (type == MotionEvent.TOOL_TYPE_FINGER) InputDevice.SOURCE_TOUCHSCREEN else InputDevice.SOURCE_STYLUS)
    }

    private data class Contact(val id: Int, val type: Int, val x: Float, val y: Float, val tilt: Float = .2f)
    private fun pointers(action: Int, contacts: List<Contact>, buttons: Int = 0, flags: Int = 0,
        source: Int = InputDevice.SOURCE_TOUCHSCREEN or InputDevice.SOURCE_STYLUS) {
        if (action == MotionEvent.ACTION_DOWN) downTime = SystemClock.uptimeMillis()
        // A mixed stream belongs to one touchscreen/stylus device; keep its source stable.
        val properties = contacts.map { contact -> MotionEvent.PointerProperties().apply { id = contact.id; toolType = contact.type } }.toTypedArray()
        val coords = contacts.map { contact -> MotionEvent.PointerCoords().apply {
            x = contact.x; y = contact.y; pressure = .7f; size = .1f
            setAxisValue(MotionEvent.AXIS_TILT, contact.tilt)
        } }.toTypedArray()
        val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, contacts.size, properties, coords, 0, buttons, 1f, 1f, 0, 0, source, flags)
        compose.runOnUiThread { compose.activity.dispatchTouchEvent(event) }
        event.recycle()
        compose.waitForIdle()
    }

    @Test fun penDownAndUpKeepPaperCoordinates() {
        reader()
        val before = top()
        event(MotionEvent.ACTION_DOWN, 200f, before + 300f)
        val during = top()
        event(MotionEvent.ACTION_MOVE, 260f, before + 340f)
        event(MotionEvent.ACTION_UP, 280f, before + 350f)
        val after = top()
        Log.i("ReaderInteraction", "pen viewport before=$before down=$during up=$after")
        assertEquals("pen down shifted paper", before, during)
        assertEquals("pen up shifted paper", before, after)
        compose.onNodeWithText(compose.activity.getString(R.string.show_reader_controls)).performClick()
        assertEquals("showing the reader controls shifted paper", before, top())
    }

    @Test fun fingerScrollsTheParentList() {
        reader()
        val before = top()
        event(MotionEvent.ACTION_DOWN, 200f, before + 600f, MotionEvent.TOOL_TYPE_FINGER)
        repeat(8) { index ->
            event(MotionEvent.ACTION_MOVE, 200f, before + 600f - (index + 1) * 35f, MotionEvent.TOOL_TYPE_FINGER)
        }
        event(MotionEvent.ACTION_UP, 200f, before + 320f, MotionEvent.TOOL_TYPE_FINGER)
        val after = top()
        Log.i("ReaderInteraction", "finger viewport before=$before after=$after")
        assertTrue("finger navigation did not scroll the paper", after < before - 50)
    }

    private data class PaperBounds(val x: Int, val y: Int, val width: Int, val height: Int)
    private fun bounds(): PaperBounds {
        var result = PaperBounds(0, 0, 0, 0)
        compose.runOnIdle {
            val page = surfaces().first()
            val location = IntArray(2).also(page::getLocationInWindow)
            result = PaperBounds(location[0], location[1], page.width, page.height)
        }
        return result
    }

    /** Measure actual PDF pixels, not only the ink View's layout bounds. */
    private fun printedMarker(): Pair<Float, Float>? {
        val capture = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return null
        val image = if (capture.config == Bitmap.Config.HARDWARE) capture.copy(Bitmap.Config.ARGB_8888, false) else capture
        try {
            val pixels = IntArray(image.width * image.height)
            image.getPixels(pixels, 0, image.width, 0, 0, image.width, image.height)
            var count = 0; var x = 0L; var y = 0L
            pixels.forEachIndexed { index, color ->
                if (Color.red(color) > 240 && Color.green(color) < 30 && Color.blue(color) < 30) {
                    count++; x += index % image.width; y += index / image.width
                }
            }
            if (count == 0) return null
            val decorLocation = IntArray(2)
            compose.runOnUiThread { compose.activity.window.decorView.getLocationOnScreen(decorLocation) }
            return x.toFloat() / count - decorLocation[0] to y.toFloat() / count - decorLocation[1]
        } finally { image.recycle(); if (image !== capture) capture.recycle() }
    }

    @Test fun readerPinchKeepsTheContentUnderItsFocusAndPenCoordinatesStableAfterZoom() {
        reader()
        val before = bounds()
        var originalMarker: Pair<Float, Float>? = null
        compose.waitUntil(15_000) { originalMarker = printedMarker(); originalMarker != null }
        val first = Contact(0, MotionEvent.TOOL_TYPE_FINGER, 300f, before.y + 400f)
        val second = Contact(1, MotionEvent.TOOL_TYPE_FINGER, 700f, before.y + 800f)
        val focusX = 500f
        val focusY = before.y + 600f
        val normalizedX = (focusX - before.x) / before.width
        val normalizedY = (focusY - before.y) / before.height
        pointers(MotionEvent.ACTION_DOWN, listOf(first))
        pointers(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), listOf(first, second))
        val spreadFirst = first.copy(x = 200f, y = before.y + 300f)
        val spreadSecond = second.copy(x = 800f, y = before.y + 900f)
        pointers(MotionEvent.ACTION_MOVE, listOf(spreadFirst, spreadSecond))
        val zoomed = bounds()
        Log.i("ReaderInteraction", "pinch before=$before after=$zoomed focus=($focusX,$focusY)")
        assertTrue("pinch did not enlarge actual ink/PDF width", zoomed.width > before.width * 1.4f)
        assertTrue("pinch x focus drift", abs(zoomed.x + zoomed.width * normalizedX - focusX) <= 3f)
        assertTrue("pinch y focus drift", abs(zoomed.y + zoomed.height * normalizedY - focusY) <= 3f)
        var zoomedMarker: Pair<Float, Float>? = null
        val markerX = (originalMarker!!.first - before.x) / before.width
        val markerY = (originalMarker!!.second - before.y) / before.height
        compose.waitUntil(15_000) {
            zoomedMarker = printedMarker()
            zoomedMarker?.let { marker ->
                abs(marker.first - (zoomed.x + zoomed.width * markerX)) <= 3f &&
                    abs(marker.second - (zoomed.y + zoomed.height * markerY)) <= 3f
            } == true
        }
        Log.i("ReaderInteraction", "PDF marker before=$originalMarker zoomed=$zoomedMarker matches ink bounds")
        pointers(MotionEvent.ACTION_MOVE, listOf(spreadFirst, spreadSecond))
        assertEquals("stationary pinch fed page motion back into pan", zoomed, bounds())
        val pannedFirst = spreadFirst.copy(x = spreadFirst.x + 80f, y = spreadFirst.y + 30f)
        val pannedSecond = spreadSecond.copy(x = spreadSecond.x + 80f, y = spreadSecond.y + 30f)
        pointers(MotionEvent.ACTION_MOVE, listOf(pannedFirst, pannedSecond))
        val panned = bounds()
        assertEquals("two-finger pan moved outside its expected bounds", zoomed.copy(x = zoomed.x + 80, y = zoomed.y + 30), panned)
        pointers(MotionEvent.ACTION_POINTER_UP or (1 shl 8), listOf(pannedFirst, pannedSecond))
        pointers(MotionEvent.ACTION_MOVE, listOf(pannedFirst))
        assertEquals("pointer removal jumped the page", panned, bounds())
        pointers(MotionEvent.ACTION_UP, listOf(pannedFirst))
        event(MotionEvent.ACTION_DOWN, 400f, 1100f, MotionEvent.TOOL_TYPE_FINGER)
        repeat(6) { event(MotionEvent.ACTION_MOVE, 400f, 1100f - (it + 1) * 40f, MotionEvent.TOOL_TYPE_FINGER) }
        event(MotionEvent.ACTION_UP, 400f, 860f, MotionEvent.TOOL_TYPE_FINGER)
        assertTrue("normal parent scrolling did not resume after pinch", bounds().y < panned.y - 50)
        val settled = bounds()
        event(MotionEvent.ACTION_DOWN, 400f, 800f)
        event(MotionEvent.ACTION_MOVE, 450f, 850f)
        event(MotionEvent.ACTION_UP, 470f, 860f)
        assertEquals("pen changed zoomed geometry", settled, bounds())
    }

    private fun canvas(
        state: InkPageState,
        tool: InkToolState = InkToolState(),
        writing: (Boolean) -> Unit = {},
        transform: (Float, Float, Float) -> Unit = { _, _, _ -> },
        selected: () -> Unit = {},
    ) {
        compose.setContent {
            FractalTheme {
                Box(Modifier.fillMaxSize()) {
                    InkCanvas(state, tool, Modifier.fillMaxSize(), Size.Zero, nativeInkRouting = true,
                        onWritingStateChanged = writing, onFingerGesture = transform,
                        onTextSelection = { _, _ -> selected() })
                }
            }
        }
        compose.waitForIdle()
    }

    @Test fun canceledInkDoesNotCommitOrAddAnUndoEntry() {
        val state = InkPageState()
        val writing = mutableListOf<Boolean>()
        canvas(state, writing = { writing += it })
        event(MotionEvent.ACTION_DOWN, 200f, 400f)
        event(MotionEvent.ACTION_MOVE, 250f, 450f)
        event(MotionEvent.ACTION_CANCEL, 250f, 450f)
        compose.runOnIdle {
            assertTrue(state.strokes.isEmpty())
            assertFalse(state.undo())
            assertEquals(listOf(true, false), writing)
        }
        event(MotionEvent.ACTION_DOWN, 200f, 400f)
        event(MotionEvent.ACTION_UP, 250f, 450f)
        compose.runOnIdle { assertEquals(1, state.strokes.size); assertTrue(state.undo()); assertTrue(state.redo()) }
    }

    @Test fun toolChangesApplyToTheNextStrokeAndTextSelectionDoesNotInk() {
        val state = InkPageState()
        val tool = InkToolState()
        var selections = 0
        canvas(state, tool, selected = { selections++ })
        event(MotionEvent.ACTION_DOWN, 200f, 400f)
        compose.runOnIdle { tool.active = InkTool.Highlighter; tool.color = "#A9D9A0"; tool.width = .02f }
        event(MotionEvent.ACTION_UP, 260f, 450f)
        compose.runOnIdle {
            assertEquals("ballpoint", state.strokes.single().brush)
            assertEquals("#1C1B19", state.strokes.single().color)
            assertEquals(.003f, state.strokes.single().width, 0f)
        }
        event(MotionEvent.ACTION_DOWN, 200f, 500f)
        event(MotionEvent.ACTION_UP, 260f, 500f)
        compose.runOnIdle { assertEquals("highlighter", state.strokes.last().brush); tool.active = InkTool.TextSelection }
        event(MotionEvent.ACTION_DOWN, 200f, 600f)
        event(MotionEvent.ACTION_MOVE, 280f, 620f)
        event(MotionEvent.ACTION_UP, 300f, 620f)
        compose.runOnIdle { assertEquals(2, state.strokes.size); assertEquals(1, selections) }
    }

    @Test fun sideButtonTemporarilyErasesAndReturnsToTheChosenPen() {
        val state = InkPageState()
        val tool = InkToolState()
        canvas(state, tool)
        event(MotionEvent.ACTION_DOWN, 200f, 400f)
        event(MotionEvent.ACTION_MOVE, 250f, 400f)
        event(MotionEvent.ACTION_UP, 300f, 400f)
        val pen = Contact(0, MotionEvent.TOOL_TYPE_STYLUS, 250f, 350f)
        pointers(MotionEvent.ACTION_DOWN, listOf(pen), MotionEvent.BUTTON_STYLUS_PRIMARY)
        pointers(MotionEvent.ACTION_UP, listOf(pen.copy(y = 450f)), MotionEvent.BUTTON_STYLUS_PRIMARY)
        compose.runOnIdle {
            assertTrue(state.strokes.first().deleted)
            assertEquals(InkTool.Ballpoint, tool.active)
            assertTrue(state.undo()); assertFalse(state.strokes.first().deleted)
        }
        pointers(MotionEvent.ACTION_DOWN, listOf(pen.copy(x = 200f, y = 500f, tilt = .6f)))
        pointers(MotionEvent.ACTION_UP, listOf(pen.copy(x = 300f, y = 500f, tilt = .7f)))
        compose.runOnIdle {
            assertEquals("ballpoint", state.strokes.last().brush)
            assertEquals(state.strokes.first().points.size, state.strokes.first().tilt?.size)
            assertEquals(.2f, state.strokes.first().tilt!!.first(), 0f)
            assertEquals(.6f, state.strokes.last().tilt!!.first(), 0f)
        }
    }

    @Test fun penOwnsTheStreamUntilTheRemainingPalmLifts() {
        reader()
        val before = top()
        val pen = Contact(0, MotionEvent.TOOL_TYPE_STYLUS, 200f, before + 300f)
        val palm = Contact(1, MotionEvent.TOOL_TYPE_FINGER, 500f, before + 400f)
        pointers(MotionEvent.ACTION_DOWN, listOf(pen))
        pointers(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), listOf(pen, palm))
        pointers(MotionEvent.ACTION_MOVE, listOf(pen.copy(x = 240f), palm.copy(y = palm.y - 150)))
        pointers(MotionEvent.ACTION_POINTER_UP, listOf(pen, palm))
        pointers(MotionEvent.ACTION_MOVE, listOf(palm.copy(y = palm.y - 250)))
        assertEquals("remaining palm moved the paper", before, top())
        pointers(MotionEvent.ACTION_UP, listOf(palm))
        val afterPen = top()
        event(MotionEvent.ACTION_DOWN, 200f, before + 600f, MotionEvent.TOOL_TYPE_FINGER)
        repeat(6) { event(MotionEvent.ACTION_MOVE, 200f, before + 600f - (it + 1) * 40f, MotionEvent.TOOL_TYPE_FINGER) }
        event(MotionEvent.ACTION_UP, 200f, before + 360f, MotionEvent.TOOL_TYPE_FINGER)
        Log.i("ReaderInteraction", "mixed pen/palm viewport before=$before afterPen=$afterPen freshFinger=${top()}")
        assertTrue("ownership was not released for a new finger stream", top() < before - 50)
    }

    @Test fun canceledPalmDoesNotCancelAPenFirstStroke() {
        val state = InkPageState()
        val transforms = mutableListOf<Float>()
        canvas(state, transform = { _, dy, _ -> transforms += dy })
        val finger = Contact(0, MotionEvent.TOOL_TYPE_FINGER, 500f, 500f)
        val pen = Contact(1, MotionEvent.TOOL_TYPE_STYLUS, 200f, 400f)
        pointers(MotionEvent.ACTION_DOWN, listOf(pen))
        pointers(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), listOf(pen, finger))
        pointers(MotionEvent.ACTION_POINTER_UP or (1 shl 8), listOf(pen, finger), flags = MotionEvent.FLAG_CANCELED)
        pointers(MotionEvent.ACTION_MOVE, listOf(pen.copy(x = 250f)))
        pointers(MotionEvent.ACTION_UP, listOf(pen.copy(x = 300f)))
        compose.runOnIdle { assertTrue(transforms.isEmpty()); assertEquals(1, state.strokes.size) }
    }

    @Test fun penTakesOverAnUnmovedFingerWhileBothPointersRemain() {
        val state = InkPageState()
        canvas(state)
        val finger = Contact(0, MotionEvent.TOOL_TYPE_FINGER, 500f, 500f)
        val pen = Contact(1, MotionEvent.TOOL_TYPE_STYLUS, 200f, 400f)
        pointers(MotionEvent.ACTION_DOWN, listOf(finger))
        pointers(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), listOf(finger, pen))
        pointers(MotionEvent.ACTION_MOVE, listOf(finger.copy(y = 300f), pen.copy(x = 250f)))
        pointers(MotionEvent.ACTION_POINTER_UP or (1 shl 8), listOf(finger, pen))
        pointers(MotionEvent.ACTION_UP, listOf(finger))
        compose.runOnIdle { assertEquals(1, state.strokes.size) }
    }

    @Test fun fingerFirstSoleStylusCommitsOneContinuousStrokeAndRecovers() {
        // The scoped native host owns this pen stream before Compose's tool conversion.
        // Genuine cancellation is still covered independently by canceledInkDoesNotCommit.
        val state = InkPageState()
        val writing = mutableListOf<Boolean>()
        canvas(state, writing = { writing += it })
        val finger = Contact(0, MotionEvent.TOOL_TYPE_FINGER, 500f, 500f)
        val pen = Contact(1, MotionEvent.TOOL_TYPE_STYLUS, 200f, 400f)
        pointers(MotionEvent.ACTION_DOWN, listOf(finger))
        pointers(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), listOf(finger, pen))
        pointers(MotionEvent.ACTION_MOVE, listOf(finger, pen.copy(x = 250f)))
        pointers(MotionEvent.ACTION_POINTER_UP, listOf(finger, pen))
        pointers(MotionEvent.ACTION_MOVE, listOf(pen.copy(x = 280f)))
        pointers(MotionEvent.ACTION_UP, listOf(pen.copy(x = 300f)))
        compose.runOnIdle { assertEquals(1, state.strokes.size); assertEquals(listOf(true, false), writing) }
        event(MotionEvent.ACTION_DOWN, 200f, 600f)
        event(MotionEvent.ACTION_UP, 300f, 600f)
        compose.runOnIdle { assertEquals(2, state.strokes.size) }
    }

    @Test fun pinchPointerRemovalDoesNotPanByTheOldCentroid() {
        val state = InkPageState()
        val transforms = mutableListOf<Triple<Float, Float, Float>>()
        canvas(state, transform = { dx, dy, factor -> transforms += Triple(dx, dy, factor) })
        val first = Contact(0, MotionEvent.TOOL_TYPE_FINGER, 200f, 400f)
        val second = Contact(1, MotionEvent.TOOL_TYPE_FINGER, 400f, 600f)
        pointers(MotionEvent.ACTION_DOWN, listOf(first))
        pointers(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), listOf(first, second))
        pointers(MotionEvent.ACTION_MOVE, listOf(first, second.copy(x = 500f, y = 700f)))
        pointers(MotionEvent.ACTION_POINTER_UP or (1 shl 8), listOf(first, second))
        pointers(MotionEvent.ACTION_MOVE, listOf(first))
        pointers(MotionEvent.ACTION_UP, listOf(first))
        compose.runOnIdle {
            assertTrue(transforms.first().third > 1f)
            assertEquals(0f, transforms.last().first, 0f)
            assertEquals(0f, transforms.last().second, 0f)
            assertEquals(1f, transforms.last().third, 0f)
            assertTrue(state.strokes.isEmpty())
        }
    }
}
