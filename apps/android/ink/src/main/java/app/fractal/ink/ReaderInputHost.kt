package app.fractal.ink

import android.content.Context
import android.graphics.Matrix
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout

/** Scoped original ink routing before Compose's mixed-tool converter. Fingers and controls
 * retain child dispatch; genuine cancellation always discards the partial stroke. */
class ReaderInputHost(context: Context) : FrameLayout(context) {
    private data class Target(val view: View, val accepts: (MotionEvent) -> Boolean,
        val dispatch: (MotionEvent) -> Boolean, val viewport: () -> Rect?)
    private val targets = linkedMapOf<View, Target>()
    private val blocked = mutableMapOf<Any, Rect>()
    private var owner: Target? = null
    private var candidate: Target? = null
    private var suppressRemainder = false
    private var delivered = false

    fun register(view: View, accepts: (MotionEvent) -> Boolean, dispatch: (MotionEvent) -> Boolean, viewport: () -> Rect? = { null }) {
        targets[view] = Target(view, accepts, dispatch, viewport)
    }
    fun unregister(view: View) {
        targets.remove(view)
        if (hoverTarget?.view == view) hoverTarget = null
        if (owner?.view == view) { owner = null; suppressRemainder = true }
        if (candidate?.view == view) candidate = null
    }
    /** Actual overlay bounds in window coordinates, never source annotation geometry. */
    fun block(token: Any, boundsInWindow: Rect?) {
        if (boundsInWindow == null) blocked.remove(token) else blocked[token] = Rect(boundsInWindow)
    }
    private fun findTarget(event: MotionEvent): Target? {
        val index = event.actionIndex
        val pen = event.getToolType(index) in listOf(MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER)
        if (!pen || event.actionMasked !in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE, MotionEvent.ACTION_HOVER_EXIT)) return null
        val windowOrigin = IntArray(2).also(::getLocationInWindow)
        val screenOrigin = IntArray(2).also(::getLocationOnScreen)
        val windowX = event.getX(index) + windowOrigin[0]
        val windowY = event.getY(index) + windowOrigin[1]
        if (blocked.values.any { it.contains(windowX.toInt(), windowY.toInt()) }) return null
        val screenX = event.getX(index) + screenOrigin[0]
        val screenY = event.getY(index) + screenOrigin[1]
        return targets.values.lastOrNull { target ->
            val visible = Rect()
            target.view.isAttachedToWindow && target.view.isShown && target.accepts(event) &&
                target.viewport()?.contains(windowX.toInt(), windowY.toInt()) != false &&
                target.view.getGlobalVisibleRect(visible) && visible.contains(screenX.toInt(), screenY.toInt())
        }
    }
    private var hoverTarget: Target? = null
    override fun dispatchHoverEvent(event: MotionEvent): Boolean {
        val target = findTarget(event)
        if (hoverTarget != target) {
            hoverTarget?.let { old ->
                val exit = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_HOVER_EXIT }
                try { dispatchLocal(old, exit) } finally { exit.recycle() }
            }
        }
        hoverTarget = if (event.actionMasked == MotionEvent.ACTION_HOVER_EXIT) null else target
        return target?.let { dispatchLocal(it, event); true } ?: super.dispatchHoverEvent(event)
    }
    private fun dispatchLocal(target: Target, event: MotionEvent) {
        val local = MotionEvent.obtain(event)
        try {
            val hostToGlobal = Matrix().also(::transformMatrixToGlobal)
            val targetToGlobal = Matrix().also(target.view::transformMatrixToGlobal)
            val inverse = Matrix()
            if (targetToGlobal.invert(inverse)) {
                inverse.preConcat(hostToGlobal)
                local.transform(inverse)
                target.dispatch(local)
            }
        } finally { local.recycle() }
    }
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        delivered = false
        if (event.actionMasked == MotionEvent.ACTION_DOWN) { owner = null; suppressRemainder = false }
        candidate = if (owner == null && !suppressRemainder) findTarget(event) else null
        // A Compose finger scroll can disallow interception. Only an admitted original-page
        // pen takes ownership; normal ViewGroup interception cancels the old child gesture.
        if (candidate != null) super.requestDisallowInterceptTouchEvent(false)
        val handled = super.dispatchTouchEvent(event)
        // On mid-stream interception ViewGroup sends CANCEL to the old child and removes it,
        // but does not deliver the intercepting POINTER_DOWN to its own onTouchEvent. Start the
        // admitted pen only after that child cancellation, exactly once with the real event.
        if (owner != null && !delivered) return onTouchEvent(event)
        return handled
    }
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (owner != null || suppressRemainder) return true
        candidate?.let { owner = it; candidate = null; return true }
        return super.onInterceptTouchEvent(event)
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val target = owner
        if (target == null && !suppressRemainder) return super.onTouchEvent(event)
        delivered = true
        if (target != null) {
            if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) requestUnbufferedDispatch(event)
            val local = MotionEvent.obtain(event)
            try {
                val hostToGlobal = Matrix().also(::transformMatrixToGlobal)
                val targetToGlobal = Matrix().also(target.view::transformMatrixToGlobal)
                val inverse = Matrix()
                if (targetToGlobal.invert(inverse)) {
                    inverse.preConcat(hostToGlobal)
                    local.transform(inverse)
                    target.dispatch(local)
                }
            } finally { local.recycle() }
        }
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            owner = null; suppressRemainder = false
            super.requestDisallowInterceptTouchEvent(false)
        }
        return true
    }
    override fun onDetachedFromWindow() {
        owner?.let { target ->
            val now = android.os.SystemClock.uptimeMillis()
            val cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
            try { target.dispatch(cancel) } finally { cancel.recycle() }
        }
        owner = null; candidate = null; targets.clear(); blocked.clear(); suppressRemainder = false
        super.onDetachedFromWindow()
    }
}

fun View.readerInputHost(): ReaderInputHost? {
    var ancestor = parent
    while (ancestor != null) {
        if (ancestor is ReaderInputHost) return ancestor
        ancestor = ancestor.parent
    }
    return null
}
