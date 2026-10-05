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
) {
    /** Offsets the Hub published; desktop and Hub only accept layout ranges whose ends are among them. */
    fun publishes(offset: Int) = boundaries.binarySearch(offset) >= 0
}
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

private val COMBINING_TYPES = setOf(Character.NON_SPACING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt())

/** Works in displayed normalized coordinates at every viewport zoom; rotation is applied once here. */
class OriginalTextGeometry(val page: OriginalTextPage) {
    private data class Hit(val unit: OriginalTextUnit, val quad: List<TextPoint>)
    private fun displayed(unit: OriginalTextUnit) = unit.quad?.map { rotateTextPoint(TextPoint(it[0], it[1]), page.rotation) }
    // Run-granularity fallbacks only publish run edges. Split them at grapheme edges so a drag
    // selects characters rather than a whole line; widths are interpolated evenly across the run.
    private val legal: List<Int> = page.boundaries.toSortedSet().apply {
        for (run in page.runs) if (run.granularity == "run" && run.direction == "ltr" && none { it > run.start && it < run.end }) {
            val breaks = java.text.BreakIterator.getCharacterInstance()
            breaks.setText(page.text.substring(run.start, run.end))
            var edge = breaks.first()
            while (edge != java.text.BreakIterator.DONE) {
                val offset = run.start + edge
                if (offset == run.start || offset == run.end || page.text[offset - 1] != '\u200d' && page.text[offset] != '\u200d' &&
                    Character.getType(page.text.codePointAt(offset)) !in COMBINING_TYPES) add(offset)
                edge = breaks.next()
            }
        }
    }.toList()
    private val legalSet = legal.toHashSet()
    private val units = page.runs.flatMap { run ->
        if (run.granularity != "run") run.units else run.units.flatMap { unit ->
            val quad = unit.quad ?: return@flatMap listOf(unit)
            val first = legal.binarySearch(unit.start); val last = legal.binarySearch(unit.end)
            if (first < 0 || last <= first) return@flatMap listOf(unit)
            val boundaries = legal.subList(first, last + 1)
            boundaries.zipWithNext().map { (start, end) ->
                val a = (start - unit.start).toDouble() / (unit.end - unit.start)
                val b = (end - unit.start).toDouble() / (unit.end - unit.start)
                fun edge(from: Int, to: Int, t: Double) = listOf(
                    quad[from][0] + (quad[to][0] - quad[from][0]) * t,
                    quad[from][1] + (quad[to][1] - quad[from][1]) * t)
                OriginalTextUnit(start, end, listOf(edge(0, 3, a), edge(1, 2, a), edge(1, 2, b), edge(0, 3, b)))
            }
        }
    }.mapNotNull { unit -> displayed(unit)?.let { Hit(unit, it) } }
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
        val dx = maxOf(quad.minOf { it.x } - point.x, 0.0, point.x - quad.maxOf { it.x })
        val dy = maxOf(quad.minOf { it.y } - point.y, 0.0, point.y - quad.maxOf { it.y })
        return dx * dx + dy * dy
    }
    private fun nearest(point: TextPoint) = units.minByOrNull { distance(point, it.quad) }

    fun wordAt(x: Double, y: Double): OriginalRange? {
        val point = TextPoint(x, y)
        val unit = hit(point, units) ?: return null
        val run = page.runs.firstOrNull { unit.unit.start in it.start until it.end }
        if (run?.granularity == "run") {
            var start = unit.unit.start; var end = unit.unit.end
            while (start > run.start && !page.text[start - 1].isWhitespace()) start--
            while (end < run.end && !page.text[end].isWhitespace()) end++
            start = legal.last { it <= start }; end = legal.first { it >= end }
            return range(start, end)
        }
        val found = hit(point, words) ?: unit
        return range(found.unit.start, found.unit.end)
    }
    // The published reading order sorts runs strictly by y. Math and sub/superscript runs sit a
    // hair off their baseline and interleave with the line above, so a drag between two points
    // of one visual line would grab unrelated text. Rebuild visual lines from geometry instead:
    // runs that overlap vertically and sit close horizontally share a line, read left to right.
    private fun runIndexOf(offset: Int): Int {
        var low = 0; var high = page.runs.size - 1
        while (low <= high) {
            val mid = (low + high) ushr 1; val run = page.runs[mid]
            if (offset < run.start) high = mid - 1 else if (offset >= run.end) low = mid + 1 else return mid
        }
        return -1
    }
    private val lineOfRun = HashMap<Int, Int>()
    private val visual: List<Hit> = run {
        val byRun = units.groupBy { runIndexOf(it.unit.start) }
        val aspect = if (page.rotation == 90 || page.rotation == 270) page.width / page.height else page.height / page.width
        class Box(var left: Double, var top: Double, var right: Double, var bottom: Double)
        fun box(quad: List<TextPoint>) = Box(quad.minOf { it.x }, quad.minOf { it.y }, quad.maxOf { it.x }, quad.maxOf { it.y })
        val lines = mutableListOf<Pair<Box?, MutableList<Int>>>()
        for (index in page.runs.indices) {
            val hits = byRun[index] ?: continue
            val own = box(hits.flatMap { it.quad })
            val height = own.bottom - own.top
            val line = lines.firstOrNull { (bounds, _) ->
                bounds != null && run {
                    val overlap = minOf(bounds.bottom, own.bottom) - maxOf(bounds.top, own.top)
                    val gap = maxOf(0.0, bounds.left - own.right, own.left - bounds.right)
                    overlap >= .5 * minOf(height, bounds.bottom - bounds.top) && gap <= 1.5 * height * aspect
                }
            }
            if (line == null) lines += own to mutableListOf(index)
            else {
                line.first!!.apply { left = minOf(left, own.left); top = minOf(top, own.top); right = maxOf(right, own.right); bottom = maxOf(bottom, own.bottom) }
                line.second += index
            }
        }
        lines.forEachIndexed { line, (_, runs) -> runs.forEach { lineOfRun[it] = line } }
        lines.flatMap { (_, runs) -> runs.sortedBy { index -> byRun.getValue(index).minOf { hit -> hit.quad.minOf { it.x } } }
            .flatMap { byRun.getValue(it) } }
    }
    private val position = visual.withIndex().associate { (index, hit) -> hit.unit.start to index }
    private val endPosition = visual.withIndex().associate { (index, hit) -> hit.unit.end to index }
    /** Offsets name the boundary before a unit start, or after a unit end, in visual order. */
    private fun boundary(offset: Int): Int? = position[offset] ?: endPosition[offset]?.plus(1)

    fun select(startX: Double, startY: Double, endX: Double, endY: Double): OriginalRange? {
        val start = hit(TextPoint(startX, startY), units) ?: return null
        val end = hit(TextPoint(endX, endY), units) ?: nearest(TextPoint(endX.coerceIn(0.0, 1.0), endY.coerceIn(0.0, 1.0))) ?: return null
        val a = position[start.unit.start] ?: return null; val b = position[end.unit.start] ?: return null
        return slice(minOf(a, b), maxOf(a, b) + 1)
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
        val found = if (end) endPosition[offset]?.let(visual::get) ?: units.lastOrNull { it.unit.end <= offset }
            else position[offset]?.let(visual::get) ?: units.firstOrNull { it.unit.start >= offset }
        val quad = found?.quad ?: return null
        return if (end) TextPoint((quad[2].x + quad[3].x) / 2, (quad[2].y + quad[3].y) / 2)
        else TextPoint((quad[0].x + quad[1].x) / 2, (quad[0].y + quad[1].y) / 2)
    }
    fun range(first: Int, last: Int): OriginalRange? {
        if (first == last || first !in legalSet || last !in legalSet) return null
        val a = boundary(first) ?: return null; val b = boundary(last) ?: return null
        return slice(minOf(a, b), maxOf(a, b))
    }
    private fun slice(from: Int, until: Int): OriginalRange? {
        if (from >= until) return null
        val selected = visual.subList(from, until)
        val firstHit = selected.first(); val lastHit = selected.last()
        // Runs identify line spans. Overlapping endpoint runs establish the selected column.
        fun runBounds(hit: Hit) = page.runs.getOrNull(runIndexOf(hit.unit.start))
            ?.quad?.map { rotateTextPoint(TextPoint(it[0], it[1]), page.rotation) }
        val a = runBounds(firstHit); val b = runBounds(lastHit)
        val left = minOf(a?.minOf { it.x } ?: 0.0, b?.minOf { it.x } ?: 0.0)
        val right = maxOf(a?.maxOf { it.x } ?: 1.0, b?.maxOf { it.x } ?: 1.0)
        val sameColumn = a != null && b != null && maxOf(a.minOf { it.x }, b.minOf { it.x }) < minOf(a.maxOf { it.x }, b.maxOf { it.x }) &&
            listOf(firstHit, lastHit).mapNotNull { page.runs.getOrNull(runIndexOf(it.unit.start)) }
                .none { page.text.substring(it.start, it.end).isBlank() }
        val top = minOf(firstHit.quad.minOf { it.y }, lastHit.quad.minOf { it.y })
        val bottom = maxOf(firstHit.quad.maxOf { it.y }, lastHit.quad.maxOf { it.y })
        val covered = selected.filter { !sameColumn || (it.quad.maxOf { p -> p.x } >= left && it.quad.minOf { p -> p.x } <= right &&
            it.quad.maxOf { p -> p.y } >= top && it.quad.minOf { p -> p.y } <= bottom) }
        if (covered.isEmpty()) return null
        val text = StringBuilder(page.text.substring(covered.first().unit.start, covered.first().unit.end))
        covered.zipWithNext().forEach { (previous, next) ->
            val between = if (next.unit.start >= previous.unit.end) page.text.substring(previous.unit.end, next.unit.start) else null
            text.append(when {
                between != null && between.isBlank() -> between
                runIndexOf(previous.unit.start) == runIndexOf(next.unit.start) -> ""
                lineOfRun[runIndexOf(previous.unit.start)] != lineOfRun[runIndexOf(next.unit.start)] -> "\n"
                text.lastOrNull()?.isWhitespace() == true || page.text[next.unit.start].isWhitespace() -> ""
                else -> " "
            })
            text.append(page.text, next.unit.start, next.unit.end)
        }
        return OriginalRange(covered.first().unit.start, covered.last().unit.end, text.toString(), covered.map { it.quad },
            covered.map { it.unit.quad!!.map { point -> TextPoint(point[0], point[1]) } })
    }
}
