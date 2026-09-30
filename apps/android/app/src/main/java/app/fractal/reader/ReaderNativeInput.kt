package app.fractal.reader

import android.graphics.Rect
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import app.fractal.ink.readerInputHost
import kotlin.math.roundToInt

@Composable
internal fun Modifier.nativeInkBlocker(): Modifier {
    val host = LocalView.current.readerInputHost()
    val token = remember { Any() }
    DisposableEffect(host, token) { onDispose { host?.block(token, null) } }
    return onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        host?.block(token, Rect(bounds.left.roundToInt(), bounds.top.roundToInt(), bounds.right.roundToInt(), bounds.bottom.roundToInt()))
    }
}

internal fun Modifier.readerViewport(onBounds: (Rect) -> Unit): Modifier = onGloballyPositioned { coordinates ->
    val bounds = coordinates.boundsInWindow()
    onBounds(Rect(bounds.left.roundToInt(), bounds.top.roundToInt(), bounds.right.roundToInt(), bounds.bottom.roundToInt()))
}
