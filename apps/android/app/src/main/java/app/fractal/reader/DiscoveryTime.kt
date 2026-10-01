package app.fractal.reader

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal fun readableDiscoveryTime(value: String?): String = value?.let {
    runCatching { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.getDefault()).withZone(ZoneId.systemDefault()).format(Instant.parse(it)) }.getOrElse { _ -> it }
}.orEmpty()
