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
import androidx.compose.ui.geometry.Offset
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

/** Overlay the visible portion of a PDF page; pageSize/origin use full rendered-page pixels. */
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
    onFingerTap: (Float, Float) -> Unit = { _, _ -> },
    regionMode: Boolean = false,
    onSelectionProgress: (InkPoint, InkPoint, Boolean) -> Unit = { _, _, _ -> },
    onSelectionCanceled: () -> Unit = {},
    onWritingStateChanged: (Boolean) -> Unit = {},
    paperKey: String = "demo",
    page: Int = 1,
    deviceId: String = "android",
    fingerScrollsParent: Boolean = false,
    onFingerTransform: ((InkFingerTransform) -> Unit)? = null,
    nativeInkRouting: Boolean = false,
    nativeViewportInWindow: android.graphics.Rect? = null,
    pageOrigin: Offset = Offset.Zero,
    visible: Boolean = true,
) {
    DisposableEffect(state, onStrokesChanged) {
        state.onChange = onStrokesChanged
        onDispose { state.onChange = null }
    }
    // Preserve the state change listener while offscreen, but release both native views.
    if (visible) key(state, paperKey, page, deviceId) {
        AndroidView(
            factory = { context -> InkSurface(context, state, tool, onSelectionAsk, onFingerGesture, onFingerLongPress, onFingerDoubleTap, onWritingStateChanged, paperKey, page, deviceId) },
            update = { surface ->
                surface.regionMode = regionMode
                surface.onSelectionProgress = onSelectionProgress
                surface.onSelectionCanceled = onSelectionCanceled
                surface.onFingerTap = onFingerTap
                surface.tool = tool
                surface.onAsk = onSelectionAsk
                surface.onFingerGesture = onFingerGesture
                surface.onFingerLongPress = onFingerLongPress
                surface.onFingerDoubleTap = onFingerDoubleTap
                surface.onWritingStateChanged = onWritingStateChanged
                surface.fingerScrollsParent = fingerScrollsParent
                surface.onFingerTransform = onFingerTransform
                surface.setPageGeometry(pageSize, pageOrigin)
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
    var regionMode = false
    var onSelectionProgress: (InkPoint, InkPoint, Boolean) -> Unit = { _, _, _ -> }
    var onFingerTap: (Float, Float) -> Unit = { _, _ -> }
    private var selectingFinger = false
    private var selectingRegion = false
    private var fingerStart: InkPoint? = null
    private var tapX = 0f
    private var tapY = 0f
    private val confirmedTap = Runnable { onFingerTap(tapX, tapY) }
    private var pageSize: Size = Size.Zero
    private var pageOrigin = Offset.Zero
    private val pageWidth get() = pageSize.width.takeIf { it > 0 } ?: width.toFloat().coerceAtLeast(1f)
    private val pageHeight get() = pageSize.height.takeIf { it > 0 } ?: height.toFloat().coerceAtLeast(1f)

    fun setPageGeometry(size: Size, origin: Offset) {
        pageSize = size; pageOrigin = origin
        dry.setPageGeometry(size, origin)
    }
    var fingerScrollsParent = false
    var nativeInkRouting = false
    var nativeViewportInWindow: android.graphics.Rect? = null
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
    private var eraseBounds = emptyMap<String, InkBounds>()
    private var lastEraseIndex = 0
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
    private var movingSelectionByFinger = false
    private var fingerMoved = false
    private val touchSlop = android.view.ViewConfiguration.get(context).scaledTouchSlop
    private val fingerHold = Runnable {
        if (!fingerActive || fingerMoved || penOwnsStream) return@Runnable
        fingerMoved = true
        val start = fingerStart!!
        val bounds = state.selection().bounds()
        if (bounds != null && start.x in bounds.left..bounds.right && start.y in bounds.top..bounds.bottom) {
            movingSelectionByFinger = true
            selectionStart = start; selectionBounds = bounds; resizeCorner = -1
            state.beginGesture()
            dry.preview = state.strokes.filter { it.id in state.selectedIds }
            parent?.requestDisallowInterceptTouchEvent(true)
            lastFingerTapMs = 0L; removeCallbacks(confirmedTap)
            return@Runnable
        }
        selectingFinger = true
        onSelectionProgress(fingerStart!!, fingerStart!!, false)
        parent?.requestDisallowInterceptTouchEvent(true)
        lastFingerTapMs = 0L
        removeCallbacks(confirmedTap)
        onFingerLongPress(
            ((fingerDownX + pageOrigin.x) / pageWidth).coerceIn(0f, 1f),
            ((fingerDownY + pageOrigin.y) / pageHeight).coerceIn(0f, 1f),
        )
    }
    private val hold = Runnable {
        if (gestureTool !in listOf(InkTool.Eraser, InkTool.Lasso, InkTool.Shape) &&
            path.size >= 4 && android.os.SystemClock.uptimeMillis() - lastMotion >= 480 &&
            recognizeShape(path) != null) {
            heldSnapped = true
            dry.shapeColor = gestureColor; dry.shapeWidth = gestureWidth
            dry.shapeAlpha = if (gestureTool == InkTool.Highlighter) 0x70 else if (gestureTool == InkTool.Pencil) 0xa8 else 255
            wetId?.let { id ->
                val now = android.os.SystemClock.uptimeMillis()
                val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
                try { wet.cancelStroke(id, event) } finally { event.recycle() }
            }
            wetId = null
            dry.shapePreview = recognizeShape(path)?.points.orEmpty()
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
        wet.setOnHoverListener { view, event -> handle(view, event) }
        wet.eagerInit()
    }

    fun sync(strokes: List<InkStroke>, selectedIds: Set<String>) {
        if (state.gestureInProgress && selectionStart != null) dry.preview = strokes.filter { it.id in selectedIds }
        else { dry.preview = null; dry.sync(strokes, selectedIds) }
    }
    private fun previewSelection(end: InkPoint) {
        val start = selectionStart ?: return
        val b = selectionBounds ?: return
        val dx = end.x - start.x; val dy = end.y - start.y
        if (resizeCorner >= 0) {
            val left = resizeCorner == 0 || resizeCorner == 3
            val top = resizeCorner == 0 || resizeCorner == 1
            val sx = (b.width + if (left) -dx else dx).coerceAtLeast(.005f) / b.width.coerceAtLeast(.005f)
            val sy = (b.height + if (top) -dy else dy).coerceAtLeast(.005f) / b.height.coerceAtLeast(.005f)
            state.previewSelectionTransform(if (left) dx else 0f, if (top) dy else 0f, sx, sy)
        } else state.previewSelectionTransform(dx, dy)
        dry.preview = state.selection()
    }

    private fun point(event: MotionEvent, index: Int, historical: Int = -1): InkPoint {
        val w = pageWidth
        val h = pageHeight
        val x = if (historical < 0) event.getX(index) else event.getHistoricalX(index, historical)
        val y = if (historical < 0) event.getY(index) else event.getHistoricalY(index, historical)
        val pressure = if (historical < 0) event.getPressure(index) else event.getHistoricalPressure(index, historical)
        val time = if (historical < 0) event.eventTime else event.getHistoricalEventTime(historical)
        return InkPoint(((x + pageOrigin.x) / w).coerceIn(0f, 1f), ((y + pageOrigin.y) / h).coerceIn(0f, 1f), pressure.coerceIn(0f, 1f), time)
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
        readerInputHost()?.register(this, { nativeInkRouting }, { event -> handle(wet, event) }, { nativeViewportInWindow })
    }
    override fun onDetachedFromWindow() {
        readerInputHost()?.unregister(this)
        val now = android.os.SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
        try { cancel(event) } finally { event.recycle() }
        super.onDetachedFromWindow()
    }

    private fun cancel(event: MotionEvent, releaseStream: Boolean = true) {
        state.finishGesture(false)
        movingSelectionByFinger = false; selectionStart = null; selectionBounds = null
        dry.preview = null; dry.shapePreview = emptyList()
        dry.sync(state.strokes, state.selectedIds)
        dry.eraserCursor = null
        if (selectingFinger || selectingRegion) onSelectionCanceled()
        selectingFinger = false; selectingRegion = false
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
    var onSelectionCanceled: () -> Unit = {}
    private fun eraseLive() {
        val cursor = path.lastOrNull() ?: return
        dry.eraserCursor = cursor to eraserRadiusPx(gestureWidth, pageWidth)
        state.previewGesture(eraseStrokesOnPage(state.strokes, path.subList((lastEraseIndex - 1).coerceAtLeast(0), path.size), gestureWidth,
            pageWidth, pageHeight, gestureEraser, eraseBounds))
        lastEraseIndex = path.size
        dry.sync(state.strokes, state.selectedIds)
    }
    private fun handle(view: View, event: MotionEvent): Boolean {
        val action = event.actionMasked
        if (action in listOf(MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE, MotionEvent.ACTION_HOVER_EXIT)) {
            val erasing = tool.active == InkTool.Eraser || event.getToolType(0) == MotionEvent.TOOL_TYPE_ERASER ||
                event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY != 0
            dry.eraserCursor = if (erasing && action != MotionEvent.ACTION_HOVER_EXIT)
                point(event, 0) to eraserRadiusPx(tool.widthFor(InkTool.Eraser), pageWidth) else null
            return true
        }
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
                selectingFinger = regionMode
                selectingRegion = regionMode
                if (regionMode) fingerMoved = true
                fingerStart = point(event, 0)
                if (regionMode) {
                    parent?.requestDisallowInterceptTouchEvent(true)
                    onSelectionProgress(fingerStart!!, fingerStart!!, false)
                }
                if (!fingerScrollsParent) parent?.requestDisallowInterceptTouchEvent(true)
                if (!regionMode) postDelayed(fingerHold, 400)
                return true
            }
            if (action == MotionEvent.ACTION_MOVE && fingers.isNotEmpty()) {
                if (movingSelectionByFinger && fingers.size == 1) {
                    previewSelection(point(event, fingers.first()))
                    return true
                }
                if (selectingFinger && fingers.size == 1) {
                    onSelectionProgress(fingerStart!!, point(event, fingers.first()), false)
                    return true
                }
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
                        transform(InkFingerTransform(dx, dy, factor, x-dx+pageOrigin.x, y-dy+pageOrigin.y))
                    }
                }
                fingerX = x; fingerY = y; fingerSpan = span
                fingerRawX = rawX; fingerRawY = rawY
                return true
            }
            if (action == MotionEvent.ACTION_POINTER_DOWN) {
                if (movingSelectionByFinger) {
                    state.finishGesture(false); movingSelectionByFinger = false; selectionStart = null
                    dry.preview = null; dry.sync(state.strokes, state.selectedIds)
                }
                if (selectingFinger) onSelectionCanceled()
                selectingFinger = false; selectingRegion = false
                removeCallbacks(confirmedTap)
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
                if (action == MotionEvent.ACTION_UP && movingSelectionByFinger) {
                    previewSelection(point(event, 0)); state.finishGesture(true)
                    movingSelectionByFinger = false; selectionStart = null; selectionBounds = null
                    dry.preview = null; dry.sync(state.strokes, state.selectedIds)
                }
                if (action == MotionEvent.ACTION_UP && selectingFinger) {
                    onSelectionProgress(fingerStart!!, point(event, 0), true)
                    selectingFinger = false; selectingRegion = false
                }
                if (action == MotionEvent.ACTION_UP &&
                    !fingerMoved &&
                    event.eventTime - event.downTime < 300 &&
                    kotlin.math.hypot(event.x - fingerDownX, event.y - fingerDownY) < 20f) {
                    if (event.eventTime - lastFingerTapMs < 320) {
                        removeCallbacks(confirmedTap)
                        onFingerDoubleTap()
                        lastFingerTapMs = 0L
                    } else {
                        lastFingerTapMs = event.eventTime
                        tapX = point(event, 0).x; tapY = point(event, 0).y
                        postDelayed(confirmedTap, 320)
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
            selectingRegion = regionMode
            gestureTool = if (button.update(true, event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY != 0, type == MotionEvent.TOOL_TYPE_ERASER)) InkTool.Eraser else tool.active
            gestureEraser = if (gestureTool == InkTool.Eraser && tool.active != InkTool.Eraser) tool.buttonEraserMode else tool.eraserMode
            gestureColor = tool.color
            gestureWidth = tool.widthFor(gestureTool)
            gestureShape = tool.shapeMode
            path.clear(); tilts.clear(); collect(event, index)
            heldSnapped = false
            selectionStart = null; selectionBounds = null; resizeCorner = -1
            state.beginGesture()
            if (selectingRegion && gestureTool != InkTool.Eraser) {
                onSelectionProgress(path.first(), path.last(), false)
            } else if (gestureTool == InkTool.Eraser) {
                selectingRegion = false
                eraseBounds = state.strokes.mapNotNull { s -> listOf(s).bounds()?.let { s.id to it } }.toMap()
                lastEraseIndex = 0; eraseLive()
            } else if (gestureTool == InkTool.Lasso) {
                val p = path.first()
                val b = state.selection().bounds()
                val corners = if (b == null) emptyList() else listOf(b.left to b.top,b.right to b.top,b.right to b.bottom,b.left to b.bottom)
                resizeCorner = corners.indexOfFirst { (x,y) -> kotlin.math.abs(p.x-x) < .025f && kotlin.math.abs(p.y-y) < .025f }
                val within = b != null && p.x in b.left..b.right && p.y in b.top..b.bottom
                selectionStart = if (within || resizeCorner >= 0) p else null
                selectionBounds = b
                if (selectionStart != null) dry.preview = state.selection()
            } else if (gestureTool == InkTool.Shape) {
                dry.shapeColor = gestureColor; dry.shapeWidth = gestureWidth; dry.shapeAlpha = 255
                dry.shapePreview = explicitShape(path.first(), path.last(), gestureShape).points
            } else if (gestureTool != InkTool.Eraser) {
                wetId = wet.startStroke(event, pointerId, inkBrush(brushName(gestureTool), gestureColor, gestureWidth * pageWidth))
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
                if (selectingRegion) onSelectionProgress(path.first(), path.last(), false)
                else if (gestureTool == InkTool.Eraser) eraseLive()
                else if (gestureTool == InkTool.Lasso) {
                    if (selectionStart != null) previewSelection(path.last()) else dry.transient = path.toList()
                } else if (gestureTool == InkTool.Shape) dry.shapePreview = explicitShape(path.first(), path.last(), gestureShape).points
                else if (heldSnapped) dry.shapePreview = recognizeShape(path)?.points.orEmpty()
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
                dry.transient = emptyList(); dry.shapePreview = emptyList()
                selectionStart = null; selectionBounds = null
                dry.preview = null; dry.sync(state.strokes, state.selectedIds)
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
        if (selectingRegion) {
            onSelectionProgress(path.first(), path.last(), true)
            selectingRegion = false; state.finishGesture(false); path.clear(); tilts.clear(); return
        }
        when (gestureTool) {
            InkTool.Eraser -> { eraseLive(); state.finishGesture(true); dry.eraserCursor = null }
            InkTool.Lasso -> {
                val start = selectionStart
                if (start != null && selectionBounds != null) {
                    previewSelection(path.last())
                    state.finishGesture(true)
                } else {
                    state.finishGesture(false)
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
                state.previewGesture(state.strokes + stroke)
                state.finishGesture(true)
            }
        }
        path.clear(); tilts.clear()
    }
}

private class DryInkView(context: Context) : View(context) {
    private var pageSize = Size.Zero
    private var pageOrigin = Offset.Zero
    private val pageWidth get() = pageSize.width.takeIf { it > 0 } ?: width.toFloat().coerceAtLeast(1f)
    private val pageHeight get() = pageSize.height.takeIf { it > 0 } ?: height.toFloat().coerceAtLeast(1f)
    fun setPageGeometry(size: Size, origin: Offset) {
        if (pageSize == size && pageOrigin == origin) return
        pageSize = size; pageOrigin = origin; rebuild()
    }
    private val renderer = CanvasStrokeRenderer.create()
    private var highlights: Bitmap? = null
    private var ink: Bitmap? = null
    private var current = emptyList<InkStroke>()
    private var selected = emptySet<String>()
    var eraserCursor: Pair<InkPoint, Float>? = null
        set(value) { field = value; invalidate() }
    var transient: List<InkPoint> = emptyList()
        set(value) { field = value; invalidate() }
    var shapeColor = "#1C1B19"
    var shapeWidth = .003f
    var shapeAlpha = 255
    var shapePreview: List<InkPoint> = emptyList()
        set(value) { field = value; invalidate() }
    var preview: List<InkStroke>? = null
        set(value) { val toggled = (field == null) != (value == null); field = value; if (toggled) rebuild() else invalidate() }
    private val overlayPaint = Paint(3).apply { color = Color.rgb(162,54,42); strokeWidth = 2f; style = Paint.Style.STROKE }
    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w,h,oldw,oldh); rebuild() }
    fun sync(strokes: List<InkStroke>, selectedIds: Set<String>) {
        if (current != strokes) {
            val old = current; current = strokes
            val samePrefix = old.size <= strokes.size && old.indices.all { old[it].sameDrawing(strokes[it]) }
            val target = strokes.lastOrNull()?.let { if (it.brush == "highlighter") highlights else ink }
            if (strokes.size == old.size && samePrefix) {
                // Only rev/updatedAt changed in a sync receipt; the pixels are already current.
            } else if (strokes.size == old.size + 1 && samePrefix && target != null) {
                val stroke = strokes.last()
                drawCached(target, stroke)
                dirty(stroke)
            } else rebuild()
        }
        if (selected != selectedIds) { selected = selectedIds; invalidate() }
    }
    private fun dirty(stroke: InkStroke) {
        val b = listOf(stroke).bounds() ?: return
        val extra = stroke.width * pageWidth + 8
        invalidate((b.left*pageWidth-pageOrigin.x-extra).toInt(),(b.top*pageHeight-pageOrigin.y-extra).toInt(),(b.right*pageWidth-pageOrigin.x+extra).toInt(),(b.bottom*pageHeight-pageOrigin.y+extra).toInt())
    }
    private fun rebuild() {
        if (width <= 0 || height <= 0) return
        // Never recycle: RenderThread can still be drawing a recorded frame that references the old cache.
        highlights = null; ink = null
        val visible = current.filterNot { it.deleted || it.points.isEmpty() || (preview != null && it.id in selected) }
        if (visible.isNotEmpty()) {
            // Only derived display caches are bounded. Input and saved normalized vectors retain precision.
            val scale = minOf(1.0, kotlin.math.sqrt(((context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager).memoryClass.toDouble() * 1024 * 1024 / 384).coerceAtMost(1_048_576.0) / (width.toDouble() * height)), 4096.0 / max(width, height))
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
        canvas.translate(-pageOrigin.x, -pageOrigin.y)
        drawStroke(canvas, stroke)
    }
    override fun onDetachedFromWindow() {
        highlights = null; ink = null
        super.onDetachedFromWindow()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (current.isNotEmpty()) rebuild() }
    private fun drawStroke(canvas: Canvas, s: InkStroke) {
        if (s.points.isEmpty() || s.deleted) return
        if (s.shape != null) {
            val path = Path().apply { moveTo(s.points[0].x * pageWidth, s.points[0].y * pageHeight); s.points.drop(1).forEach { lineTo(it.x * pageWidth, it.y * pageHeight) } }
            val paint = Paint(3).apply { color = Color.parseColor(s.color); alpha = if (s.brush == "highlighter") 0x70 else if (s.brush == "pencil") 0xa8 else 255; strokeWidth = max(.5f, s.width * pageWidth); style = Paint.Style.STROKE; strokeJoin = Paint.Join.MITER; strokeCap = Paint.Cap.ROUND }
            canvas.drawPath(path, paint)
            return
        }
        val batch = MutableStrokeInputBatch()
        val startTime = s.points.first().tMillis
        var lastTime = -1L
        s.points.forEachIndexed { index, p ->
            val time = max(p.tMillis-startTime, lastTime+1)
            lastTime = time
            batch.add(InputToolType.STYLUS, p.x*pageWidth, p.y*pageHeight, time,
                0f, p.pressure, s.tilt?.getOrNull(index) ?: androidx.ink.strokes.StrokeInput.NO_TILT,
                androidx.ink.strokes.StrokeInput.NO_ORIENTATION)
        }
        val stroke = Stroke(inkBrush(s.brush, s.color, s.width*pageWidth),batch)
        renderer.draw(canvas, stroke, Matrix())
        if (s.brush == "pencil") {
            val color = try { Color.parseColor(s.color) } catch (_: Exception) { Color.BLACK }
            val grain = Paint(3).apply { this.color = color; style = Paint.Style.FILL }
            s.points.zipWithNext().forEachIndexed { segment, (a,b) ->
                val steps = max(1,(kotlin.math.hypot((b.x-a.x)*pageWidth,(b.y-a.y)*pageHeight)/2f).toInt())
                for (i in 0..steps) {
                    val t = i.toFloat()/steps
                    val seed = segment*7919+i*104729
                    val jitter = ((seed*1103515245+12345).ushr(16) % 1000)/1000f-.5f
                    val pressure = a.pressure+(b.pressure-a.pressure)*t
                    grain.alpha = (25+pressure*85).toInt()
                    val x = (a.x+(b.x-a.x)*t)*pageWidth
                    val y = (a.y+(b.y-a.y)*t)*pageHeight
                    canvas.drawCircle(x+jitter*s.width*pageWidth*.4f,y-jitter*s.width*pageWidth*.4f,
                        max(.25f,s.width*pageWidth*.12f),grain)
                }
            }
        }
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val bounds = Rect(0, 0, width, height)
        highlights?.let { canvas.drawBitmap(it, null, bounds, bitmapPaint) }
        ink?.let { canvas.drawBitmap(it, null, bounds, bitmapPaint) }
        canvas.save()
        canvas.translate(-pageOrigin.x, -pageOrigin.y)
        preview?.forEach { drawStroke(canvas, it) }
        if (shapePreview.size > 1) {
            val shapePath = Path().apply { moveTo(shapePreview[0].x * pageWidth, shapePreview[0].y * pageHeight); shapePreview.drop(1).forEach { lineTo(it.x * pageWidth, it.y * pageHeight) } }
            val paint = Paint(3).apply { color = Color.parseColor(shapeColor); alpha = shapeAlpha; strokeWidth = max(.5f, shapeWidth * pageWidth); style = Paint.Style.STROKE; strokeJoin = Paint.Join.MITER; strokeCap = Paint.Cap.ROUND }
            canvas.drawPath(shapePath, paint)
        }
        if (selected.isNotEmpty()) (preview ?: current.filter { it.id in selected }).bounds()?.let { b ->
            canvas.drawRect(b.left*pageWidth,b.top*pageHeight,b.right*pageWidth,b.bottom*pageHeight,overlayPaint)
            canvas.drawCircle(b.left*pageWidth,b.top*pageHeight,8f,overlayPaint)
            canvas.drawCircle(b.right*pageWidth,b.top*pageHeight,8f,overlayPaint)
            canvas.drawCircle(b.right*pageWidth,b.bottom*pageHeight,8f,overlayPaint)
            canvas.drawCircle(b.left*pageWidth,b.bottom*pageHeight,8f,overlayPaint)
        }
        eraserCursor?.let { (point, radius) -> canvas.drawCircle(point.x * pageWidth, point.y * pageHeight, radius, overlayPaint) }
        if (transient.size > 1) {
            val path = Path().apply { moveTo(transient[0].x*pageWidth, transient[0].y*pageHeight); transient.drop(1).forEach { lineTo(it.x*pageWidth,it.y*pageHeight) } }
            canvas.drawPath(path,overlayPaint)
        }
        canvas.restore()
    }
}
