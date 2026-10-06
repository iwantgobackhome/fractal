package app.fractal.data

import kotlinx.serialization.json.*

/** Ratios in the Hub's rendered page coordinate space, measured from the top left. */
data class TranslatedRegion(val page: Int, val x: Float, val y: Float, val width: Float, val height: Float)
data class TranslatedBlock(val blockId: String, val page: Int, val kind: String, val text: String,
    val translated: Boolean = true, val regions: List<TranslatedRegion> = emptyList()) {
    val isSourceCrop: Boolean get() = kind in setOf("figure", "table", "equation", "unsupported") && regions.isNotEmpty()
}

/** pageOrdinal orders text within a page; it is never a physical paper page. */
fun translatedBlocks(snapshot: JsonObject): List<TranslatedBlock> {
    val translations = (snapshot["translations"] as? JsonArray).orEmpty().mapNotNull {
        val value = it.jsonObject
        val id = value.text("blockId") ?: return@mapNotNull null
        val text = value.text("text")
        if (value.text("status") == "completed" && !text.isNullOrBlank()) id to text else null
    }.toMap()
    // Media crops accompany a translation; with nothing translated there is no translated view.
    if (translations.isEmpty()) return emptyList()
    return (snapshot["blocks"] as? JsonArray).orEmpty().sortedBy {
        it.jsonObject.text("order")?.toIntOrNull() ?: Int.MAX_VALUE
    }.mapNotNull {
        val block = it.jsonObject
        val id = block.text("blockId") ?: return@mapNotNull null
        val page = (block["regions"] as? JsonArray)?.firstNotNullOfOrNull { region ->
            region.jsonObject.text("page")?.toIntOrNull()?.takeIf { page -> page > 0 }
        } ?: return@mapNotNull null
        val kind = block.text("kind").orEmpty()
        if (kind in setOf("figure", "table", "equation", "unsupported")) {
            val regions = (block["regions"] as? JsonArray).orEmpty().mapNotNull { value ->
                val region = value as? JsonObject ?: return@mapNotNull null
                val physicalPage = region["page"]?.jsonPrimitive?.intOrNull?.takeIf { it > 0 } ?: return@mapNotNull null
                fun number(key: String) = region[key]?.jsonPrimitive?.floatOrNull?.takeIf { it.isFinite() }
                val x = number("x")?.coerceIn(0f, 1f) ?: return@mapNotNull null
                val y = number("y")?.coerceIn(0f, 1f) ?: return@mapNotNull null
                val width = number("width")?.coerceIn(0f, 1f - x) ?: return@mapNotNull null
                val height = number("height")?.coerceIn(0f, 1f - y) ?: return@mapNotNull null
                if (width <= 0f || height <= 0f) null else TranslatedRegion(physicalPage, x, y, width, height)
            }
            // The hub stores one region per extracted line; one crop per physical page reads as the figure.
            val crops = regions.groupBy { it.page }.map { (physicalPage, onPage) ->
                val left = onPage.minOf { it.x }; val top = onPage.minOf { it.y }
                TranslatedRegion(physicalPage, left, top, onPage.maxOf { it.x + it.width } - left, onPage.maxOf { it.y + it.height } - top)
            }
            return@mapNotNull crops.takeIf { it.isNotEmpty() }?.let { TranslatedBlock(id, it.first().page, kind, "", false, it) }
        }
        val text = translations[id] ?: block.text("sourceText")
        if (text.isNullOrBlank()) null else TranslatedBlock(id, page, block.text("kind").orEmpty(), text, translations[id] != null)
    }
}
