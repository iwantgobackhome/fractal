package app.fractal.data

import kotlinx.serialization.json.*

data class TranslatedBlock(val blockId: String, val page: Int, val kind: String, val text: String)

/** pageOrdinal orders text within a page; it is never a physical paper page. */
fun translatedBlocks(snapshot: JsonObject): List<TranslatedBlock> {
    val translations = (snapshot["translations"] as? JsonArray).orEmpty().mapNotNull {
        val value = it.jsonObject
        val id = value.text("blockId") ?: return@mapNotNull null
        val text = value.text("text")
        if (value.text("status") == "completed" && !text.isNullOrBlank()) id to text else null
    }.toMap()
    if (translations.isEmpty()) return emptyList()
    return (snapshot["blocks"] as? JsonArray).orEmpty().sortedBy {
        it.jsonObject.text("order")?.toIntOrNull() ?: Int.MAX_VALUE
    }.mapNotNull {
        val block = it.jsonObject
        val id = block.text("blockId") ?: return@mapNotNull null
        val page = (block["regions"] as? JsonArray)?.firstNotNullOfOrNull { region ->
            region.jsonObject.text("page")?.toIntOrNull()?.takeIf { page -> page > 0 }
        } ?: return@mapNotNull null
        val text = translations[id] ?: block.text("sourceText")
        if (text.isNullOrBlank()) null else TranslatedBlock(id, page, block.text("kind").orEmpty(), text)
    }
}
