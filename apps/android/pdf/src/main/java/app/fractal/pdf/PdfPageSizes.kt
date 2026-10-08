package app.fractal.pdf

internal class PdfPageSizes(val count: Int, read: (Int) -> Pair<Int, Int>) {
    private val sizes = Array(count, read)
    fun width(index: Int): Int = sizes[index].first
    fun aspectRatio(index: Int): Float = sizes[index].first.toFloat() / sizes[index].second
}
