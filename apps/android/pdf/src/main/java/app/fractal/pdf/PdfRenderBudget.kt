package app.fractal.pdf

import kotlin.math.sqrt

/** Cache holds viewport-width bases; zoom detail is a viewport-sized, uncached tile. */
object PdfRenderBudget {
    fun cacheBytes(memoryClassMb: Int): Int = (memoryClassMb.coerceAtLeast(32).toLong() * 1024 * 1024 / 3).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    fun pagePixels(memoryClassMb: Int): Int = cacheBytes(memoryClassMb) / 4
    fun baseWidth(requested: Int, aspect: Float, memoryClassMb: Int): Int =
        if (memoryClassMb >= 128) requested.coerceAtLeast(1) else width(requested, aspect, pagePixels(memoryClassMb))
    fun width(requested: Int, aspect: Float, pixels: Int): Int {
        val cap = sqrt(pixels.toDouble() * aspect.coerceAtLeast(.01f)).toInt().coerceAtLeast(1)
        val bucket = ((requested.coerceAtLeast(1).toLong() + 127) / 128 * 128).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        return minOf(bucket, cap).coerceAtLeast(1)
    }
    fun tile(pageWidth: Int, pageHeight: Int, left: Int, top: Int, viewportWidth: Int, viewportHeight: Int): PdfTileSpec? {
        val x = left.coerceIn(0, pageWidth); val y = top.coerceIn(0, pageHeight)
        val w = minOf(viewportWidth, pageWidth - x); val h = minOf(viewportHeight, pageHeight - y)
        return if (w > 0 && h > 0) PdfTileSpec(x, y, w, h, pageWidth, pageHeight) else null
    }
}

data class PdfTileSpec(val left: Int, val top: Int, val width: Int, val height: Int, val pageWidth: Int, val pageHeight: Int)
