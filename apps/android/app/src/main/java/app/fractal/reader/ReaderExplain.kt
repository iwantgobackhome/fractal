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

internal fun readerExplainBody(language: String?, model: Pair<String, String>?, selected: Pair<Int, PdfTextSelection>,
    item: StructureItem? = null, pageText: String = "", threadId: String? = null): JsonObject {
    require(selected.second.origin == "original") { "Explain uses original source context" }
    val base = readerQuestionBody("", language, model, selected, threadId)
    require(base["rect"] != null) { "Original region is unavailable" }
    val context = if (item == null) selected.second.text else
        listOf(item.label, item.caption, item.latex.orEmpty(), pageText.take(1500)).filter { it.isNotBlank() }.joinToString("\n")
    return buildJsonObject {
        base.filterKeys { it !in listOf("question", "selectedText", "rect") }.forEach { (k, v) -> put(k, v) }
        put("kind", item?.kind ?: if (selected.second.text.isBlank()) "figure" else "text")
        put("surroundingText", context.take(2500))
        base["rect"]?.let { rect ->
            put("bbox", rect)
            if (item != null || selected.second.isImageSelection()) put("attachment", readerImageDescriptor(selected.first, rect.jsonObject, item?.kind ?: "region", item?.label ?: "Selected region"))
        }
        put("question", "${item?.label ?: if (selected.second.isImageSelection()) "Selected region" else "Selection"} 설명")
    }
}

internal suspend fun withReaderCrop(body: JsonObject, pages: PdfPages?, selected: Pair<Int, PdfTextSelection>): JsonObject {
    if (body["attachment"] == null) return body
    val rect = (body["bbox"] ?: body["rect"]) as? JsonObject ?: return body
    val source = pages ?: return body
    if (!source.identityUnchanged() || source.pdfSha256 != selected.second.pdfSha256) return body
    val encoded = withContext(Dispatchers.IO) {
        fun n(key: String) = rect[key]?.jsonPrimitive?.floatOrNull ?: 0f
        val crop = source.cropBitmap(selected.first - 1, PdfRect(n("x"), n("y"), n("width"), n("height")), 1400)
        var scale = minOf(1f, 1600f / maxOf(crop.width, crop.height))
        var result: String? = null
        for (attempt in 0 until 8) {
            val reduced = if (scale < 1f) Bitmap.createScaledBitmap(crop, maxOf(1, (crop.width * scale).toInt()), maxOf(1, (crop.height * scale).toInt()), true) else crop
            try {
                val bytes = java.io.ByteArrayOutputStream()
                reduced.compress(Bitmap.CompressFormat.PNG, 100, bytes)
                if (bytes.size() > 1_500_000) {
                    for (quality in listOf(85, 65, 45)) {
                        bytes.reset()
                        reduced.compress(Bitmap.CompressFormat.JPEG, quality, bytes)
                        if (bytes.size() <= 1_500_000) break
                    }
                }
                if (bytes.size() <= 1_500_000) result = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
            } finally { if (reduced !== crop) reduced.recycle() }
            if (result != null) break
            scale *= 0.7f
        }
        result
    }
    return if (encoded == null) body else readerBodyWithImage(body, encoded)
}

internal fun structurePageContext(snapshot: JsonObject): Map<Int, String> {
    val pages = mutableMapOf<Int, MutableList<String>>()
    (snapshot["blocks"] as? JsonArray).orEmpty().sortedBy { (it as? JsonObject)?.get("order")?.jsonPrimitive?.intOrNull ?: Int.MAX_VALUE }.forEach { value ->
        val block = value as? JsonObject ?: return@forEach
        val text = block["sourceText"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@forEach
        (block["regions"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.get("page")?.jsonPrimitive?.intOrNull }
            .filter { it > 0 }.distinct().forEach { page -> pages.getOrPut(page) { mutableListOf() }.add(text) }
    }
    return pages.mapValues { it.value.joinToString("\n").take(1500) }
}

internal fun PdfTextSelection.isImageSelection() = origin == "original" &&
    (provenance in listOf("detected-structure", "deliberate-region") || text.isBlank())

internal fun readerImageDescriptor(page: Int, rect: JsonObject, kind: String, label: String) = buildJsonObject {
    put("page", page); put("bbox", rect); put("kind", kind); put("label", label.take(200))
}

internal suspend fun readerQuestionWithCrop(question: String, language: String?, model: Pair<String, String>?,
    selected: Pair<Int, PdfTextSelection>?, threadId: String?, pages: PdfPages?): JsonObject {
    val body = readerQuestionBody(question, language, model, selected, threadId)
    return if (selected?.second?.isImageSelection() == true) withReaderCrop(body, pages, selected) else body
}

internal fun readerBodyWithImage(body: JsonObject, pngBase64: String): JsonObject {
    require(pngBase64.length <= 4_000_000) { "Image attachment is too large" }
    return JsonObject(body + ("croppedPngBase64" to JsonPrimitive(pngBase64)))
}

/** Rebuild queued crops after process restart; request/history databases retain geometry only. */
internal suspend fun readerRetainedCrop(cache: app.fractal.data.PdfCache, body: JsonObject): String? = withContext(Dispatchers.IO) {
    val hash = (body["provenance"] as? JsonObject)?.threadText("pdfSha256")?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }
        ?: return@withContext null
    val page = body["page"]?.jsonPrimitive?.intOrNull ?: return@withContext null
    val file = cache.file(hash)
    if (!file.isFile) return@withContext null
    try {
        PdfPages(file).use { source ->
            if (source.pdfSha256 != hash || page !in 1..source.pageCount) return@use null
            withReaderCrop(body, source, page to PdfTextSelection("", emptyList(), pdfSha256 = hash))["croppedPngBase64"]?.jsonPrimitive?.contentOrNull
        }
    } catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel } catch (_: Exception) { null }
}
