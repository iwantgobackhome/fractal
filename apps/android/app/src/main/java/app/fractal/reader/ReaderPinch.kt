package app.fractal.reader

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue

internal class ReaderPinch {
    var committing = false
    var scale by mutableFloatStateOf(1f)
    var x by mutableFloatStateOf(0f)
    var y by mutableFloatStateOf(0f)
    fun reset() { committing = false; scale = 1f; x = 0f; y = 0f }
}

internal fun committedZoomOffset(offset: Float, scale: Float, translation: Float): Float = offset * scale - translation

internal fun boundedReaderPan(pan: Float, viewportWidth: Float, zoom: Float): Float =
    pan.coerceIn(minOf(0f, viewportWidth * (1f - zoom)), 0f)

internal fun doubleTapReaderZoom(zoom: Float): Float = if (zoom == 1f) 1.5f else 1f
