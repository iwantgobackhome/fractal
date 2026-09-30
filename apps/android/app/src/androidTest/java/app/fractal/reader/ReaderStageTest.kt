package app.fractal.reader

import android.graphics.Bitmap
import android.os.SystemClock
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
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.security.MessageDigest

/** Isolated published PDF fixtures; injected pointers establish software routing only. */
class ReaderStageTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = compose.activity.application as ReaderApplication
    private val key = "stage3-reader-fixture"
    private lateinit var row: LibraryEntity
    private lateinit var hash: String
    private var down = 0L
    @Before fun fixture() = runBlocking {
        assertNull("Use an unpaired disposable emulator", app.credentials.load())
        compose.runOnUiThread {
            val content = compose.activity.findViewById<ViewGroup>(android.R.id.content)
            fun dispose(v: View) { if (v is ComposeView) v.disposeComposition() else if (v is ViewGroup) repeat(v.childCount) { dispose(v.getChildAt(it)) } }
            repeat(content.childCount) { dispose(content.getChildAt(it)) }; content.removeAllViews()
        }
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
        val dir = File(app.getExternalFilesDir(null), "stage3-qa").apply { mkdirs() }
        val file = File(dir, "$name-${c.screenWidthDp}x${c.screenHeightDp}-font${c.fontScale}.png")
        file.outputStream().use { screen.compress(Bitmap.CompressFormat.PNG, 100, it) }; screen.recycle()
        Log.i("ReaderStageQA", "capture=${file.name}")
    }
    @Test fun capturesSourceSplitAndCachedTranslation() {
        open(); capture("reader-original")
        if (compose.activity.resources.configuration.screenWidthDp >= 840) { compose.onNodeWithText("Split").performClick(); compose.onNodeWithText("Translated research paragraph 1.", substring = true).assertExists(); capture("reader-split") }
        compose.onNodeWithText("Translation", substring = false).performClick()
        compose.onNodeWithText("Translated research paragraph 1.", substring = true).assertExists(); capture("reader-translation")
        compose.onAllNodesWithText("Quote this translated block")[0].performClick()
        compose.onNodeWithText("translated · page 1").assertExists(); capture("reader-quoted-translation")
        compose.onNodeWithText("Close", substring = false).performClick()
        compose.onNodeWithText("Original", substring = false).performClick(); compose.onNodeWithContentDescription("Move source note").assertExists()
        capture("reader-note")
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
}
