package app.fractal.reader

import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.SystemClock
import android.util.Log
import android.view.*
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsOwner
import app.fractal.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import java.security.MessageDigest

/** Real Android frames/accessibility/navigation: no Compose test clock, composition or View replacement. */
class ReaderLifecycleTest {
    private val app get() = ApplicationProvider.getApplicationContext<ReaderApplication>()
    private val instrument get() = InstrumentationRegistry.getInstrumentation()
    private lateinit var scenario: ActivityScenario<MainActivity>
    private fun waitUntil(predicate: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 15000
        while (!predicate()) { check(SystemClock.uptimeMillis() < end) { "Native product condition timed out" }; SystemClock.sleep(100) }
    }
    private var down = 0L
    private data class Contact(val id: Int, val x: Float, val y: Float, val tool: Int = MotionEvent.TOOL_TYPE_FINGER)
    private fun event(action: Int, vararg points: Contact) {
        if (action == MotionEvent.ACTION_DOWN) down = SystemClock.uptimeMillis()
        val props = points.map { MotionEvent.PointerProperties().apply { id = it.id; toolType = it.tool } }.toTypedArray()
        val coords = points.map { p -> MotionEvent.PointerCoords().apply { x = p.x; y = p.y; pressure = .7f } }.toTypedArray()
        val e = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, points.size, props, coords, 0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN or InputDevice.SOURCE_STYLUS, 0)
        scenario.onActivity { it.dispatchTouchEvent(e) }; e.recycle(); SystemClock.sleep(100)
    }
    private fun bounds(): android.graphics.Rect? {
        var result: android.graphics.Rect? = null
        scenario.onActivity { activity ->
            fun find(v: View) {
                if (result != null) return
                if (v.javaClass.simpleName == "InkSurface") {
                    val at = IntArray(2).also(v::getLocationInWindow)
                    if (v.width > 0) result = android.graphics.Rect(at[0], at[1], at[0] + v.width, at[1] + v.height)
                } else if (v is ViewGroup) repeat(v.childCount) { find(v.getChildAt(it)) }
            }
            find(activity.window.decorView)
        }
        return result
    }
    // Own5554's native accessibility service returns null roots even for shell uiautomator.
    // Read the actual live product semantics on main; never ask a Compose test owner to measure.
    private fun node(text: String): SemanticsNode? {
        var result: SemanticsNode? = null
        scenario.onActivity { activity ->
            fun search(n: SemanticsNode) {
                if (result != null) return
                if (n.config.contains(SemanticsProperties.Text) && n.config[SemanticsProperties.Text].any { it.text == text }) result = n
                else n.children.forEach(::search)
            }
            fun walk(v: View) {
                if (v.javaClass.simpleName == "AndroidComposeView") {
                    val owner = v.javaClass.getMethod("getSemanticsOwner").invoke(v) as SemanticsOwner
                    search(owner.rootSemanticsNode)
                } else if (v is ViewGroup) repeat(v.childCount) { walk(v.getChildAt(it)) }
            }
            walk(activity.window.decorView)
        }
        return result
    }
    private fun click(text: String) {
        waitUntil { node(text) != null }
        var target = node(text)!!
        while (!target.config.contains(SemanticsActions.OnClick) && target.parent != null) target = target.parent!!
        scenario.onActivity { assertTrue("Product action $text", target.config[SemanticsActions.OnClick].action!!.invoke()) }
        SystemClock.sleep(250)
    }
    private fun open() {
        waitUntil { node("Search titles, authors and tags") != null }
        var search = node("Search titles, authors and tags")!!
        while (!search.config.contains(SemanticsActions.SetText) && search.parent != null) search = search.parent!!
        scenario.onActivity { assertTrue(search.config[SemanticsActions.SetText].action!!.invoke(androidx.compose.ui.text.AnnotatedString("D continuous reader lifecycle"))) }
        SystemClock.sleep(300); click("Read")
        waitUntil { bounds() != null }; SystemClock.sleep(400)
    }
    @Test fun maximumZoomLeaveReopenRecreateAndFingerScroll() {
        assertNull("Disposable cached-library emulator only", app.credentials.load())
        val bytes = java.io.ByteArrayOutputStream().also { out ->
            val pdf = PdfDocument()
            try { repeat(4) { index ->
                val page = pdf.startPage(PdfDocument.PageInfo.Builder(600, 800, index + 1).create())
                page.canvas.drawText("D lifecycle page ${index + 1}", 40f, 120f, Paint().apply { textSize = 20f })
                pdf.finishPage(page)
            }; pdf.writeTo(out) } finally { pdf.close() }
        }.toByteArray()
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        app.cache.file(hash).writeBytes(bytes)
        val key = "D-lifecycle-fixture"
        runBlocking { app.database.library().upsert(libraryEntity(buildJsonObject {
            put("id", key); put("paperKey", key); put("bibtexKey", key); put("title", "D continuous reader lifecycle"); put("authors", JsonArray(emptyList()))
            put("addedAt", "2026-10-01T00:00:00Z"); put("updatedAt", "2026-10-01T00:00:00Z"); put("saved", true); put("rev", 1)
            put("pdfSha256", hash); put("pageCount", 4)
        }, null, false).copy(pdfSha256 = hash, pageCount = 4))
        app.database.reader().upsert(ReaderPositionEntity(key, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}")) }
        app.settings.edit().putBoolean("languageIntroDone", true).commit()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        try { open()
        val original = bounds()!!
        val focusX = original.centerX().toFloat(); val focusY = original.top + 500f
        val a = Contact(0, focusX - 50, focusY - 50); val b = Contact(1, focusX + 50, focusY + 50)
        event(MotionEvent.ACTION_DOWN, a); event(MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), a, b)
        val c = a.copy(x = focusX - 200, y = focusY - 200); val d = b.copy(x = focusX + 200, y = focusY + 200)
        event(MotionEvent.ACTION_MOVE, c, d); event(MotionEvent.ACTION_POINTER_UP or (1 shl 8), c, d); event(MotionEvent.ACTION_UP, c)
        assertEquals(original.width() * 4, bounds()!!.width())
        val zoomed = bounds()!!
        val pen = Contact(0, focusX, focusY, MotionEvent.TOOL_TYPE_STYLUS)
        event(MotionEvent.ACTION_DOWN, pen); event(MotionEvent.ACTION_MOVE, pen.copy(x = focusX + 30, y = focusY + 30)); event(MotionEvent.ACTION_UP, pen.copy(x = focusX + 40, y = focusY + 40))
        assertEquals(zoomed, bounds())
        click("Show reader controls"); click("‹")
        open()
        scenario.recreate()
        waitUntil { bounds() != null }; SystemClock.sleep(500)
        val before = bounds()!!
        val finger = Contact(0, before.centerX().toFloat(), before.top + 600f)
        event(MotionEvent.ACTION_DOWN, finger)
        repeat(8) { event(MotionEvent.ACTION_MOVE, finger.copy(y = finger.y - (it + 1) * 35)) }
        event(MotionEvent.ACTION_UP, finger.copy(y = finger.y - 280))
        val after = bounds()!!
        assertTrue("Production parent scrolling did not resume after max zoom/navigation/recreation", after.top < before.top - 50)
        Log.i("ReaderLifecycle", "production real-frame original=$original max=$zoomed recreated=$before finger=$after")
        } finally { scenario.close() }
    }
}
