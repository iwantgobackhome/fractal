package app.fractal.pdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Point
import android.graphics.pdf.PdfRenderer
import android.graphics.pdf.models.selection.SelectionBoundary
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.LruCache
import java.io.Closeable
import java.io.File
import kotlin.math.max

data class PdfRect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
)

data class PdfTextSelection(
    val text: String,
    val rects: List<PdfRect>,
)

/** Bitmap cache is bounded by bytes; a width change renders a fresh page. */
class PdfPages(file: File) : Closeable {
    private val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(descriptor)
    private val bitmaps = object : LruCache<String, Bitmap>(80 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }
    val pageCount: Int get() = renderer.pageCount

    @Synchronized
    fun aspectRatio(index: Int): Float {
        renderer.openPage(index).use { page ->
            return page.width.toFloat() / page.height
        }
    }

    @Synchronized
    fun pageWidthPoints(index: Int): Int {
        renderer.openPage(index).use { return it.width }
    }

    @Synchronized
    fun bitmap(index: Int, widthPx: Int): Bitmap {
        val safeWidth = widthPx.coerceIn(120, 3200)
        val key = "$index:$safeWidth"
        bitmaps.get(key)?.let { return it }
        renderer.openPage(index).use { page ->
            val height = max(1, (safeWidth * page.height.toFloat() / page.width).toInt())
            val bitmap = Bitmap.createBitmap(safeWidth, height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bitmaps.put(key, bitmap)
            return bitmap
        }
    }

    /** Native text selection exists on API 35. Older devices can select a page region only. */
    @Synchronized
    fun select(index: Int, x: Float, y: Float): PdfTextSelection? {
        if (Build.VERSION.SDK_INT < 35) return null
        renderer.openPage(index).use { page ->
            val point = Point(
                (x.coerceIn(0f, 1f) * page.width).toInt(),
                (y.coerceIn(0f, 1f) * page.height).toInt(),
            )
            val boundary = SelectionBoundary(point)
            val selected = page.selectContent(boundary, boundary) ?: return null
            val contents = selected.selectedTextContents
            val rects = contents.flatMap { it.bounds }.map { rect ->
                PdfRect(
                    x = (rect.left / page.width).coerceIn(0f, 1f),
                    y = (rect.top / page.height).coerceIn(0f, 1f),
                    width = (rect.width() / page.width).coerceIn(0f, 1f),
                    height = (rect.height() / page.height).coerceIn(0f, 1f),
                )
            }
            return PdfTextSelection(contents.joinToString(" ") { it.text }, rects)
        }
    }

    override fun close() {
        bitmaps.evictAll()
        renderer.close()
        descriptor.close()
    }
}
