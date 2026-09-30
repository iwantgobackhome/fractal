package app.fractal.data

import kotlinx.serialization.Serializable
import kotlin.math.abs

const val PDF_TEXT_LAYOUT_VERSION = "pdfjs6-original-advances-v1"

/** Exact original UTF16 and unrotated crop-relative geometry from the published layout route. */
@Serializable data class PdfTextLayout(
    val status: String, val paperKey: String, val extractionVersion: String,
    val pdfSha256: String? = null, val pageCount: Int? = null, val page: OriginalTextPage? = null,
    val reason: String? = null, val message: String? = null, val retryable: Boolean = false,
)
@Serializable data class OriginalTextPage(
    val page: Int, val cropBox: List<Double>, val width: Double, val height: Double,
    val userUnit: Double, val rotation: Int, val text: String, val runs: List<OriginalTextRun>,
    val boundaries: List<Int>, val coverage: String, val issues: List<String>, val readingOrder: String,
)
@Serializable data class OriginalTextUnit(val start: Int, val end: Int, val quad: List<List<Double>>? = null)
@Serializable data class OriginalTextRun(
    val start: Int, val end: Int, val quad: List<List<Double>>? = null,
    val direction: String, val granularity: String, val confidence: String,
    val units: List<OriginalTextUnit>, val words: List<OriginalTextUnit>,
)
data class TextPoint(val x: Double, val y: Double)
data class OriginalRange(val start: Int, val end: Int, val text: String,
    val displayQuads: List<List<TextPoint>>, val originalQuads: List<List<TextPoint>>)

/** Treat mismatched, stale or malformed derived data as unavailable, never as selectable source. */
fun PdfTextLayout.verifiedPage(key: String, localHash: String, physicalPage: Int, localCount: Int): OriginalTextPage? {
    val value = page ?: return null
    if (status != "ready" || paperKey != key || pdfSha256 != localHash ||
        extractionVersion != PDF_TEXT_LAYOUT_VERSION || pageCount != localCount || value.page != physicalPage) return null
    return value.takeIf { it.isValid() }
}

private fun OriginalTextPage.isValid(): Boolean {
    if (page < 1 || cropBox.size != 4 || cropBox.any { !it.isFinite() } ||
        !width.isFinite() || !height.isFinite() || !userUnit.isFinite() || width <= 0 || height <= 0 || userUnit <= 0 ||
        abs(width - (cropBox[2] - cropBox[0])) > .000001 || abs(height - (cropBox[3] - cropBox[1])) > .000001 ||
        rotation !in listOf(0, 90, 180, 270) || coverage !in listOf("text", "partial", "no_text") ||
        readingOrder != "geometric-heuristic" || text.length > 50_000 || runs.size > 10_000 ||
        boundaries.firstOrNull() != 0 || boundaries.lastOrNull() != text.length ||
        boundaries.zipWithNext().any { (left, right) -> left >= right }) return false
    val legal = boundaries.toSet()
    for (offset in boundaries) {
        if (offset !in 0..text.length) return false
        if (offset in 1 until text.length && Character.isHighSurrogate(text[offset - 1]) && Character.isLowSurrogate(text[offset])) return false
        // Provider boundaries remain authoritative for ligatures and grapheme groups. Reject obvious splits too.
        if (offset in 1 until text.length && (text[offset - 1] == '\u200d' || text[offset] == '\u200d')) return false
        if (offset in 1 until text.length && Character.getType(text.codePointAt(offset)) in
            listOf(Character.NON_SPACING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt())) return false
    }
    fun quadValid(quad: List<List<Double>>?) = quad == null || quad.size == 4 && quad.all { it.size == 2 && it.all(Double::isFinite) }
    var priorEnd = 0
    for (run in runs) {
        if (run.start < priorEnd || run.end <= run.start || run.end > text.length || run.start !in legal || run.end !in legal ||
            run.direction !in listOf("ltr", "rtl", "ttb") || run.granularity !in listOf("glyph-advance", "run") ||
            run.confidence !in listOf("approximate", "unsupported") || !quadValid(run.quad)) return false
        priorEnd = run.end
        var cursor = run.start
        for (unit in run.units) {
            if (unit.start != cursor || unit.end <= unit.start || unit.end > run.end || unit.start !in legal || unit.end !in legal || !quadValid(unit.quad)) return false
            cursor = unit.end
        }
        if (cursor != run.end || run.words.any { it.start < run.start || it.end > run.end || it.end <= it.start ||
                it.start !in legal || it.end !in legal || !quadValid(it.quad) }) return false
    }
    return true
}

fun rotateTextPoint(point: TextPoint, rotation: Int) = when (rotation) {
    90 -> TextPoint(1 - point.y, point.x)
    180 -> TextPoint(1 - point.x, 1 - point.y)
    270 -> TextPoint(point.y, 1 - point.x)
    else -> point
}

/** Works in displayed normalized coordinates at every viewport zoom; rotation is applied once here. */
class OriginalTextGeometry(val page: OriginalTextPage) {
    private data class Hit(val unit: OriginalTextUnit, val quad: List<TextPoint>)
    private fun displayed(unit: OriginalTextUnit) = unit.quad?.map { rotateTextPoint(TextPoint(it[0], it[1]), page.rotation) }
    private val units = page.runs.flatMap { it.units }.mapNotNull { unit -> displayed(unit)?.let { Hit(unit, it) } }
    private val words = page.runs.flatMap { it.words }.mapNotNull { unit -> displayed(unit)?.let { Hit(unit, it) } }

    private fun contains(quad: List<TextPoint>, point: TextPoint): Boolean {
        if (point.x !in 0.0..1.0 || point.y !in 0.0..1.0) return false
        var positive = false; var negative = false
        for (index in quad.indices) {
            val a = quad[index]; val b = quad[(index + 1) % quad.size]
            val cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
            if (cross > 1e-9) positive = true
            if (cross < -1e-9) negative = true
        }
        return !(positive && negative)
    }
    private fun hit(point: TextPoint, candidates: List<Hit>) = candidates.firstOrNull { contains(it.quad, point) }
    private fun distance(point: TextPoint, quad: List<TextPoint>): Double {
        val center = TextPoint(quad.map { it.x }.average(), quad.map { it.y }.average())
        // Keep adjacent line choice stable before choosing an inline endpoint.
        val dx = point.x - center.x; val dy = point.y - center.y
        return dx * dx + dy * dy
    }
    private fun nearest(point: TextPoint) = units.minByOrNull { distance(point, it.quad) }

    fun wordAt(x: Double, y: Double): OriginalRange? {
        val point = TextPoint(x, y)
        val found = hit(point, words) ?: hit(point, units) ?: return null
        return range(found.unit.start, found.unit.end)
    }
    fun select(startX: Double, startY: Double, endX: Double, endY: Double): OriginalRange? {
        val start = hit(TextPoint(startX, startY), units) ?: return null
        val end = hit(TextPoint(endX, endY), units) ?: nearest(TextPoint(endX.coerceIn(0.0, 1.0), endY.coerceIn(0.0, 1.0))) ?: return null
        return range(minOf(start.unit.start, end.unit.start), maxOf(start.unit.end, end.unit.end))
    }
    fun endpointAt(x: Double, y: Double): Int? {
        val point = TextPoint(x.coerceIn(0.0, 1.0), y.coerceIn(0.0, 1.0))
        val found = hit(point, units) ?: nearest(point) ?: return null
        val start = TextPoint((found.quad[0].x + found.quad[1].x) / 2, (found.quad[0].y + found.quad[1].y) / 2)
        val end = TextPoint((found.quad[2].x + found.quad[3].x) / 2, (found.quad[2].y + found.quad[3].y) / 2)
        fun squared(at: TextPoint) = (at.x - point.x) * (at.x - point.x) + (at.y - point.y) * (at.y - point.y)
        return if (squared(start) <= squared(end)) found.unit.start else found.unit.end
    }
    fun handlePoint(offset: Int, end: Boolean): TextPoint? {
        val found = if (end) units.lastOrNull { it.unit.end <= offset } else units.firstOrNull { it.unit.start >= offset }
        val quad = found?.quad ?: return null
        return if (end) TextPoint((quad[2].x + quad[3].x) / 2, (quad[2].y + quad[3].y) / 2)
        else TextPoint((quad[0].x + quad[1].x) / 2, (quad[0].y + quad[1].y) / 2)
    }
    fun range(first: Int, last: Int): OriginalRange? {
        val start = minOf(first, last); val end = maxOf(first, last)
        if (start == end || start !in page.boundaries || end !in page.boundaries) return null
        val covered = units.filter { it.unit.start >= start && it.unit.end <= end }
        if (covered.isEmpty()) return null
        return OriginalRange(start, end, page.text.substring(start, end), covered.map { it.quad },
            covered.map { it.unit.quad!!.map { point -> TextPoint(point[0], point[1]) } })
    }
}
