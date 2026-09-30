package app.fractal.reader

import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.design.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class LibraryUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val app get() = compose.activity.application as ReaderApplication
    private fun fixture(key: String = "stage2-fixture-0", title: String = "How reading environments influence the interpretation of scientific evidence") = buildJsonObject {
        put("id", key); put("paperKey", key); put("title", title)
        put("authors", JsonArray(listOf(buildJsonObject { put("given", "Alexandra"); put("family", "Montgomery-Williams") }, buildJsonObject { put("given", "Minji"); put("family", "Kim") })))
        put("venue", "Journal of Research Methods"); put("year", 2025)
        put("abstract", "This isolated QA paper exercises full bibliographic names, readable summaries, explicit saving and actual read history across phone and tablet layouts.")
        put("addedAt", "2026-01-01T00:00:00Z"); put("updatedAt", "2026-01-01T00:00:00Z"); put("bibtexKey", key)
        put("saved", true); put("savedAt", "2026-01-01T00:00:00Z"); put("rev", 1)
        put("tags", JsonArray(listOf(JsonPrimitive("reading"), JsonPrimitive("methods"))))
        put("collections", JsonArray(listOf(JsonPrimitive("stage2-folder"))))
    }
    private fun seed() = runBlocking {
        assertNull("UI tests require an unpaired disposable emulator", app.credentials.load())
        repeat(4) { index ->
            app.database.metadata().deletePaperMutations("stage2-fixture-$index")
            val title = when (index) {
                1 -> "A reproducible framework for comparing long scholarly publication titles and complete author names"
                2 -> "Offline research notebooks: preserving context through intermittent network connectivity"
                3 -> "The relationship between saved publications and the history of actual reading"
                else -> "How reading environments influence the interpretation of scientific evidence"
            }
            app.database.library().upsert(libraryEntity(fixture("stage2-fixture-$index", title), null, false))
        }
        app.database.metadata().upsert(folderEntity(buildJsonObject {
            put("id", "stage2-folder"); put("name", "Research methods and evidence"); put("parentId", JsonNull)
            put("deleted", false); put("rev", 1); put("updatedAt", "2026-01-01")
        }))
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        android.os.SystemClock.sleep(400) // Let the native click ripple finish before a review capture.
        val instrument = InstrumentationRegistry.getInstrumentation()
        val screen = instrument.uiAutomation.takeScreenshot()
        val dir = File(app.getExternalFilesDir(null), "stage2-qa").apply { mkdirs() }
        val scale = compose.activity.resources.configuration.fontScale
        val fileName = if (scale > 1.01f) "$name-font-$scale" else name
        File(dir, "$fileName.png").outputStream().use { screen.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        Log.i("FractalLibraryQA", "capture=$fileName pixels=${screen.width}x${screen.height} dp=${compose.activity.resources.configuration.screenWidthDp}x${compose.activity.resources.configuration.screenHeightDp} fontScale=$scale")
        screen.recycle()
    }

    @Test fun captureActualScholarlyLibrary() {
        seed()
        val theme = InstrumentationRegistry.getArguments().getString("theme")?.let { PaperTheme.valueOf(it) } ?: PaperTheme.Light
        compose.setContent { FractalTheme(theme) { ScholarlyLibraryScreen(app, {}, {}) } }
        compose.onAllNodesWithText("Saved", useUnmergedTree = true).assertCountEquals(2)
        compose.onNodeWithText("How reading environments influence the interpretation of scientific evidence").assertExists()
        val titleBounds = compose.onNodeWithText("Research library").fetchSemanticsNode().boundsInRoot
        val settingsBounds = compose.onNodeWithText("Settings").fetchSemanticsNode().boundsInRoot
        assertFalse("Header title overlaps Settings: $titleBounds / $settingsBounds", titleBounds.overlaps(settingsBounds))
        Log.i("FractalLibraryQA", "headerTitle=$titleBounds settingsLabel=$settingsBounds")
        val size = compose.activity.resources.configuration
        val suffix = if (theme == PaperTheme.Light) "" else "-${theme.name.lowercase()}"
        capture("library-${size.screenWidthDp}x${size.screenHeightDp}$suffix")
        if (size.screenWidthDp >= 840) {
            compose.onNodeWithText("How reading environments influence the interpretation of scientific evidence").performClick()
            capture("library-details-${size.screenWidthDp}x${size.screenHeightDp}$suffix")
        }
    }

    @Test fun cachedReaderOpensWithHubUnavailableAndCreatesActualRead() = runBlocking {
        seed()
        val pdf = PdfDocument()
        repeat(3) { index ->
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(600, 800, index + 1).create())
            page.canvas.drawText("Offline cached research fixture - page ${index + 1}", 40f, 100f, Paint().apply { textSize = 20f })
            pdf.finishPage(page)
        }
        val output = java.io.ByteArrayOutputStream(); pdf.writeTo(output); pdf.close()
        val bytes = output.toByteArray()
        val sha = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        app.cache.file(sha).writeBytes(bytes)
        val row = app.database.library().get("stage2-fixture-0")!!.copy(pdfSha256 = sha, pageCount = 3)
        app.database.library().upsert(row)
        val snapshot = buildJsonObject {
            put("blocks", JsonArray(listOf(buildJsonObject { put("blockId", "stable-block"); put("order", 1); put("pageOrdinal", 9)
                put("regions", JsonArray(listOf(buildJsonObject { put("page", 2) }))); put("kind", "paragraph"); put("sourceText", "Original context") })))
            put("translations", JsonArray(listOf(buildJsonObject { put("blockId", "stable-block"); put("status", "completed"); put("text", "Offline translation with stable context") })))
        }
        app.database.metadata().upsert(SnapshotEntity(row.paperKey, snapshot.toString(), "2026-01-01"))
        compose.setContent { FractalTheme { ReaderScreen(app, row, {}) } }
        compose.waitUntil(15_000) { runBlocking { app.database.library().get(row.paperKey)?.lastReadAt != null } }
        assertTrue(app.database.library().get(row.paperKey)!!.saved)
        assertTrue(app.database.metadata().pending("paper", row.paperKey).isNotEmpty())
        assertEquals(2, translatedBlocks(WireJson.format.parseToJsonElement(app.database.metadata().snapshot(row.paperKey)!!.json).jsonObject).single().page)
        capture("offline-reader")
    }

    @Test fun captureDarkSettingsAndSelectorDialog() {
        seed()
        app.settings.edit().putBoolean("languageIntroDone", true).commit()
        compose.setContent { FractalTheme(PaperTheme.Dark) { ReaderApp(app, false, {}, "Dark", {}) } }
        compose.onNodeWithText("Settings").performClick(); compose.waitForIdle()
        capture("settings-dark")
        compose.onNodeWithText("2 GB").performScrollTo().performClick(); compose.waitForIdle()
        compose.onNodeWithText("Close").assertIsDisplayed()
        capture("settings-selector-dark")
    }

    @Test fun customSelectorKeepsLongSelectedLabelsAndSupportsKeyboard() {
        val first = "Provider / Long scholarly analysis model with extended context window"
        val second = "한국어 / Korean — complete language label"
        var selected by mutableStateOf("first")
        compose.setContent { FractalTheme { ResearchSelector("Model or language", selected,
            listOf("first" to first, "second" to second), { selected = it }) } }
        compose.onNodeWithText(first).performClick()
        compose.onAllNodesWithText(first, substring = false).assertCountEquals(2)
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_DOWN)
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ENTER)
        compose.waitForIdle()
        assertEquals("second", selected)
        compose.onNodeWithText(second).assertExists()
        compose.onNodeWithText(second).performClick()
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ESCAPE)
        compose.waitForIdle()
        compose.onNodeWithText(second).assertExists()
    }

    @Test fun actualLibrarySaveAndTagMembershipEditing() {
        seed()
        compose.setContent { FractalTheme { ScholarlyLibraryScreen(app, {}, {}) } }
        compose.onAllNodesWithText("Saved ✓").onFirst().performClick()
        compose.waitUntil(5_000) { runBlocking { app.database.library().get("stage2-fixture-0")?.saved == false } }
        // The Room write precedes its Flow projection; wait for the Saved list to remove this row.
        compose.waitUntil(5_000) { compose.onAllNodesWithText("How reading environments influence the interpretation of scientific evidence").fetchSemanticsNodes().isEmpty() }
        compose.onAllNodesWithText("Organize").onFirst().performClick()
        compose.onNodeWithText("Tags, separated by commas").performTextClearance()
        compose.onNodeWithText("Tags, separated by commas").performTextInput("edited, multiple tags")
        compose.onNodeWithText("Research methods and evidence").performClick()
        compose.onNodeWithText("Save changes").performClick()
        compose.waitUntil(5_000) {
            runBlocking {
                val row = app.database.library().get("stage2-fixture-1") ?: return@runBlocking false
                val record = WireJson.format.decodeFromString<LibraryRecord>(row.json)
                record.tags == listOf("edited", "multiple tags") && record.collections.isEmpty()
            }
        }
    }

    @Test fun captureKoreanLongTitle() = runBlocking {
        seed()
        val title = "과학적 근거의 해석에 독서 환경이 미치는 영향과 오프라인 연구 기록의 지속 가능성"
        val row = app.database.library().get("stage2-fixture-0")!!
        val value = WireJson.format.parseToJsonElement(row.json).jsonObject
        app.database.library().upsert(libraryEntity(JsonObject(value + ("title" to JsonPrimitive(title)) + ("savedAt" to JsonPrimitive("2026-09-30T00:00:00Z"))), row, false))
        compose.setContent { FractalTheme { ScholarlyLibraryScreen(app, {}, {}) } }
        compose.onNodeWithText(title).assertExists()
        capture("library-korean-title")
    }

    @Test fun selectorTabToCloseEnterRestoresTriggerWithoutChoosing() {
        var chosen by mutableStateOf("first")
        var callbacks = 0
        compose.setContent { FractalTheme { ResearchSelector("Choice", chosen,
            listOf("first" to "First choice", "second" to "Second choice"), { chosen = it; callbacks++ }) } }
        compose.onNodeWithText("First choice").performClick(); compose.waitForIdle()
        val instrument = InstrumentationRegistry.getInstrumentation()
        repeat(3) { instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_TAB); compose.waitForIdle() }
        compose.onNodeWithText("Close").assertIsFocused()
        capture("selector-close-keyboard-focus")
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ENTER); compose.waitForIdle()
        assertEquals("first", chosen); assertEquals(0, callbacks)
        compose.onNodeWithText("First choice").assertIsFocused()
    }

    @Test fun selectorHandlesDynamicRemovedEmptyLoadingAndLongKeyboardList() {
        var choices by mutableStateOf((0 until 60).map { "id-$it" to "Long complete model choice number $it" })
        var chosen by mutableStateOf("id-20")
        var loading by mutableStateOf(false)
        var callbacks = 0
        compose.setContent { FractalTheme { ResearchSelector("Model", chosen, choices, { chosen = it; callbacks++ }, loading = loading) } }
        val instrument = InstrumentationRegistry.getInstrumentation()
        compose.onNodeWithText("Long complete model choice number 20").performClick(); compose.waitForIdle()
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MOVE_END); compose.waitForIdle()
        compose.onNodeWithText("Long complete model choice number 59").assertIsDisplayed()
        capture("selector-long-list-end-focus")
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MOVE_HOME); compose.waitForIdle()
        compose.onNodeWithText("Long complete model choice number 0").assertIsDisplayed()
        compose.runOnIdle { choices = listOf("replacement" to "Replacement with a full label") }
        compose.waitForIdle()
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ENTER); compose.waitForIdle()
        assertEquals("replacement", chosen)
        compose.onNodeWithText("Replacement with a full label").performClick(); compose.waitForIdle()
        compose.runOnIdle { choices = emptyList() }
        compose.waitForIdle()
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MOVE_END)
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ENTER); compose.waitForIdle()
        assertEquals(1, callbacks)
        instrument.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_ESCAPE); compose.waitForIdle()
        compose.onNodeWithText("Unavailable").assertExists()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.DropdownList)).assertIsNotEnabled()
        compose.runOnIdle { choices = listOf("replacement" to "Replacement with a full label"); loading = true }
        compose.onNodeWithText("Loading choices…").assertExists()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.DropdownList)).assertIsNotEnabled()
    }

    @Test fun selectorKoreanEmptyLoadingAndCloseAreLocalized() {
        val config = android.content.res.Configuration(compose.activity.resources.configuration).apply { setLocale(java.util.Locale.KOREAN) }
        val korean = compose.activity.createConfigurationContext(config)
        var choices by mutableStateOf(listOf("first" to "긴 모델 이름과 선택된 항목 표시"))
        var loading by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalContext provides korean, LocalConfiguration provides config) {
            FractalTheme { ResearchSelector("모델", "first", choices, {}, loading = loading) }
        } }
        compose.onNodeWithText("긴 모델 이름과 선택된 항목 표시").performClick(); compose.waitForIdle()
        compose.onNodeWithText("닫기").assertExists()
        compose.runOnIdle { choices = emptyList() }; compose.waitForIdle()
        compose.onAllNodesWithText("사용 가능한 항목 없음").assertCountEquals(2)
        compose.onNodeWithText("닫기").performClick(); compose.waitForIdle()
        compose.onNodeWithText("사용 가능한 항목 없음").assertExists()
        compose.runOnIdle { loading = true }; compose.waitForIdle()
        compose.onNodeWithText("항목 불러오는 중…").assertExists()
        capture("selector-korean-loading")
    }
}
