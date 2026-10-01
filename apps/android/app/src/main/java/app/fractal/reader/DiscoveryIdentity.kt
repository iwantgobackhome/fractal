package app.fractal.reader

import java.net.URLDecoder

/** Matches the accepted bibliographic aliases; contradictory known identifiers always win. */
internal fun canonicalDoi(value: String?): String? {
    val trimmed = value?.trim()?.replace(Regex("^https?://(?:dx\\.)?doi\\.org/", RegexOption.IGNORE_CASE), "")
        ?.replace(Regex("^doi:\\s*", RegexOption.IGNORE_CASE), "") ?: return null
    val decoded = runCatching { URLDecoder.decode(trimmed.replace("+", "%2B"), "UTF-8") }.getOrNull() ?: return null
    return decoded.takeIf { it.matches(Regex("^10\\.\\d{4,9}/[^\\s?#]+$", RegexOption.IGNORE_CASE)) }?.lowercase()
}
internal fun canonicalArxiv(value: String?): String? = value?.trim()
    ?.replace(Regex("^https?://(?:www\\.)?arxiv\\.org/(?:abs|pdf)/", RegexOption.IGNORE_CASE), "")
    ?.replace(Regex("\\.pdf$", RegexOption.IGNORE_CASE), "")?.replace(Regex("v\\d+$"), "")?.lowercase()
    ?.takeIf { it.matches(Regex("^(?:\\d{4}\\.\\d{4,5}|[a-z.-]+/\\d{7})$")) }
