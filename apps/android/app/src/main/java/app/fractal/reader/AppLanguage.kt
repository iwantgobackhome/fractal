package app.fractal.reader

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal const val LANGUAGE_SYSTEM = "system"

/** An explicit choice on this device wins over a later hub preference. */
internal fun setAppLanguage(app: ReaderApplication, language: String, explicit: Boolean) {
    require(language == LANGUAGE_SYSTEM || language == "ko" || language == "en")
    app.settings.edit()
        .putString("appLanguage", language)
        .putBoolean("languageChosen", explicit)
        .apply()
    val locales = if (language == LANGUAGE_SYSTEM) LocaleListCompat.getEmptyLocaleList()
        else LocaleListCompat.forLanguageTags(language)
    AppCompatDelegate.setApplicationLocales(locales)
}

/** A missing or older hub has no preferences endpoint; keep the device setting in that case. */
internal suspend fun adoptHubLanguageIfUnset(app: ReaderApplication) {
    if (app.settings.getBoolean("languageChosen", false)) return
    val language = runCatching {
        app.client.data("/api/preferences").jsonObject["uiLanguage"]?.jsonPrimitive?.content
    }.getOrNull()
    if ((language == "ko" || language == "en") && !app.settings.getBoolean("languageChosen", false)) {
        setAppLanguage(app, language, explicit = false)
    }
}
