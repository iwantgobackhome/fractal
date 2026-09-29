package app.fractal.sync

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class AiStreamEvent(
    val type: String,
    val text: String,
    val pages: List<Int>,
)

class SseParser {
    private var eventName = ""
    private val data = StringBuilder()
    private val citation = Regex("""\[p\.(\d+)]""")

    fun consume(line: String): AiStreamEvent? {
        if (line.isNotEmpty()) {
            when {
                line.startsWith("event:") -> eventName = line.substringAfter(':').trim()
                line.startsWith("data:") -> {
                    if (data.isNotEmpty()) data.append('\n')
                    data.append(line.substringAfter(':').trimStart())
                }
            }
            return null
        }
        if (data.isEmpty()) return null
        val objectValue = WireJsonAdapter.json.parseToJsonElement(data.toString()).jsonObject
        val type = objectValue["type"]?.jsonPrimitive?.content ?: eventName
        val text = when (type) {
            "delta" -> objectValue["text"]?.jsonPrimitive?.content ?: ""
            "done" -> objectValue["answer"]?.jsonObject?.get("text")?.jsonPrimitive?.content ?: ""
            else -> objectValue["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content ?: ""
        }
        val pages = citation.findAll(text).mapNotNull { it.groupValues[1].toIntOrNull() }.distinct().toList()
        data.clear()
        eventName = ""
        return AiStreamEvent(type, text, pages)
    }

    fun parse(raw: String): List<AiStreamEvent> {
        return buildList {
            for (line in raw.lines() + "") {
                consume(line)?.let(::add)
            }
        }
    }
}
