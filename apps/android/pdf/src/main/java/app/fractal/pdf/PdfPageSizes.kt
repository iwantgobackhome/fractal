package app.fractal.pdf

import java.util.concurrent.atomic.AtomicReferenceArray

internal class PdfPageSizes(val count: Int, precompute: Boolean = true, private val read: (Int) -> Pair<Int, Int>) {
    private val sizes = AtomicReferenceArray<Pair<Int, Int>>(count)
    init { if (precompute) repeat(count) { sizes.set(it, read(it)) } }
    private fun size(index: Int): Pair<Int, Int> = sizes.get(index) ?: synchronized(this) {
        sizes.get(index) ?: read(index).also { sizes.set(index, it) }
    }
    fun width(index: Int): Int = size(index).first
    fun aspectRatio(index: Int): Float = size(index).let { it.first.toFloat() / it.second }
}
