package app.fractal.ink

import kotlin.math.*
import java.util.UUID
import java.time.Instant

private fun distance(a: InkPoint, b: InkPoint): Float = hypot(a.x - b.x, a.y - b.y)
private fun lerp(a: InkPoint, b: InkPoint, f: Float) = InkPoint(
    a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f,
    a.pressure + (b.pressure - a.pressure) * f,
    (a.tMillis + (b.tMillis - a.tMillis) * f).toLong()
)
private fun segmentDistance(p: InkPoint, a: InkPoint, b: InkPoint): Float {
    val dx = b.x - a.x; val dy = b.y - a.y
    val t = if (dx * dx + dy * dy < 1e-10f) 0f else ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
    return distance(p, lerp(a, b, t.coerceIn(0f, 1f)))
}
private fun nearPath(p: InkPoint, path: List<InkPoint>, radius: Float): Boolean =
    path.zipWithNext().any { (a, b) -> segmentDistance(p, a, b) <= radius } ||
        (path.size == 1 && distance(p, path[0]) <= radius)

private fun simplify(points: List<InkPoint>, epsilon: Float): List<InkPoint> {
    if (points.size < 3) return points
    val a = points.first(); val b = points.last()
    var maxDistance = 0f; var index = -1
    for (i in 1 until points.lastIndex) {
        val distance = segmentDistance(points[i], a, b)
        if (distance > maxDistance) { maxDistance = distance; index = i }
    }
    if (index < 0 || maxDistance <= epsilon) return listOf(a,b)
    return simplify(points.subList(0,index+1),epsilon).dropLast(1) + simplify(points.subList(index,points.size),epsilon)
}

/** Return pieces outside the eraser sweep. Cut points are interpolated in vector space. */
fun splitStroke(stroke: InkStroke, eraserPath: List<InkPoint>, radius: Float): List<InkStroke> {
    if (stroke.points.isEmpty() || eraserPath.isEmpty()) return listOf(stroke)
    val samples = buildList {
        stroke.points.zipWithNext().forEach { (a, b) ->
            val steps = max(1, ceil(distance(a, b) / (radius.coerceAtLeast(0.0001f) * 0.25f)).toInt().coerceAtMost(256))
            for (i in 0 until steps) add(lerp(a, b, i.toFloat() / steps))
        }
        add(stroke.points.last())
    }
    val chunks = mutableListOf<MutableList<InkPoint>>()
    var current = mutableListOf<InkPoint>()
    for (point in samples) {
        if (nearPath(point, eraserPath, radius + stroke.width / 2)) {
            if (current.size >= 2) chunks.add(current)
            current = mutableListOf()
        } else current.add(point)
    }
    if (current.size >= 2) chunks.add(current)
    if (chunks.size == 1 && chunks[0].size == samples.size) return listOf(stroke)
    return chunks.map { stroke.copy(id = UUID.randomUUID().toString(), points = it) }
}

fun eraseStrokes(strokes: List<InkStroke>, path: List<InkPoint>, radius: Float, mode: EraserMode): List<InkStroke> =
    strokes.flatMap { stroke ->
        if (stroke.deleted) listOf(stroke)
        else if (mode == EraserMode.Partial) {
            val pieces = splitStroke(stroke,path,radius)
            if (pieces.size == 1 && pieces[0].id == stroke.id) listOf(stroke)
            else listOf(stroke.copy(deleted=true,rev=stroke.rev+1,updatedAt=Instant.now().toString())) + pieces.map { it.copy(rev=0,updatedAt=Instant.now().toString()) }
        }
        else if (stroke.points.any { nearPath(it, path, radius + stroke.width / 2) } ||
            stroke.points.zipWithNext().any { (a, b) ->
                path.any { segmentDistance(it, a, b) <= radius + stroke.width / 2 }
            }) listOf(stroke.copy(deleted=true,rev=stroke.rev+1,updatedAt=Instant.now().toString())) else listOf(stroke)
    }

data class RecognizedShape(val type: String, val points: List<InkPoint>, val confidence: Float)

/** Recognizes only clear shapes; an ambiguous gesture remains handwriting. */
fun recognizeShape(points: List<InkPoint>): RecognizedShape? {
    if (points.size < 4) return null
    val b = listOf(points).map { InkStroke(paperKey = "_", page = 1, updatedAt = "", deviceId = "_", color = "", width = .001f, points = it) }.bounds() ?: return null
    val diagonal = hypot(b.width, b.height)
    if (diagonal < .015f) return null
    val start = points.first(); val end = points.last()
    val closed = distance(start, end) < diagonal * .18f
    val flatness = points.maxOf { segmentDistance(it, start, end) } / diagonal
    fun p(x: Float, y: Float, index: Int) = InkPoint(x, y, points[index.coerceIn(points.indices)].pressure, points[index.coerceIn(points.indices)].tMillis)
    if (!closed && flatness < .07f) return RecognizedShape("line", listOf(start, end), 1f - flatness)
    if (!closed && points.size >= 7) {
        val corners = simplify(points, diagonal * .035f)
        if (corners.size in 4..7) {
            val tip = corners[1]
            val nearTip = corners.drop(2).any { distance(it,tip) < diagonal*.12f }
            val shaftFlat = points.take(points.indexOfFirst { distance(it,tip) < diagonal*.04f }.coerceAtLeast(1)+1)
                .maxOf { segmentDistance(it,start,tip) } / diagonal
            if (nearTip && shaftFlat < .07f && distance(start,tip) > diagonal*.6f)
                return explicitShape(start,tip,ShapeMode.Arrow).copy(confidence=.82f)
        }
    }
    if (!closed || min(b.width, b.height) < diagonal * .15f) return null
    val ellipseError = points.map { q ->
        val nx = (q.x - (b.left + b.right) / 2) / (b.width / 2)
        val ny = (q.y - (b.top + b.bottom) / 2) / (b.height / 2)
        abs(hypot(nx, ny) - 1f)
    }.average().toFloat()
    val corners = listOf(p(b.left,b.top,0), p(b.right,b.top,1), p(b.right,b.bottom,2), p(b.left,b.bottom,3))
    val rectangleError = points.map { q -> (0..3).minOf { i -> segmentDistance(q, corners[i], corners[(i + 1) % 4]) } }.average().toFloat() / diagonal
    if (rectangleError < .065f && rectangleError < ellipseError * .4f)
        return RecognizedShape("rectangle", corners + corners.first(), 1f - rectangleError)
    if (ellipseError < .16f) {
        val oval = (0..48).map { i ->
            val angle = 2 * PI * i / 48
            p(((b.left + b.right) / 2 + cos(angle).toFloat() * b.width / 2), ((b.top + b.bottom) / 2 + sin(angle).toFloat() * b.height / 2), i * (points.size - 1) / 48)
        }
        return RecognizedShape("ellipse", oval, 1f - ellipseError)
    }
    val polygonCorners = simplify(points, diagonal*.06f)
    if (polygonCorners.size == 4 && distance(polygonCorners.first(),polygonCorners.last()) < diagonal*.18f) {
        val vertices = polygonCorners.take(3)
        val error = points.map { q -> (0..2).minOf { i -> segmentDistance(q, vertices[i], vertices[(i+1)%3]) } }.average().toFloat() / diagonal
        if (error < .07f) return RecognizedShape("triangle", vertices + vertices.first(), 1f - error)
    }
    return null
}

fun explicitShape(start: InkPoint, end: InkPoint, mode: ShapeMode): RecognizedShape {
    val left = min(start.x, end.x); val right = max(start.x, end.x)
    val top = min(start.y, end.y); val bottom = max(start.y, end.y)
    fun point(x: Float, y: Float) = start.copy(x = x, y = y)
    val points = when (mode) {
        ShapeMode.Line -> listOf(start, end)
        ShapeMode.Arrow -> {
            val dx = end.x-start.x; val dy = end.y-start.y
            val length = hypot(dx,dy).coerceAtLeast(.0001f); val back = min(.025f,length*.25f)
            listOf(start,end,point(end.x-dx/length*back-dy/length*back*.5f,end.y-dy/length*back+dx/length*back*.5f),end,
                point(end.x-dx/length*back+dy/length*back*.5f,end.y-dy/length*back-dx/length*back*.5f))
        }
        ShapeMode.Rectangle -> listOf(point(left,top),point(right,top),point(right,bottom),point(left,bottom),point(left,top))
        ShapeMode.Ellipse -> (0..48).map { i -> val angle = 2*PI*i/48; point((left+right)/2+cos(angle).toFloat()*(right-left)/2,(top+bottom)/2+sin(angle).toFloat()*(bottom-top)/2) }
    }
    return RecognizedShape(mode.name.lowercase(), points, 1f)
}

fun straightenHighlighter(points: List<InkPoint>): List<InkPoint> {
    if (points.size < 2) return points
    val first = points.first(); val last = points.last()
    if (abs(last.y-first.y) > abs(last.x-first.x)*.13f) return points
    val mid = (first.y+last.y)/2
    return listOf(first.copy(y=mid),last.copy(y=mid))
}

fun lassoSelect(strokes: List<InkStroke>, polygon: List<InkPoint>): Set<String> {
    if (polygon.size < 3) return emptySet()
    fun inside(p: InkPoint): Boolean {
        var result = false
        for (i in polygon.indices) {
            val a = polygon[i]; val b = polygon[(i+1)%polygon.size]
            if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) result = !result
        }
        return result
    }
    return strokes.filter { s -> !s.deleted && s.points.isNotEmpty() && s.points.count(::inside) >= s.points.size/2 }.map { it.id }.toSet()
}

/** Width is page-width normalized; both cursor axes and erasure use this same pixel radius. */
fun eraserRadiusPx(width: Float, pageWidthPx: Float): Float = width * pageWidthPx / 2

fun eraseStrokesOnPage(strokes: List<InkStroke>, path: List<InkPoint>, width: Float,
    pageWidthPx: Float, pageHeightPx: Float, mode: EraserMode): List<InkStroke> {
    val aspect = pageHeightPx / pageWidthPx.coerceAtLeast(1f)
    fun scaled(p: InkPoint) = p.copy(y = p.y * aspect)
    val scaledStrokes = strokes.map { it.copy(points = it.points.map(::scaled)) }
    val originals = strokes.associateBy { it.id }
    val result = eraseStrokes(scaledStrokes, path.map(::scaled),
        eraserRadiusPx(width, pageWidthPx) / pageWidthPx.coerceAtLeast(1f), mode)
    return result.map { stroke ->
        val original = originals[stroke.id]
        if (original != null) stroke.copy(points = original.points)
        else stroke.copy(points = stroke.points.map { p -> p.copy(y = p.y / aspect) })
    }
}
