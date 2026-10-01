package app.fractal.ink

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.viewinterop.AndroidView
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.brush.Brush
import androidx.ink.brush.StockBrushes
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer
import androidx.ink.brush.InputToolType
import androidx.ink.strokes.MutableStrokeInputBatch
import androidx.ink.strokes.Stroke
import androidx.input.motionprediction.MotionEventPredictor
import java.time.Instant
import kotlin.math.max
import kotlin.math.min

private fun brushName(tool: InkTool) = when (tool) {
    InkTool.Ballpoint -> "ballpoint"
    InkTool.Fountain -> "fountain"
    InkTool.Pencil -> "pencil"
    InkTool.Highlighter -> "highlighter"
    else -> "shape"
}

private fun inkBrush(brushName: String?, color: String, widthPx: Float): Brush {
    val family = when (brushName) {
        "fountain" -> StockBrushes.pressurePen()
        "highlighter" -> StockBrushes.highlighter()
        else -> StockBrushes.marker()
    }
    val parsed = try { Color.parseColor(color) } catch (_: IllegalArgumentException) { Color.BLACK }
    val argb = when (brushName) {
        "highlighter" -> (parsed and 0x00ffffff) or (0x70 shl 24)
        "pencil" -> (parsed and 0x00ffffff) or (0xa8 shl 24)
        else -> parsed
    }
    return Brush.createWithColorIntArgb(family, argb, max(widthPx, .5f), .1f)
}

/** Overlay this over a rendered PDF page. pageSize is the rendered page size in local pixels. */
@Composable
fun InkCanvas(
    state: InkPageState,
    tool: InkToolState,
    modifier: Modifier = Modifier,
    pageSize: Size,
    onStrokesChanged: (InkChange) -> Unit = {},
    onSelectionAsk: (List<InkStroke>, InkBounds) -> Unit = { _, _ -> },
    onFingerGesture: (panX: Float, panY: Float, zoom: Float) -> Unit = { _, _, _ -> },
    onFingerLongPress: (x: Float, y: Float) -> Unit = { _, _ -> },
    onFingerDoubleTap: () -> Unit = {},
    onWritingStateChanged: (Boolean) -> Unit = {},
    paperKey: String = "demo",
    page: Int = 1,
    deviceId: String = "android",
    fingerScrollsParent: Boolean = false,
    onTextSelection: (InkPoint, InkPoint) -> Unit = { _, _ -> },
    onFingerTransform: ((InkFingerTransform) -> Unit)? = null,
    nativeInkRouting: Boolean = false,
    nativeViewportInWindow: android.graphics.Rect? = null,
) {
    DisposableEffect(state, onStrokesChanged) {
        state.onChange = onStrokesChanged
        onDispose { state.onChange = null }
    }
    key(state, paperKey, page, deviceId) {
        AndroidView(
            factory = { context -> InkSurface(context, state, tool, onSelectionAsk, onFingerGesture, onFingerLongPress, onFingerDoubleTap, onWritingStateChanged, paperKey, page, deviceId) },
            update = { surface ->
                surface.tool = tool
                surface.onAsk = onSelectionAsk
                surface.onFingerGesture = onFingerGesture
                surface.onFingerLongPress = onFingerLongPress
                surface.onFingerDoubleTap = onFingerDoubleTap
                surface.onWritingStateChanged = onWritingStateChanged
                surface.fingerScrollsParent = fingerScrollsParent
                surface.onTextSelection = onTextSelection
                surface.onFingerTransform = onFingerTransform
                surface.pageSize = pageSize
                surface.nativeInkRouting = nativeInkRouting
                surface.nativeViewportInWindow = nativeViewportInWindow
                surface.sync(state.strokes, state.selectedIds)
            },
            modifier = modifier,
        )
    }
}

private class InkSurface(
    context: Context,
    private val state: InkPageState,
    var tool: InkToolState,
    var onAsk: (List<InkStroke>, InkBounds) -> Unit,
    var onFingerGesture: (Float, Float, Float) -> Unit,
    var onFingerLongPress: (Float, Float) -> Unit,
    var onFingerDoubleTap: () -> Unit,
    var onWritingStateChanged: (Boolean) -> Unit,
    private val paperKey: String,
    private val page: Int,
    private val deviceId: String,
) : FrameLayout(context) {
    var pageSize: Size = Size.Zero
    var fingerScrollsParent = false
    var nativeInkRouting = false
    var nativeViewportInWindow: android.graphics.Rect? = null
    var onTextSelection: (InkPoint, InkPoint) -> Unit = { _, _ -> }
    var onFingerTransform: ((InkFingerTransform) -> Unit)? = null
    private val dry = DryInkView(context)
    private val wet = InProgressStrokesView(context)
    private val predictor = MotionEventPredictor.newInstance(wet)
    private val button = PenButtonState()
    private var pointerId = -1
    private var wetId: InProgressStrokeId? = null
    private var path = mutableListOf<InkPoint>()
    private var tilts = mutableListOf<Float>()
    private var gestureTool = InkTool.Ballpoint
    private var gestureEraser = EraserMode.Stroke
    private var gestureColor = "#1C1B19"
    private var gestureWidth = .003f
    private var gestureShape = ShapeMode.Line
    // Kept until the entire stream ends, including any palm remaining after pen-up.
    private var penOwnsStream = false
    private var pinchOwnsStream = false
    private var lastMotion = 0L
    private var selectionStart: InkPoint? = null
    private var selectionBounds: InkBounds? = null
    private var resizeCorner = -1
    private var heldSnapped = false
    private var fingerX = 0f
    private var fingerY = 0f
    private var fingerSpan = 0f
    private var fingerRawX = 0f
    private var fingerRawY = 0f
    private var fingerActive = false
    private var fingerDownX = 0f
    private var fingerDownY = 0f
    private var lastFingerTapMs = 0L
    private var fingerMoved = false
    private val touchSlop = android.view.ViewConfiguration.get(context).scaledTouchSlop
    private val fingerHold = Runnable {
        if (!fingerActive || fingerMoved || penOwnsStream) return@Runnable
        fingerMoved = true
        lastFingerTapMs = 0L
        onFingerLongPress(
            (fingerDownX / width.coerceAtLeast(1)).coerceIn(0f, 1f),
            (fingerDownY / height.coerceAtLeast(1)).coerceIn(0f, 1f),
        )
    }
    private val hold = Runnable {
        if (gestureTool !in listOf(InkTool.Eraser, InkTool.Lasso, InkTool.Shape, InkTool.TextSelection) &&
            path.size >= 4 && android.os.SystemClock.uptimeMillis() - lastMotion >= 480 &&
            recognizeShape(path) != null) {
            heldSnapped = true
        }
    }

    init {
        addView(dry, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(wet, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        wet.addFinishedStrokesListener(object : InProgressStrokesFinishedListener {
            override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
                wet.removeFinishedStrokes(strokes.keys)
            }
        })
        wet.setOnTouchListener { view, event -> handle(view, event) }
        wet.eagerInit()
    }

    fun sync(strokes: List<InkStroke>, selectedIds: Set<String>) { dry.sync(strokes, selectedIds) }

    private fun point(event: MotionEvent, index: Int, historical: Int = -1): InkPoint {
        val w = if (pageSize.width > 0) pageSize.width else width.toFloat().coerceAtLeast(1f)
        val h = if (pageSize.height > 0) pageSize.height else height.toFloat().coerceAtLeast(1f)
        val x = if (historical < 0) event.getX(index) else event.getHistoricalX(index, historical)
        val y = if (historical < 0) event.getY(index) else event.getHistoricalY(index, historical)
        val pressure = if (historical < 0) event.getPressure(index) else event.getHistoricalPressure(index, historical)
        val time = if (historical < 0) event.eventTime else event.getHistoricalEventTime(historical)
        return InkPoint((x / w).coerceIn(0f, 1f), (y / h).coerceIn(0f, 1f), pressure.coerceIn(0f, 1f), time)
    }
    private fun collect(event: MotionEvent, index: Int) {
        for (h in 0 until event.historySize) {
            path.add(point(event, index, h))
            tilts.add(event.getHistoricalAxisValue(MotionEvent.AXIS_TILT, index, h))
        }
        path.add(point(event, index))
        tilts.add(event.getAxisValue(MotionEvent.AXIS_TILT, index))
        lastMotion = android.os.SystemClock.uptimeMillis()
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        readerInputHost()?.register(this, { event ->
            nativeInkRouting && (tool.active !in listOf(InkTool.TextSelection, InkTool.Lasso) ||
                event.getToolType(event.actionIndex) == MotionEvent.TOOL_TYPE_ERASER ||
                event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY != 0)
        }, { event -> handle(wet, event) }, { nativeViewportInWindow })
    }
    override fun onDetachedFromWindow() {
        readerInputHost()?.unregister(this)
        val now = android.os.SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
        try { cancel(event) } finally { event.recycle() }
        super.onDetachedFromWindow()
    }

    private fun cancel(event: MotionEvent, releaseStream: Boolean = true) {
        if (pointerId >= 0) onWritingStateChanged(false)
        removeCallbacks(hold)
        removeCallbacks(fingerHold)
        wetId?.let { wet.cancelStroke(it, event) }
        wetId = null; pointerId = -1; fingerActive = false; path.clear(); tilts.clear(); dry.transient = emptyList()
        if (releaseStream) {
            penOwnsStream = false; pinchOwnsStream = false
            parent?.requestDisallowInterceptTouchEvent(false)
        }
    }
    private fun handle(view: View, event: MotionEvent): Boolean {
        val action = event.actionMasked
        if (action == MotionEvent.ACTION_DOWN && (penOwnsStream || fingerActive)) cancel(event)
        if (action == MotionEvent.ACTION_CANCEL ||
            ((event.flags and MotionEvent.FLAG_CANCELED) != 0 &&
                event.getPointerId(event.actionIndex) == pointerId)) {
            cancel(event, releaseStream = action != MotionEvent.ACTION_POINTER_UP)
            return true
        }
        val type = event.getToolType(event.actionIndex)
        val penDown = (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) &&
            (type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER)
        if (!penOwnsStream && !penDown && (fingerActive || type == MotionEvent.TOOL_TYPE_FINGER)) {
            val fingers = (0 until event.pointerCount).filter {
                event.getToolType(it) == MotionEvent.TOOL_TYPE_FINGER &&
                    !(action == MotionEvent.ACTION_POINTER_UP && it == event.actionIndex)
            }
            if (action == MotionEvent.ACTION_DOWN) {
                fingerActive = true; fingerX = event.x; fingerY = event.y; fingerSpan = 0f
                fingerDownX = event.x; fingerDownY = event.y
                fingerRawX = event.rawX; fingerRawY = event.rawY
                fingerMoved = false
                if (!fingerScrollsParent) parent?.requestDisallowInterceptTouchEvent(true)
                postDelayed(fingerHold, 500)
                return true
            }
            if (action == MotionEvent.ACTION_MOVE && fingers.isNotEmpty()) {
                if (kotlin.math.hypot(event.x - fingerDownX, event.y - fingerDownY) > touchSlop) {
                    fingerMoved = true
                    lastFingerTapMs = 0L
                    removeCallbacks(fingerHold)
                }
                val x = fingers.map { event.getX(it) }.average().toFloat()
                val y = fingers.map { event.getY(it) }.average().toFloat()
                val span = if (fingers.size >= 2) kotlin.math.hypot(event.getX(fingers[0])-event.getX(fingers[1]),event.getY(fingers[0])-event.getY(fingers[1])) else 0f
                val rawX = fingers.map { event.getRawX(it) }.average().toFloat()
                val rawY = fingers.map { event.getRawY(it) }.average().toFloat()
                if (fingerActive && (!fingerScrollsParent || pinchOwnsStream)) {
                    val factor = if (span > 0 && fingerSpan > 0) span/fingerSpan else 1f
                    val transform = onFingerTransform
                    if (transform == null) onFingerGesture(x-fingerX,y-fingerY,factor)
                    else {
                        val dx = rawX-fingerRawX; val dy = rawY-fingerRawY
                        transform(InkFingerTransform(dx, dy, factor, x-dx, y-dy))
                    }
                }
                fingerX = x; fingerY = y; fingerSpan = span
                fingerRawX = rawX; fingerRawY = rawY
                return true
            }
            if (action == MotionEvent.ACTION_POINTER_DOWN) {
                removeCallbacks(fingerHold)
                fingerMoved = true
                lastFingerTapMs = 0L
                if (fingers.size < 2) return true
                pinchOwnsStream = true
                parent?.requestDisallowInterceptTouchEvent(true)
                fingerX = fingers.map { event.getX(it) }.average().toFloat()
                fingerY = fingers.map { event.getY(it) }.average().toFloat()
                fingerRawX = fingers.map { event.getRawX(it) }.average().toFloat()
                fingerRawY = fingers.map { event.getRawY(it) }.average().toFloat()
                fingerSpan = if (fingers.size >= 2) kotlin.math.hypot(event.getX(fingers[0])-event.getX(fingers[1]),event.getY(fingers[0])-event.getY(fingers[1])) else 0f
                return true
            }
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
                removeCallbacks(fingerHold)
                if (action == MotionEvent.ACTION_UP &&
                    !fingerMoved &&
                    event.eventTime - event.downTime < 300 &&
                    kotlin.math.hypot(event.x - fingerDownX, event.y - fingerDownY) < 20f) {
                    if (event.eventTime - lastFingerTapMs < 320) {
                        onFingerDoubleTap()
                        lastFingerTapMs = 0L
                    } else {
                        lastFingerTapMs = event.eventTime
                    }
                }
                if (action == MotionEvent.ACTION_UP) {
                    fingerActive = false; pinchOwnsStream = false
                    parent?.requestDisallowInterceptTouchEvent(false)
                } else {
                    // Rebase after pointer removal; never pan by the old two-finger centroid.
                    fingerX = fingers.map { event.getX(it) }.average().toFloat()
                    fingerY = fingers.map { event.getY(it) }.average().toFloat()
                    fingerRawX = fingers.map { event.getRawX(it) }.average().toFloat()
                    fingerRawY = fingers.map { event.getRawY(it) }.average().toFloat()
                    fingerSpan = if (fingers.size >= 2) kotlin.math.hypot(event.getX(fingers[0])-event.getX(fingers[1]),event.getY(fingers[0])-event.getY(fingers[1])) else 0f
                }
                return true
            }
        }
        if (action == MotionEvent.ACTION_POINTER_DOWN && pointerId >= 0) return true // ignore incidental palm contact
        if (penDown && !penOwnsStream) {
            val index = event.actionIndex
            removeCallbacks(fingerHold)
            fingerActive = false; pinchOwnsStream = false
            penOwnsStream = true
            parent?.requestDisallowInterceptTouchEvent(true)
            view.requestUnbufferedDispatch(event)
            predictor.record(event)
            pointerId = event.getPointerId(index)
            onWritingStateChanged(true)
            gestureTool = if (button.update(true, event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY != 0, type == MotionEvent.TOOL_TYPE_ERASER)) InkTool.Eraser else tool.active
            gestureEraser = if (gestureTool == InkTool.Eraser && tool.active != InkTool.Eraser) tool.buttonEraserMode else tool.eraserMode
            gestureColor = tool.color
            gestureWidth = tool.widthFor(gestureTool)
            gestureShape = tool.shapeMode
            path.clear(); tilts.clear(); collect(event, index)
            heldSnapped = false
            if (gestureTool == InkTool.Lasso) {
                val p = path.first()
                val b = state.selection().bounds()
                val corners = if (b == null) emptyList() else listOf(b.left to b.top,b.right to b.top,b.right to b.bottom,b.left to b.bottom)
                resizeCorner = corners.indexOfFirst { (x,y) -> kotlin.math.abs(p.x-x) < .025f && kotlin.math.abs(p.y-y) < .025f }
                val within = b != null && p.x in b.left..b.right && p.y in b.top..b.bottom
                selectionStart = if (within || resizeCorner >= 0) p else null
                selectionBounds = b
            } else if (gestureTool != InkTool.Eraser && gestureTool != InkTool.TextSelection) {
                wetId = wet.startStroke(event, pointerId, inkBrush(brushName(gestureTool), gestureColor, gestureWidth * width))
            }
            postDelayed(hold, 500)
            return true
        }
        if (pointerId < 0) {
            if (penOwnsStream && action == MotionEvent.ACTION_UP) {
                penOwnsStream = false
                parent?.requestDisallowInterceptTouchEvent(false)
                return true
            }
            return penOwnsStream
        }
        val index = event.findPointerIndex(pointerId)
        if (index < 0) { cancel(event); return true }
        when (action) {
            MotionEvent.ACTION_MOVE -> {
                predictor.record(event)
                collect(event, index)
                wetId?.let { id ->
                    val predicted = predictor.predict()
                    try { wet.addToStroke(event, pointerId, id, predicted) } finally { predicted?.recycle() }
                }
                if (gestureTool == InkTool.Lasso || gestureTool == InkTool.Eraser) dry.transient = path.toList()
                removeCallbacks(hold); postDelayed(hold, 500)
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                if (event.getPointerId(event.actionIndex) != pointerId) return true
                predictor.record(event)
                collect(event, index)
                removeCallbacks(hold)
                wetId?.let { wet.finishStroke(event, pointerId, it) }
                wetId = null; pointerId = -1
                onWritingStateChanged(false)
                finishGesture()
                dry.transient = emptyList()
                if (action == MotionEvent.ACTION_UP) {
                    penOwnsStream = false
                    parent?.requestDisallowInterceptTouchEvent(false)
                }
                return true
            }
        }
        return true
    }

    private fun finishGesture() {
        if (path.isEmpty()) return
        when (gestureTool) {
            InkTool.Eraser -> state.apply(eraseStrokes(state.strokes, path, gestureWidth / 2, gestureEraser))
            InkTool.TextSelection -> onTextSelection(path.first(), path.last())
            InkTool.Lasso -> {
                val start = selectionStart
                if (start != null && selectionBounds != null) {
                    val end = path.last()
                    val dx = end.x-start.x; val dy = end.y-start.y
                    if (resizeCorner >= 0) {
                        val b = selectionBounds!!
                        val sx = (b.width + if (resizeCorner == 0 || resizeCorner == 3) -dx else dx).coerceAtLeast(.005f)/b.width.coerceAtLeast(.005f)
                        val sy = (b.height + if (resizeCorner == 0 || resizeCorner == 1) -dy else dy).coerceAtLeast(.005f)/b.height.coerceAtLeast(.005f)
                        state.transformSelection(if (resizeCorner == 0 || resizeCorner == 3) dx else 0f,
                            if (resizeCorner == 0 || resizeCorner == 1) dy else 0f,sx,sy)
                    } else state.transformSelection(dx,dy)
                } else {
                    state.select(lassoSelect(state.strokes,path))
                    state.selection().bounds()?.let { onAsk(state.selection(), it) }
                }
            }
            else -> {
                var points = path.toList()
                var shape: InkShape? = null
                if (gestureTool == InkTool.Shape) {
                    val recognized = explicitShape(points.first(), points.last(), gestureShape)
                    points = recognized.points; shape = InkShape(recognized.type)
                } else if (heldSnapped) {
                    recognizeShape(points)?.let { points = it.points; shape = InkShape(it.type) }
                }
                if (gestureTool == InkTool.Highlighter) points = straightenHighlighter(points)
                if (points.size == 1) points = points + points.first().copy(x = (points.first().x+.0001f).coerceAtMost(1f), tMillis = points.first().tMillis + 1)
                val stroke = InkStroke(paperKey = paperKey, page = page, deviceId = deviceId,
                    updatedAt = Instant.now().toString(), tool = if (gestureTool == InkTool.Highlighter) "highlighter" else "pen",
                    color = gestureColor, width = gestureWidth, points = points,
                    brush = brushName(gestureTool), shape = shape, tilt = tilts.toList().takeIf { it.size == points.size })
                state.apply(state.strokes + stroke)
            }
        }
        path.clear(); tilts.clear()
    }
}

private class DryInkView(context: Context) : View(context) {
    private val renderer = CanvasStrokeRenderer.create()
    private var highlights: Bitmap? = null
    private var ink: Bitmap? = null
    private var current = emptyList<InkStroke>()
    private var selected = emptySet<String>()
    var transient: List<InkPoint> = emptyList()
        set(value) { field = value; invalidate() }
    private val overlayPaint = Paint(3).apply { color = Color.rgb(162,54,42); strokeWidth = 2f; style = Paint.Style.STROKE }
    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w,h,oldw,oldh); rebuild() }
    fun sync(strokes: List<InkStroke>, selectedIds: Set<String>) {
        if (current != strokes) {
            val old = current; current = strokes
            val target = strokes.lastOrNull()?.let { if (it.brush == "highlighter") highlights else ink }
            if (strokes.size == old.size + 1 && strokes.dropLast(1) == old && target != null) {
                val stroke = strokes.last()
                drawCached(target, stroke)
                dirty(stroke)
            } else rebuild()
        }
        if (selected != selectedIds) { selected = selectedIds; invalidate() }
    }
    private fun dirty(stroke: InkStroke) {
        val b = listOf(stroke).bounds() ?: return
        val extra = stroke.width * width + 8
        invalidate((b.left*width-extra).toInt(),(b.top*height-extra).toInt(),(b.right*width+extra).toInt(),(b.bottom*height+extra).toInt())
    }
    private fun rebuild() {
        if (width <= 0 || height <= 0) return
        highlights?.recycle(); ink?.recycle()
        highlights = null; ink = null
        val visible = current.filterNot { it.deleted || it.points.isEmpty() }
        if (visible.isNotEmpty()) {
            // Only derived display caches are bounded. Input and saved normalized vectors retain precision.
            val scale = minOf(1.0, kotlin.math.sqrt(4_194_304.0 / (width.toDouble() * height)), 4096.0 / max(width, height))
            val cacheWidth = (width * scale).toInt().coerceAtLeast(1); val cacheHeight = (height * scale).toInt().coerceAtLeast(1)
            if (visible.any { it.brush == "highlighter" }) highlights = Bitmap.createBitmap(cacheWidth, cacheHeight, Bitmap.Config.ARGB_8888)
            if (visible.any { it.brush != "highlighter" }) ink = Bitmap.createBitmap(cacheWidth, cacheHeight, Bitmap.Config.ARGB_8888)
            visible.forEach { drawCached(if (it.brush == "highlighter") highlights!! else ink!!, it) }
        }
        invalidate()
    }
    private fun drawCached(bitmap: Bitmap, stroke: InkStroke) {
        val canvas = Canvas(bitmap)
        canvas.scale(bitmap.width.toFloat() / width, bitmap.height.toFloat() / height)
        drawStroke(canvas, stroke)
    }
    override fun onDetachedFromWindow() {
        highlights?.recycle(); ink?.recycle(); highlights = null; ink = null
        super.onDetachedFromWindow()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (current.isNotEmpty()) rebuild() }
    private fun drawStroke(canvas: Canvas, s: InkStroke) {
        if (s.points.isEmpty() || s.deleted) return
        val batch = MutableStrokeInputBatch()
        val startTime = s.points.first().tMillis
        var lastTime = -1L
        s.points.forEachIndexed { index, p ->
            val time = max(p.tMillis-startTime, lastTime+1)
            lastTime = time
            batch.add(InputToolType.STYLUS, p.x*width, p.y*height, time,
                0f, p.pressure, s.tilt?.getOrNull(index) ?: androidx.ink.strokes.StrokeInput.NO_TILT,
                androidx.ink.strokes.StrokeInput.NO_ORIENTATION)
        }
        val stroke = Stroke(inkBrush(s.brush, s.color, s.width*width),batch)
        renderer.draw(canvas, stroke, Matrix())
        if (s.brush == "pencil") {
            val color = try { Color.parseColor(s.color) } catch (_: Exception) { Color.BLACK }
            val grain = Paint(3).apply { this.color = color; style = Paint.Style.FILL }
            s.points.zipWithNext().forEachIndexed { segment, (a,b) ->
                val steps = max(1,(kotlin.math.hypot((b.x-a.x)*width,(b.y-a.y)*height)/2f).toInt())
                for (i in 0..steps) {
                    val t = i.toFloat()/steps
                    val seed = segment*7919+i*104729
                    val jitter = ((seed*1103515245+12345).ushr(16) % 1000)/1000f-.5f
                    val pressure = a.pressure+(b.pressure-a.pressure)*t
                    grain.alpha = (25+pressure*85).toInt()
                    val x = (a.x+(b.x-a.x)*t)*width
                    val y = (a.y+(b.y-a.y)*t)*height
                    canvas.drawCircle(x+jitter*s.width*width*.4f,y-jitter*s.width*width*.4f,
                        max(.25f,s.width*width*.12f),grain)
                }
            }
        }
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val bounds = Rect(0, 0, width, height)
        highlights?.let { canvas.drawBitmap(it, null, bounds, bitmapPaint) }
        ink?.let { canvas.drawBitmap(it, null, bounds, bitmapPaint) }
        if (selected.isNotEmpty()) current.filter { it.id in selected }.bounds()?.let { b ->
            canvas.drawRect(b.left*width,b.top*height,b.right*width,b.bottom*height,overlayPaint)
            canvas.drawCircle(b.left*width,b.top*height,8f,overlayPaint)
            canvas.drawCircle(b.right*width,b.top*height,8f,overlayPaint)
            canvas.drawCircle(b.right*width,b.bottom*height,8f,overlayPaint)
            canvas.drawCircle(b.left*width,b.bottom*height,8f,overlayPaint)
        }
        if (transient.size > 1) {
            val path = Path().apply { moveTo(transient[0].x*width, transient[0].y*height); transient.drop(1).forEach { lineTo(it.x*width,it.y*height) } }
            canvas.drawPath(path,overlayPaint)
        }
    }
}
