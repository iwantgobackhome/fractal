package app.fractal.reader

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import android.view.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

/** Observes the ordinary MainActivity tree on main. No Compose test owner/clock/replacement. */
internal class NativeDeskDriver(val scenario: ActivityScenario<MainActivity>) {
    // ActivityScenario.onActivity waits for Looper idleness; held scroll/input streams need
    // observation between frames. Use the ordinary main queue and actual resumed Activity.
    fun onMain(action: (MainActivity) -> Unit) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val activity = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).filterIsInstance<MainActivity>().single()
            action(activity)
        }
    }
    fun waitFor(label: String, predicate: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 25000
        while (!predicate()) { check(SystemClock.uptimeMillis() < end) { "Native condition timed out: $label" }; SystemClock.sleep(100) }
    }
    fun nodes(): List<SemanticsNode> {
        val result = mutableListOf<SemanticsNode>()
        onMain { activity ->
            fun search(n: SemanticsNode) { result += n; n.children.forEach(::search) }
            fun walk(v: View) {
                if (v.javaClass.simpleName == "AndroidComposeView") search((v.javaClass.getMethod("getSemanticsOwner").invoke(v) as SemanticsOwner).rootSemanticsNode)
                else if (v is ViewGroup) repeat(v.childCount) { walk(v.getChildAt(it)) }
            }; android.view.inspector.WindowInspector.getGlobalWindowViews().forEach(::walk)
        }; return result
    }
    fun node(text: String, contains: Boolean = false): SemanticsNode? = nodes().firstOrNull { n ->
        n.config.getOrNull(SemanticsProperties.Text)?.any { if (contains) it.text.contains(text) else it.text == text } == true ||
            n.config.getOrNull(SemanticsProperties.ContentDescription)?.any { if (contains) it.contains(text) else it == text } == true
    }
    fun click(text: String, contains: Boolean = false) {
        Log.i("DiscoveryNativeQA", "click=$text")
        waitFor(text) { node(text, contains) != null }
        fun actionable() = nodes().filter { n ->
            n.config.getOrNull(SemanticsProperties.Text)?.any { if (contains) it.text.contains(text) else it.text == text } == true ||
                n.config.getOrNull(SemanticsProperties.ContentDescription)?.any { if (contains) it.contains(text) else it == text } == true
        }.mapNotNull { match ->
            var ancestor = match
            while (!ancestor.config.contains(SemanticsActions.OnClick) && ancestor.parent != null) ancestor = ancestor.parent!!
            ancestor.takeIf { it.config.contains(SemanticsActions.OnClick) }
        }.firstOrNull { !it.config.contains(SemanticsProperties.Disabled) }
        waitFor("enabled $text") { actionable() != null }
        val target = actionable()!!
        onMain { check(target.config[SemanticsActions.OnClick].action!!.invoke()) { "Action rejected: $text" } }
        SystemClock.sleep(250)
    }
    fun type(label: String, text: String) {
        waitFor(label) { node(label) != null }; var target = node(label)!!
        while (!target.config.contains(SemanticsActions.SetText) && target.parent != null) target = target.parent!!
        onMain { check(target.config[SemanticsActions.SetText].action!!.invoke(AnnotatedString(text))) }
        SystemClock.sleep(250)
    }
    fun findSurface(): android.graphics.Rect? {
        var found: android.graphics.Rect? = null
        onMain { activity ->
            fun walk(v: View) {
                if (v.javaClass.simpleName == "InkSurface" && v.width > 0 && found == null) {
                    val xy = IntArray(2).also(v::getLocationInWindow)
                    found = android.graphics.Rect(xy[0], xy[1], xy[0] + v.width, xy[1] + v.height)
                } else if (v is ViewGroup) repeat(v.childCount) { walk(v.getChildAt(it)) }
            }; walk(activity.window.decorView)
        }; return found
    }
    private var down = 0L
    fun event(action: Int, x: Float, y: Float, tool: Int = MotionEvent.TOOL_TYPE_FINGER) {
        if (action == MotionEvent.ACTION_DOWN) down = SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, 1,
            arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = tool }),
            arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = .7f }),
            0, 0, 1f, 1f, 0, 0, if (tool == MotionEvent.TOOL_TYPE_STYLUS) InputDevice.SOURCE_STYLUS else InputDevice.SOURCE_TOUCHSCREEN, 0)
        onMain { it.dispatchTouchEvent(event) }; event.recycle(); SystemClock.sleep(100)
    }
    fun scrollTo(label: String, contains: Boolean = false, xFraction: Float = .5f) {
        repeat(16) {
            val n = node(label, contains)
            var height = 0; var width = 0
            onMain { height = it.window.decorView.height; width = it.window.decorView.width }
            // LazyColumn can realize the next item just below the visible viewport.
            // Show the actual target above the navigation/footer before recording evidence.
            if (n != null && n.boundsInWindow.height > 0 &&
                n.boundsInWindow.top < height * .65f && n.boundsInWindow.bottom > height * .15f) return
            val x = width * xFraction; val y = height * .75f
            event(MotionEvent.ACTION_DOWN, x, y)
            repeat(8) { step -> event(MotionEvent.ACTION_MOVE, x, y - (height * .43f) * (step + 1) / 8) }
            event(MotionEvent.ACTION_UP, x, height * .32f)
        }; error("Scroll target missing: $label")
    }
    fun scrollToTop(xFraction: Float = .8f) {
        repeat(5) {
            var height = 0; var width = 0
            onMain { height = it.window.decorView.height; width = it.window.decorView.width }
            val x = width * xFraction; val y = height * .3f
            event(MotionEvent.ACTION_DOWN, x, y)
            repeat(6) { step -> event(MotionEvent.ACTION_MOVE, x, y + height * .5f * (step + 1) / 6) }
            event(MotionEvent.ACTION_UP, x, height * .8f)
        }
    }
    fun capture(name: String) {
        SystemClock.sleep(600)
        val instrument = InstrumentationRegistry.getInstrumentation()
        val profile = InstrumentationRegistry.getArguments().getString("captureProfile") ?: "native"
        val screen = instrument.uiAutomation.takeScreenshot()
        val app = instrument.targetContext.applicationContext as ReaderApplication
        val config = app.resources.configuration
        val directory = File(app.getExternalFilesDir(null), "stage4-qa/$profile").apply { mkdirs() }
        val file = File(directory, "$name-${config.screenWidthDp}x${config.screenHeightDp}-font${config.fontScale}.png")
        file.outputStream().use { screen.compress(Bitmap.CompressFormat.PNG, 100, it) }; screen.recycle()
        Log.i("DiscoveryNativeQA", "capture=${file.name}")
    }
}
