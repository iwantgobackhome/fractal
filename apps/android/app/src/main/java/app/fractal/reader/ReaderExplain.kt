package app.fractal.reader

import android.graphics.Bitmap
import android.util.Base64
import app.fractal.pdf.*
import app.fractal.sync.StructureItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

internal fun structureSelection(item: StructureItem, hash: String) = item.page to PdfTextSelection(
    listOf(item.label, item.caption, item.latex.orEmpty()).filter { it.isNotBlank() }.joinToString("\n"),
    listOf(PdfRect(item.bbox.x.toFloat(), item.bbox.y.toFloat(), item.bbox.width.toFloat(), item.bbox.height.toFloat())),
    provenance = "detected-structure", pdfSha256 = hash)

internal fun readerExplainBody(language: String, model: Pair<String, String>?, selected: Pair<Int, PdfTextSelection>,
    item: StructureItem? = null, pageText: String = ""): JsonObject {
    require(selected.second.origin == "original") { "Explain uses original source context" }
    val base = readerQuestionBody("", language, model, selected)
    require(base["rect"] != null) { "Original region is unavailable" }
    val context = if (item == null) selected.second.text else
        listOf(item.label, item.caption, item.latex.orEmpty(), pageText).filter { it.isNotBlank() }.joinToString("\n")
    return buildJsonObject {
        base.filterKeys { it !in listOf("question", "selectedText", "rect") }.forEach { (k, v) -> put(k, v) }
        put("kind", item?.kind ?: if (selected.second.text.isBlank()) "figure" else "text")
        put("surroundingText", context.take(30000))
        base["rect"]?.let { put("bbox", it) }
    }
}

internal suspend fun withReaderCrop(body: JsonObject, pages: PdfPages?, selected: Pair<Int, PdfTextSelection>): JsonObject {
    val rect = body["bbox"] as? JsonObject ?: return body
    val source = pages ?: return body
    if (!source.identityUnchanged() || source.pdfSha256 != selected.second.pdfSha256) return body
    val encoded = withContext(Dispatchers.IO) {
        val bitmap = source.bitmap(selected.first - 1, 1000)
        fun n(key: String) = rect[key]?.jsonPrimitive?.floatOrNull ?: 0f
        val x = (n("x").coerceIn(0f, 1f) * bitmap.width).toInt().coerceAtMost(bitmap.width - 1)
        val y = (n("y").coerceIn(0f, 1f) * bitmap.height).toInt().coerceAtMost(bitmap.height - 1)
        val width = (n("width") * bitmap.width).toInt().coerceIn(1, bitmap.width - x)
        val height = (n("height") * bitmap.height).toInt().coerceIn(1, bitmap.height - y)
        val crop = Bitmap.createBitmap(bitmap, x, y, width, height)
        try {
            val bytes = java.io.ByteArrayOutputStream()
            crop.compress(Bitmap.CompressFormat.PNG, 100, bytes)
            Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP).takeIf { it.length <= 4_000_000 }
        } finally { if (crop !== bitmap) crop.recycle() }
    }
    return if (encoded == null) body else JsonObject(body + ("croppedPngBase64" to JsonPrimitive(encoded)))
}

internal fun structurePageContext(snapshot: JsonObject): Map<Int, String> {
    val pages = mutableMapOf<Int, MutableList<String>>()
    (snapshot["blocks"] as? JsonArray).orEmpty().sortedBy { (it as? JsonObject)?.get("order")?.jsonPrimitive?.intOrNull ?: Int.MAX_VALUE }.forEach { value ->
        val block = value as? JsonObject ?: return@forEach
        val text = block["sourceText"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@forEach
        (block["regions"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.get("page")?.jsonPrimitive?.intOrNull }
            .filter { it > 0 }.distinct().forEach { page -> pages.getOrPut(page) { mutableListOf() }.add(text) }
    }
    return pages.mapValues { it.value.joinToString("\n").take(6000) }
}
