package app.fractal.reader

import app.fractal.data.WireJson
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class ReaderModelTest {
    private fun provider(installed: Boolean = true, loggedIn: Boolean = true, models: String = """[{"id":"same-name","label":"Full very long model name"}]""") = WireJson.format.parseToJsonElement("""{"providers":[{"status":{"id":"codex","installed":$installed,"loggedIn":$loggedIn},"models":$models}]}""").jsonObject
    @Test fun changingProviderAndModelOptionsNeverReplaceAnExplicitChoiceWithDefault() {
        val choice = "codex/same-name"
        assertEquals("codex" to "same-name", resolveReaderModel(choice, readerModels(provider())))
        for (changed in listOf(provider(models = "[]"), provider(loggedIn = false), provider(installed = false))) {
            try { resolveReaderModel(choice, readerModels(changed)); fail("Unavailable explicit model silently became default") } catch (_: IllegalArgumentException) { }
            assertNull(resolveReaderModel("", readerModels(changed)))
        }
        assertEquals("codex · Full very long model name", readerModels(provider()).single().label)
    }
}
