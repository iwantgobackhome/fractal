package app.fractal.pdf

import kotlin.math.sqrt

/** Three displayed pages plus replacements fit the shared raster budget regardless of zoom. */
object PdfRenderBudget {
    fun cacheBytes(memoryClassMb: Int): Int = (memoryClassMb.coerceAtLeast(32).toLong() * 1024 * 1024 / 8).coerceAtMost(32L * 1024 * 1024).toInt()
    fun pagePixels(memoryClassMb: Int): Int = cacheBytes(memoryClassMb) / 6 / 4
    fun width(requested: Int, aspect: Float, pixels: Int): Int {
        val cap = sqrt(pixels.toDouble() * aspect.coerceAtLeast(.01f)).toInt().coerceAtLeast(1)
        val bucket = ((requested.coerceAtLeast(1).toLong() + 127) / 128 * 128).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        return minOf(bucket, cap, 3200).coerceAtLeast(1)
    }
}
