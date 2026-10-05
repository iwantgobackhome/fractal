package app.fractal.reader

import app.fractal.data.*
import app.fractal.pdf.*
import kotlinx.serialization.json.*

/** Exact accepted optional contract; native indexes and translated offsets never become layout ranges. */
internal fun selectionProvenance(page: Int, selection: PdfTextSelection): JsonObject = buildJsonObject {
    put("textSource", if (selection.origin == "translated") "translated" else "original")
    if (selection.origin == "original") {
        if (selection.rects.isNotEmpty()) put("coordinateSpace", "rendered-page-normalized-v1")
        val hash = selection.pdfSha256?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }
        hash?.let { put("pdfSha256", it) }
        val start = selection.start; val end = selection.end
        if (hash != null && selection.provenance == "cached-original-approximate" && start != null && end != null && start < end && selection.extractionVersion != null) {
            put("layoutRange", buildJsonObject { put("page", page); put("extractionVersion", selection.extractionVersion); put("start", selection.start); put("end", selection.end) })
        }
    }
}

/** 0.2.2 saved character offsets inside runs as layout ranges, which every reader then rejected; drop those ranges. */
internal suspend fun repairLayoutRanges(app: ReaderApplication, rows: List<AnnotationEntity>, layout: OriginalTextPage, hash: String?) {
    for (row in rows) {
        val json = runCatching { WireJson.format.parseToJsonElement(row.json).jsonObject }.getOrNull() ?: continue
        val provenance = json["provenance"] as? JsonObject ?: continue
        val range = provenance["layoutRange"] as? JsonObject ?: continue
        val start = range["start"]?.jsonPrimitive?.intOrNull ?: continue
        val end = range["end"]?.jsonPrimitive?.intOrNull ?: continue
        if (hash == null || provenance["pdfSha256"]?.jsonPrimitive?.contentOrNull != hash || layout.page != row.page ||
            range["page"]?.jsonPrimitive?.intOrNull != row.page || range["extractionVersion"]?.jsonPrimitive?.contentOrNull != PDF_TEXT_LAYOUT_VERSION ||
            start !in 0 until end || end > layout.text.length || (layout.publishes(start) && layout.publishes(end))) continue
        editAnnotation(app, json, buildJsonObject { put("provenance", JsonObject(provenance - "layoutRange")) })
    }
}

internal fun sourceContextStatus(provenance: JsonObject?, hash: String?, page: Int, layout: OriginalTextPage?): String {
    val declared = provenance?.get("pdfSha256")?.jsonPrimitive?.contentOrNull ?: return "unknown"
    if (hash == null) return "unavailable"
    if (declared != hash) return "pdf_changed"
    val range = provenance["layoutRange"] as? JsonObject ?: return "current"
    if (range["page"]?.jsonPrimitive?.intOrNull != page) return "range_invalid"
    if (layout == null) return "unavailable"
    if (range["extractionVersion"]?.jsonPrimitive?.contentOrNull != PDF_TEXT_LAYOUT_VERSION) return "layout_changed"
    val start = range["start"]?.jsonPrimitive?.intOrNull ?: return "range_invalid"
    val end = range["end"]?.jsonPrimitive?.intOrNull ?: return "range_invalid"
    return if (layout.page == page && start < end && start in layout.boundaries && end in layout.boundaries) "current" else "range_invalid"
}

internal fun renderedRect(rect: PdfRect, provenance: JsonObject?, rotation: Int): PdfRect {
    if (provenance?.get("coordinateSpace")?.jsonPrimitive?.contentOrNull != "unrotated-crop-normalized-v1") return rect
    val points = listOf(TextPoint(rect.x.toDouble(), rect.y.toDouble()), TextPoint((rect.x + rect.width).toDouble(), rect.y.toDouble()),
        TextPoint((rect.x + rect.width).toDouble(), (rect.y + rect.height).toDouble()), TextPoint(rect.x.toDouble(), (rect.y + rect.height).toDouble())).map { rotateTextPoint(it, rotation) }
    val left = points.minOf { it.x }; val top = points.minOf { it.y }
    return PdfRect(left.toFloat(), top.toFloat(), (points.maxOf { it.x } - left).toFloat(), (points.maxOf { it.y } - top).toFloat())
}
