package app.fractal.reader

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.ui.geometry.Offset
import android.view.*
import android.util.Log
import androidx.compose.runtime.*
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.design.*
import app.fractal.pdf.PdfPages
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.security.MessageDigest

/** Isolated published PDF fixtures; injected pointers establish software routing only. */
class ReaderStageTest {
    @get:Rule val compose = createAndroidComposeRule<ReaderFixtureActivity>()
    private val app get() = compose.activity.application as ReaderApplication
    private val key = "stage3-reader-fixture"
    private lateinit var row: LibraryEntity
    private lateinit var hash: String
    private var down = 0L
    @Before fun fixture() = runBlocking {
        assertNull("Use an unpaired disposable emulator", app.credentials.load())
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val bytes = assets.open("text-layout.pdf").use { it.readBytes() }
        hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        app.cache.file(hash).writeBytes(bytes)
        row = libraryEntity(buildJsonObject {
            put("id", key); put("paperKey", key); put("title", "Original text and translation: a reproducible research reading fixture")
            put("authors", JsonArray(emptyList())); put("year", 2026); put("venue", "Interaction QA")
            put("addedAt", "2026-10-01T00:00:00Z"); put("updatedAt", "2026-10-01T00:00:00Z"); put("bibtexKey", key)
            put("pdfSha256", hash); put("pageCount", 5); put("saved", true); put("rev", 1)
        }, null, false).copy(pdfSha256 = hash, pageCount = 5)
        app.database.library().upsert(row)
        app.database.reader().upsert(ReaderPositionEntity(key, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}"))
        val raw = assets.open("text-layout-pages.json").bufferedReader().use { it.readText() }
        val fixtures = WireJson.format.parseToJsonElement(raw).jsonArray
        for (fixture in fixtures) {
            val layout = JsonObject(fixture.jsonObject + buildJsonObject { put("status", "ready"); put("paperKey", key); put("pdfSha256", hash); put("extractionVersion", PDF_TEXT_LAYOUT_VERSION) })
            val page = fixture.jsonObject["page"]!!.jsonObject["page"]!!.jsonPrimitive.int
            app.database.reader().upsert(PdfTextEntity(hash, PDF_TEXT_LAYOUT_VERSION, page, layout.toString(), System.currentTimeMillis()))
        }
        app.database.metadata().upsert(SnapshotEntity(key, buildJsonObject {
            put("blocks", JsonArray(fixtures.flatMap { f ->
                val page = f.jsonObject["page"]!!.jsonObject["page"]!!.jsonPrimitive.int
                listOf(buildJsonObject { put("blockId", "source-page-$page"); put("order", page); put("kind", "paragraph"); put("pageOrdinal", 99)
                    put("sourceText", f.jsonObject["page"]!!.jsonObject["text"]!!.jsonPrimitive.content)
                    put("regions", JsonArray(listOf(buildJsonObject { put("page", page); put("x", .05); put("y", .05); put("width", .8); put("height", .8) }))) })
            }))
            put("translations", JsonArray((1..5).map { page -> buildJsonObject { put("blockId", "source-page-$page"); put("status", "completed")
                put("text", "번역된 연구 문단 $page. 원문과 번역문을 함께 읽으며 문맥을 유지합니다.\n\n이 문장은 실제 캐시에 저장된 번역 내용이며, 텍스트 선택과 복사 및 질문 인용을 확인합니다.\n\nTranslated research paragraph $page. Reading positions belong to physical pages and stable source block IDs. Selection in this translation never becomes an original text offset.") } }))
        }.toString(), "2026-10-01T00:00:00Z"))
        app.history.saveDraft(key, buildJsonObject { put("question", ""); put("context", JsonObject(emptyMap())); put("model", ""); put("language", "auto") })
        val memo = buildJsonObject { put("id", "00000000-0000-4000-8000-000000003003"); put("paperKey", key); put("page", 1); put("kind", "memo")
            put("updatedAt", "2026-10-01T00:00:00Z"); put("deleted", false); put("rev", 0); put("deviceId", "qa"); put("quote", "WWW iii wide thin")
            put("text", "Complete retained memo body. This remains independent of its quote, collapse state and position, including after offline edits and reopening.")
            put("color", "yellow"); put("collapsed", true); put("rect", buildJsonObject { put("x", .65); put("y", .35); put("width", .02); put("height", .02) }) }
        app.sync.saveLocal(memo)
    }
    private fun open() {
        val theme = InstrumentationRegistry.getArguments().getString("theme")?.let { PaperTheme.valueOf(it) } ?: PaperTheme.Light
        compose.setContent { FractalTheme(theme) { ReaderScreen(app, row, {}) } }
        compose.waitUntil(15_000) { surfaces().isNotEmpty() }
        compose.waitForIdle()
    }
    private fun surfaces(): List<View> {
        fun walk(v: View): List<View> = if (v.javaClass.simpleName == "InkSurface") listOf(v) else if (v is ViewGroup) (0 until v.childCount).flatMap { walk(v.getChildAt(it)) } else emptyList()
        var result = emptyList<View>(); compose.runOnUiThread { result = walk(compose.activity.window.decorView) }; return result
    }
    private fun event(action: Int, x: Float, y: Float, tool: Int = MotionEvent.TOOL_TYPE_STYLUS) {
        if (action == MotionEvent.ACTION_DOWN) down = SystemClock.uptimeMillis()
        val props = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = tool })
        val coords = arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = .7f })
        val e = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, 1, props, coords, 0, 0, 1f, 1f, 0, 0,
            if (tool == MotionEvent.TOOL_TYPE_FINGER) InputDevice.SOURCE_TOUCHSCREEN else InputDevice.SOURCE_STYLUS, 0)
        compose.runOnUiThread { compose.activity.dispatchTouchEvent(e) }; e.recycle(); compose.waitForIdle()
    }
    private fun capture(name: String) {
        compose.waitForIdle(); SystemClock.sleep(250)
        val screen = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val c = compose.activity.resources.configuration
        val profile = InstrumentationRegistry.getArguments().getString("captureProfile")?.takeIf { it.matches(Regex("[A-Za-z0-9_-]+")) } ?: "default"
        val dir = File(app.getExternalFilesDir(null), "stage3-qa/$profile").apply { mkdirs() }
        val file = File(dir, "$name-${c.screenWidthDp}x${c.screenHeightDp}-font${c.fontScale}.png")
        file.outputStream().use { screen.compress(Bitmap.CompressFormat.PNG, 100, it) }; screen.recycle()
        Log.i("ReaderStageQA", "capture=${file.name}")
    }
    private fun mode(label: String) {
        compose.onNodeWithContentDescription("Reading pane").performClick()
        compose.onAllNodesWithText(label).onLast().performClick()
    }
    @Test fun capturesActualHubDownloadedPaperAndRetainedHistoryOffline(): Unit = runBlocking {
        org.junit.Assume.assumeTrue("Requires previously downloaded actual D bridge fixture", app.database.library().get("D-reader-catalog") != null)
        val cached = app.database.library().get("D-reader-catalog")!!
        assertNull(app.credentials.load())
        assertTrue(translatedBlocks(WireJson.format.parseToJsonElement(app.database.metadata().snapshot(cached.paperKey)!!.json).jsonObject).any { it.translated })
        app.database.reader().upsert(ReaderPositionEntity(cached.paperKey, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}"))
        compose.setContent { FractalTheme { ReaderScreen(app, cached, {}) } }
        compose.waitUntil(15000) { surfaces().isNotEmpty() }; compose.waitForIdle()
        capture("reader-hub-cached-original")
        if (compose.activity.resources.configuration.screenWidthDp >= 840) { mode("Split"); capture("reader-hub-cached-split") }
        mode("Translation"); capture("reader-hub-cached-translation")
        mode("Original")
        compose.onNodeWithText("Ask", substring = false).performClick()
        compose.onNodeWithContentDescription("Reader panel").performClick(); compose.onAllNodesWithText("History").onLast().performClick()
        compose.onNodeWithContentDescription("Filter history").performClick(); compose.onAllNodesWithText("Explanations").onLast().performClick()
        assertTrue(app.database.metadata().observeHistory(cached.paperKey).first().any { it.status == "completed" }); capture("reader-hub-cached-history")
        compose.onNodeWithText("Close", substring = false).performClick()
    }
    @Test fun capturesSourceSplitAndCachedTranslation() {
        open(); capture("reader-original")
        compose.onNodeWithText(row.title!!, substring = false).performClick(); capture("reader-full-title")
        compose.onNodeWithText("Close", substring = false).performClick()
        if (compose.activity.resources.configuration.screenWidthDp >= 840) { mode("Split"); compose.onNodeWithText("Translated research paragraph 1.", substring = true).assertExists(); capture("reader-split") }
        mode("Translation")
        compose.onNodeWithText("Translated research paragraph 1.", substring = true).assertExists(); capture("reader-translation")
        compose.onAllNodesWithText("Quote this translated block")[0].performScrollTo().performClick()
        compose.onNodeWithText("Translated quote · page 1").assertExists(); capture("reader-quoted-translation")
        compose.onNodeWithText("Close", substring = false).performClick()
        mode("Original"); compose.onNodeWithContentDescription("Move source note").assertExists()
        compose.onNodeWithContentDescription("Move source note").performScrollTo().performClick()
        compose.onNodeWithText("Complete retained memo body.", substring = true).assertExists()
        capture("reader-note")
        compose.onNodeWithText("Edit", substring = false).performClick(); capture("reader-note-editor")
        compose.onNodeWithText("Cancel", substring = false).performClick()
    }
    @Test fun genuineCachedRangeCopyQuoteAndHandles() = runBlocking {
        open()
        compose.onNodeWithContentDescription("Select text", substring = false).performClick()
        val result = app.originalText.page(key, hash, 1, 5).page!!
        val geometry = OriginalTextGeometry(result)
        val range = geometry.range(4, 7)!!
        val quad = range.displayQuads.first()
        val startX = quad.map { it.x }.average(); val startY = quad.map { it.y }.average()
        val surface = surfaces().first(); val at = IntArray(2)
        compose.runOnUiThread { surface.getLocationOnScreen(at) }
        val x = at[0] + (startX * surface.width).toFloat(); val y = at[1] + (startY * surface.height).toFloat()
        val endQuad = range.displayQuads.last()
        val endX = at[0] + (endQuad.map { it.x }.average() * surface.width).toFloat()
        val endY = at[1] + (endQuad.map { it.y }.average() * surface.height).toFloat()
        event(MotionEvent.ACTION_DOWN, x, y); event(MotionEvent.ACTION_MOVE, endX, endY); event(MotionEvent.ACTION_UP, endX, endY)
        compose.onNodeWithContentDescription("Selection start handle").assertExists()
        compose.onNodeWithContentDescription("Selection end handle").assertExists()
        compose.onNodeWithText("Copy", substring = false).performClick()
        val clip = app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        assertEquals("iii", clip.primaryClip!!.getItemAt(0).text.toString())
        SystemClock.sleep(8000) // Let Android's system clipboard overlay dismiss before final product capture.
        capture("reader-cached-selection")
        compose.onNodeWithText("Quote / explain").performClick()
        compose.onNodeWithText("iii", substring = false).assertExists()
        compose.onNodeWithText("Close", substring = false).performClick()
        compose.onNodeWithText("Ask", substring = false).performClick()
        compose.onNodeWithText("iii", substring = false).assertExists()
        // Verify actual rendered crop/rotation frames independently from the selection UI.
        PdfPages(app.cache.file(hash)).use { pdf ->
            for (page in listOf(1, 2, 3)) {
                val layout = app.originalText.page(key, hash, page, 5).page!!
                val selection = OriginalTextGeometry(layout).wordAt(.2, .2)
                assertEquals(page, layout.page)
                val bitmap = pdf.bitmap(page - 1, 900)
                val run = layout.runs.first { it.quad != null }
                val points = run.quad!!.map { rotateTextPoint(TextPoint(it[0], it[1]), layout.rotation) }
                val left = (points.minOf { it.x }.coerceIn(0.0, 1.0) * bitmap.width).toInt(); val right = (points.maxOf { it.x }.coerceIn(0.0, 1.0) * bitmap.width).toInt()
                val top = (points.minOf { it.y }.coerceIn(0.0, 1.0) * bitmap.height).toInt(); val bottom = (points.maxOf { it.y }.coerceIn(0.0, 1.0) * bitmap.height).toInt()
                var dark = 0
                for (px in left until right) for (py in top until bottom) if (android.graphics.Color.red(bitmap.getPixel(px, py)) < 180) dark++
                Log.i("ReaderStageQA", "rendered physicalPage=$page rotation=${layout.rotation} crop=${layout.cropBox} selectionEnvelopeDarkPixels=$dark")
                assertTrue("Derived extraction envelope misses actual rendered text on page $page", dark > 5)
            }
        }
    }
    @Test fun fingerLongPressAndFingerPenHandlesChangeGenuineRange(): Unit = runBlocking {
        open()
        val layout = app.originalText.page(key, hash, 1, 5).page!!
        val geometry = OriginalTextGeometry(layout)
        val range = geometry.range(4, 7)!!
        val quad = range.displayQuads.first()
        val surface = surfaces().first(); val at = IntArray(2)
        compose.runOnUiThread { surface.getLocationInWindow(at) }
        val x = at[0] + (quad.map { it.x }.average() * surface.width).toFloat()
        val y = at[1] + (quad.map { it.y }.average() * surface.height).toFloat()
        val before = android.graphics.Rect(at[0], at[1], at[0] + surface.width, at[1] + surface.height)
        event(MotionEvent.ACTION_DOWN, x, y, MotionEvent.TOOL_TYPE_FINGER)
        SystemClock.sleep(android.view.ViewConfiguration.getLongPressTimeout().toLong() + 150)
        event(MotionEvent.ACTION_UP, x, y, MotionEvent.TOOL_TYPE_FINGER)
        compose.onNodeWithText("iii", substring = false).assertExists()
        fun drag(start: Int, end: Int, endHandle: Boolean, tool: Int) {
            val description = if (endHandle) "Selection end handle" else "Selection start handle"
            val handle = compose.onNodeWithContentDescription(description).fetchSemanticsNode().boundsInWindow
            val from = geometry.handlePoint(start, endHandle)!!
            val to = geometry.handlePoint(end, endHandle)!!
            val dx = ((to.x - from.x) * surface.width).toFloat()
            val dy = ((to.y - from.y) * surface.height).toFloat()
            val slop = android.view.ViewConfiguration.get(compose.activity).scaledTouchSlop.toFloat()
            val triggerSlop = slop + 2f
            event(MotionEvent.ACTION_DOWN, handle.center.x, handle.center.y, tool)
            // First cross touch slop; the following moves apply the requested canonical delta.
            event(MotionEvent.ACTION_MOVE, handle.center.x + if (dx < 0) -triggerSlop else triggerSlop, handle.center.y, tool)
            repeat(5) { n -> event(MotionEvent.ACTION_MOVE, handle.center.x + dx * (n + 1) / 5 + if (dx < 0) -slop else slop, handle.center.y + dy * (n + 1) / 5, tool) }
            event(MotionEvent.ACTION_UP, handle.center.x + dx + if (dx < 0) -slop else slop, handle.center.y + dy, tool)
        }
        drag(4, 0, false, MotionEvent.TOOL_TYPE_FINGER)
        compose.onNodeWithText("Copy", substring = false).performClick()
        val clip = app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        assertEquals("WWW iii", clip.primaryClip!!.getItemAt(0).text.toString())
        drag(7, 12, true, MotionEvent.TOOL_TYPE_STYLUS)
        compose.onNodeWithText("Copy", substring = false).performClick()
        assertEquals(layout.text.substring(0, 12), clip.primaryClip!!.getItemAt(0).text.toString())
        compose.runOnUiThread { surface.getLocationInWindow(at) }
        assertEquals(before, android.graphics.Rect(at[0], at[1], at[0] + surface.width, at[1] + surface.height))
        Log.i("ReaderStageQA", "finger long press + finger start/pen end handles retained canonical range [0,12) and paper=$before")
    }
    @Test fun actualTranslatedTextSelectionCopyAndQuote(): Unit = runBlocking {
        open(); mode("Translation")
        val clip = app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val text = translatedBlocks(WireJson.format.parseToJsonElement(app.database.metadata().snapshot(key)!!.json).jsonObject).first().text
        compose.onNodeWithText("Translated research paragraph 1.", substring = true).performTouchInput { longClick(Offset(30f, 20f)) }
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        capture("reader-translated-selection")
        // Native accessibility roots are null on this disposable5554 even for uiautomator.
        // Click the actual Android floating-toolbar item in its attached window, not a fake copy callback.
        var copied = false
        compose.runOnUiThread {
            val roots = android.view.inspector.WindowInspector.getGlobalWindowViews()
            fun click(v: View) {
                if (copied) return
                if (v is android.widget.TextView && v.text.toString() == "Copy") { var target = v as View
                    while (!target.isClickable && target.parent is View) target = target.parent as View
                    copied = target.performClick()
                } else if (v is ViewGroup) repeat(v.childCount) { click(v.getChildAt(it)) }
            }
            roots.forEach(::click)
        }
        assertTrue("Clicked actual Android Copy toolbar", copied)
        compose.waitForIdle()
        val selected = clip.primaryClip!!.getItemAt(0).text.toString()
        assertTrue("Native translated selection copied an actual proper substring", selected.isNotBlank() && selected.length < text.length && text.contains(selected))
        compose.onNodeWithText("Quote copied excerpt", substring = false).performScrollTo().performClick()
        compose.onNodeWithText("Translated quote · page 1").assertExists()
        compose.onNodeWithText("Close", substring = false).performClick()
        val draft = app.history.draft(key)["context"]!!.jsonObject
        assertEquals(selected, draft["text"]!!.jsonPrimitive.content)
        assertEquals("translated", draft["origin"]!!.jsonPrimitive.content)
        assertTrue(draft["rects"]!!.jsonArray.isEmpty())
        assertEquals(JsonNull, draft["start"])
        Log.i("ReaderStageQA", "actual native translated selection copied/quoted ${selected.length} UTF16 units without original range/position anchors")
    }
    @Test fun capturesKoreanCachedReaderLabels(): Unit = runBlocking {
        assertEquals("ko", compose.activity.resources.configuration.locales[0].language)
        val cached = app.database.library().get("D-reader-catalog")!!
        app.database.reader().upsert(ReaderPositionEntity(cached.paperKey, "{\"mode\":\"original\",\"page\":1,\"fraction\":0}"))
        compose.setContent { FractalTheme { ReaderScreen(app, cached, {}) } }
        compose.waitUntil(15000) { surfaces().isNotEmpty() }; compose.waitForIdle()
        capture("reader-ko-original")
        compose.onNodeWithContentDescription("읽기 화면").performClick(); compose.onAllNodesWithText("번역").onLast().performClick()
        compose.onAllNodesWithText("번역 블록 인용")[0].performScrollTo().performClick()
        compose.onNodeWithText("허브 기본값").assertExists(); compose.onNodeWithText("답변 언어").assertExists()
        capture("reader-ko-quote-selectors")
        compose.onNodeWithText("닫기", substring = false).performClick()
        compose.onNodeWithText("질문", substring = false).performClick()
        compose.onNodeWithContentDescription("읽기 패널").performClick(); compose.onAllNodesWithText("기록").onLast().performClick()
        compose.onNodeWithContentDescription("기록 필터").performClick(); compose.onAllNodesWithText("설명").onLast().performClick()
        capture("reader-ko-history")
        compose.onNodeWithText("닫기", substring = false).performClick()
    }
}
