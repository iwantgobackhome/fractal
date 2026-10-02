package app.fractal.ink

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.buildSerialDescriptor
import kotlinx.serialization.encoding.CompositeDecoder
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.encoding.decodeStructure
import kotlinx.serialization.encoding.encodeStructure
import kotlinx.serialization.json.Json
import java.util.UUID
import java.time.Instant

@Serializable(with = InkPointSerializer::class)
data class InkPoint(val x: Float, val y: Float, val pressure: Float, val tMillis: Long)

@OptIn(kotlinx.serialization.InternalSerializationApi::class)
object InkPointSerializer : KSerializer<InkPoint> {
    override val descriptor = buildSerialDescriptor("InkPoint", kotlinx.serialization.descriptors.StructureKind.LIST) {
        element("x", PrimitiveSerialDescriptor("x", PrimitiveKind.FLOAT))
        element("y", PrimitiveSerialDescriptor("y", PrimitiveKind.FLOAT))
        element("pressure", PrimitiveSerialDescriptor("pressure", PrimitiveKind.FLOAT))
        element("tMillis", PrimitiveSerialDescriptor("tMillis", PrimitiveKind.LONG))
    }
    override fun serialize(encoder: Encoder, value: InkPoint) = encoder.encodeStructure(descriptor) {
        encodeFloatElement(descriptor, 0, value.x); encodeFloatElement(descriptor, 1, value.y)
        encodeFloatElement(descriptor, 2, value.pressure); encodeLongElement(descriptor, 3, value.tMillis)
    }
    override fun deserialize(decoder: Decoder): InkPoint = decoder.decodeStructure(descriptor) {
        val v = FloatArray(3); var t = 0L
        if (decodeSequentially()) {
            for (i in 0..2) v[i] = decodeFloatElement(descriptor, i)
            t = decodeLongElement(descriptor, 3)
        } else while (true) {
            when (val i = decodeElementIndex(descriptor)) {
                CompositeDecoder.DECODE_DONE -> break
                in 0..2 -> v[i] = decodeFloatElement(descriptor, i)
                3 -> t = decodeLongElement(descriptor, 3)
                else -> error("Invalid point index")
            }
        }
        InkPoint(v[0], v[1], v[2], t)
    }
}

@Serializable
data class InkShape(val type: String, val snapped: Boolean = true)

@Serializable
data class InkStroke(
    val id: String = UUID.randomUUID().toString(),
    val paperKey: String,
    val updatedAt: String,
    val deleted: Boolean = false,
    val rev: Int = 0,
    val deviceId: String,
    val kind: String = "ink",
    val page: Int,
    val tool: String = "pen",
    val color: String,
    val width: Float,
    val points: List<InkPoint>,
    val brush: String? = null,
    val shape: InkShape? = null,
    val tilt: List<Float>? = null,
)

object InkJson {
    val format = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    fun encode(strokes: List<InkStroke>): String = format.encodeToString(kotlinx.serialization.builtins.ListSerializer(InkStroke.serializer()), strokes)
    fun decode(json: String): List<InkStroke> = format.decodeFromString(kotlinx.serialization.builtins.ListSerializer(InkStroke.serializer()), json)
}

data class InkBounds(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
}
fun List<InkStroke>.bounds(): InkBounds? {
    val points = flatMap { it.points }
    if (points.isEmpty()) return null
    return InkBounds(points.minOf { it.x }, points.minOf { it.y }, points.maxOf { it.x }, points.maxOf { it.y })
}

data class InkChange(val before: List<InkStroke>, val after: List<InkStroke>)

/** Focus and deltas in local pixels; raw deltas avoid feedback when the page moves under a pinch. */
data class InkFingerTransform(val panX: Float, val panY: Float, val zoom: Float, val focusX: Float, val focusY: Float)

/** One instance per PDF page. All coordinates are normalized; a zoom change never mutates them. */
class InkPageState {
    var strokes by mutableStateOf<List<InkStroke>>(emptyList()); private set
    var selectedIds by mutableStateOf<Set<String>>(emptySet()); private set
    private val undo = ArrayDeque<InkChange>()
    private val redo = ArrayDeque<InkChange>()
    var onChange: ((InkChange) -> Unit)? = null
    fun load(strokes: List<InkStroke>) { this.strokes = strokes; selectedIds = emptySet(); undo.clear(); redo.clear() }
    fun export(): List<InkStroke> = strokes
    fun apply(after: List<InkStroke>) {
        if (after == strokes) return
        val change = InkChange(strokes, after)
        undo.addLast(change); redo.clear(); strokes = after; onChange?.invoke(change)
    }
    private var gestureBefore: List<InkStroke>? = null
    fun beginGesture() { gestureBefore = strokes }
    fun previewGesture(after: List<InkStroke>) { strokes = after }
    fun finishGesture(commit: Boolean) {
        val before = gestureBefore ?: return
        val after = strokes
        strokes = before; gestureBefore = null
        if (commit) apply(after)
    }
    fun undo(): Boolean {
        if (undo.isEmpty()) return false
        val change = undo.removeLast(); redo.addLast(change); strokes = change.before; onChange?.invoke(InkChange(change.after, change.before)); return true
    }
    fun redo(): Boolean {
        if (redo.isEmpty()) return false
        val change = redo.removeLast(); undo.addLast(change); strokes = change.after; onChange?.invoke(change); return true
    }
    fun select(ids: Set<String>) { selectedIds = ids }
    fun selection(): List<InkStroke> = strokes.filter { it.id in selectedIds && !it.deleted }
    fun deleteSelection() { apply(strokes.map { if (it.id in selectedIds) it.edited(deleted = true) else it }); selectedIds = emptySet() }
    fun duplicateSelection(dx: Float = 0.025f, dy: Float = 0.025f) {
        val copies = selection().map { s -> s.copy(id = UUID.randomUUID().toString(), rev = 0, updatedAt = Instant.now().toString(), points = s.points.map { it.copy(x = (it.x + dx).coerceIn(0f, 1f), y = (it.y + dy).coerceIn(0f, 1f)) }) }
        apply(strokes + copies); selectedIds = copies.map { it.id }.toSet()
    }
    fun recolorSelection(color: String) { apply(strokes.map { if (it.id in selectedIds) it.edited(color = color) else it }) }
    fun transformSelection(dx: Float, dy: Float, scaleX: Float = 1f, scaleY: Float = 1f) {
        val b = selection().bounds() ?: return
        apply(strokes.map { s -> if (s.id !in selectedIds) s else s.edited(points = s.points.map { p -> p.copy(
            x = (b.left + (p.x - b.left) * scaleX + dx).coerceIn(0f, 1f),
            y = (b.top + (p.y - b.top) * scaleY + dy).coerceIn(0f, 1f)) }) })
    }
}
private fun InkStroke.edited(
    deleted: Boolean = this.deleted,
    color: String = this.color,
    points: List<InkPoint> = this.points,
) = copy(deleted = deleted, color = color, points = points, rev = rev + 1, updatedAt = Instant.now().toString())

enum class InkTool { Ballpoint, Fountain, Pencil, Highlighter, Eraser, Shape, Lasso }
enum class EraserMode { Stroke, Partial }
enum class ShapeMode { Line, Arrow, Rectangle, Ellipse }
class InkToolState {
    var active by mutableStateOf(InkTool.Ballpoint)
    private val colors = mutableStateMapOf<InkTool,String>()
    var color: String
        get() = colors[active] ?: if (active == InkTool.Highlighter) "#F5DC6B" else "#1C1B19"
        set(value) { colors[active] = value }
    fun colorsString(): String = InkTool.entries.joinToString(",") { "${it.name}:${colors[it] ?: ""}" }
    fun loadColors(value: String) {
        value.split(",").forEach { part ->
            val pair = part.split(":"); if (pair.size == 2 && pair[1].isNotEmpty()) {
                val key = runCatching { InkTool.valueOf(pair[0]) }.getOrNull()
                if (key != null) colors[key] = pair[1]
            }
        }
    }
    private val widths = mutableStateMapOf<InkTool,Float>()
    fun widthFor(item: InkTool): Float = widths[item] ?: when (item) {
        InkTool.Highlighter -> .015f
        InkTool.Eraser -> .014f
        else -> .003f
    }
    var width: Float
        get() = widthFor(active)
        set(value) { widths[active] = value }
    fun widthsString(): String = InkTool.entries.joinToString(",") { "${it.name}:${widths[it] ?: ""}" }
    fun loadWidths(value: String) {
        value.split(",").forEach { part ->
            val pair = part.split(":"); if (pair.size == 2) {
                val key = runCatching { InkTool.valueOf(pair[0]) }.getOrNull()
                val width = pair[1].toFloatOrNull()
                if (key != null && width != null) widths[key] = width
            }
        }
    }
    var eraserMode by mutableStateOf(EraserMode.Stroke)
    var buttonEraserMode by mutableStateOf(EraserMode.Stroke)
    var shapeMode by mutableStateOf(ShapeMode.Line)
    var recentColors by mutableStateOf<List<String>>(emptyList())
    fun chooseColor(value: String) { color = value; recentColors = (listOf(value) + recentColors.filterNot { it == value }).take(5) }
}

/** Pure input state machine so button transitions can be tested without Android. */
class PenButtonState {
    var erasing = false; private set
    fun update(isStylus: Boolean, sideButton: Boolean, eraserTip: Boolean): Boolean {
        erasing = isStylus && (sideButton || eraserTip)
        return erasing
    }
}
