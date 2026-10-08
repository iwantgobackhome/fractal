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
