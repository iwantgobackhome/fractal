package app.fractal.reader

import app.fractal.pdf.PdfTextSelection
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

internal data class ReaderNoteText(val quote: String, val body: String)

internal fun readerNoteText(kind: String, json: JsonObject?): ReaderNoteText {
    fun text(key: String) = json?.get(key)?.jsonPrimitive?.contentOrNull.orEmpty()
    return if (kind == "memo") ReaderNoteText(text("quote"), text("text"))
    else ReaderNoteText(text("text"), text("note"))
}

/** A request override never changes the Hub's global language preference. */
internal fun readerQuestionBody(
    question: String,
    language: String?,
    model: Pair<String, String>?,
    selected: Pair<Int, PdfTextSelection>?,
    threadId: String? = null,
): JsonObject = buildJsonObject {
    put("question", question)
    language?.let { put("answerLanguage", it) }
    threadId?.let { put("threadId", it) }
    selected?.let { (page, selection) ->
        put("page", page)
        put("provenance", selectionProvenance(page, selection))
        require(selection.text.length <= 20000) { "Select a shorter quote; the complete selection remains retained" }
        if (selection.text.isNotBlank()) put("selectedText", selection.text)
        selection.rects.takeIf { selection.origin == "original" && it.isNotEmpty() }?.let { rects ->
            val left = rects.minOf { it.x }; val top = rects.minOf { it.y }
            val rect = app.fractal.pdf.PdfRect(left, top, rects.maxOf { it.x + it.width } - left, rects.maxOf { it.y + it.height } - top)
            // Clamp in the serialized number domain; Float subtraction can serialize past 1.
            val x = rect.x.toDouble().coerceIn(0.0, 1.0)
            val y = rect.y.toDouble().coerceIn(0.0, 1.0)
            val width = rect.width.toDouble().coerceIn(0.0, 1.0 - x)
            val height = rect.height.toDouble().coerceIn(0.0, 1.0 - y)
            if (width > 0 && height > 0) put("rect", buildJsonObject {
                put("x", x); put("y", y); put("width", width); put("height", height)
            })
        }
    }
    model?.let { (provider, id) ->
        put("selection", buildJsonObject { put("provider", provider); put("model", id) })
    }
}
