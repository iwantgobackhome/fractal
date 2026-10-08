package app.fractal.pdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
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
    val start: Int? = null,
    val end: Int? = null,
    val origin: String = "original",
    val blockId: String? = null,
    val provenance: String = "native-original",
    val quads: List<List<Pair<Float, Float>>> = emptyList(),
    val originalRects: List<PdfRect> = rects,
    val pdfSha256: String? = null,
    val extractionVersion: String? = null,
    val rotation: Int? = null,
)

/** Bitmap cache is bounded by bytes; a width change renders a fresh page. */
class PdfPages(file: File, memoryClassMb: Int = (Runtime.getRuntime().maxMemory() / (1024 * 1024)).toInt()) : Closeable {
    private val renderMemoryClassMb = memoryClassMb
    private val pagePixels = PdfRenderBudget.pagePixels(memoryClassMb)
    private val sourceFile = file
    private val openedLength = file.length()
    private val openedModified = file.lastModified()
    val pdfSha256: String = file.inputStream().use { stream ->
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) { val count = stream.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        digest.digest().joinToString("") { "%02x".format(it) }
    }
    private val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(descriptor)
    private val bitmaps = object : LruCache<String, Bitmap>(PdfRenderBudget.cacheBytes(memoryClassMb)) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }
    private val sizes = PdfPageSizes(renderer.pageCount) { index ->
        renderer.openPage(index).use { it.width to it.height }
    }
    val pageCount: Int get() = sizes.count
    fun identityUnchanged(): Boolean = sourceFile.isFile && sourceFile.length() == openedLength && sourceFile.lastModified() == openedModified

    fun aspectRatio(index: Int): Float = sizes.aspectRatio(index)
    fun pageWidthPoints(index: Int): Int = sizes.width(index)

    @Synchronized
    fun bitmap(index: Int, widthPx: Int, checkActive: () -> Unit = {}): Bitmap {
        checkActive()
        renderer.openPage(index).use { page ->
            var safeWidth = PdfRenderBudget.baseWidth(widthPx, page.width.toFloat() / page.height, renderMemoryClassMb)
            while (true) {
                checkActive()
                val key = "$index:$safeWidth"
                bitmaps.get(key)?.let { return it }
                var rendered: Bitmap? = null
                try {
                    val height = max(1, (safeWidth * page.height.toFloat() / page.width).toInt())
                    val bitmap = Bitmap.createBitmap(safeWidth, height, Bitmap.Config.ARGB_8888)
                    rendered = bitmap
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bitmaps.put(key, bitmap)
                    return bitmap
                } catch (error: OutOfMemoryError) {
                    rendered?.recycle()
                    bitmaps.evictAll()
                    if (safeWidth <= 32) throw error
                    safeWidth = (safeWidth / 2).coerceAtLeast(32)
                } catch (error: Throwable) { rendered?.recycle(); throw error }
            }
        }
    }

    /** Tiles are not cached: only the currently displayed tile and its replacement stay alive. */
    @Synchronized
    fun tileBitmap(index: Int, spec: PdfTileSpec, checkActive: () -> Unit = {}): Bitmap {
        checkActive()
        renderer.openPage(index).use { page ->
            var divisor = 1
            while (true) {
                checkActive()
                var rendered: Bitmap? = null
                try {
                    val bitmap = Bitmap.createBitmap(max(1, spec.width / divisor), max(1, spec.height / divisor), Bitmap.Config.ARGB_8888)
                    rendered = bitmap
                    bitmap.eraseColor(Color.WHITE)
                    val scale = spec.pageWidth.toFloat() / page.width / divisor
                    val matrix = android.graphics.Matrix().apply {
                        setScale(scale, scale)
                        postTranslate(-spec.left.toFloat() / divisor, -spec.top.toFloat() / divisor)
                    }
                    page.render(bitmap, android.graphics.Rect(0, 0, bitmap.width, bitmap.height), matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    return bitmap
                } catch (error: OutOfMemoryError) {
                    rendered?.recycle(); bitmaps.evictAll()
                    if (max(spec.width, spec.height) / divisor <= 32) throw error
                    divisor *= 2
                } catch (error: Throwable) { rendered?.recycle(); throw error }
            }
        }
    }

    /** Optional native API35 helper. Its text stream is never treated as cached layout UTF16. */
    @Synchronized
    fun select(index: Int, x: Float, y: Float, endX: Float = x, endY: Float = y): PdfTextSelection? {
        if (Build.VERSION.SDK_INT < 35) return null
        renderer.openPage(index).use { page ->
            return NativePageSelection.select(page, x, y, endX, endY)
        }
    }

    /** Crops share the byte-bounded cache. Never recycle a cached bitmap: Compose can still
     * hold it after eviction or close; Android frees it when the last consumer releases it. */
    @Synchronized
    fun cropBitmap(index: Int, rect: PdfRect, widthPx: Int): Bitmap {
        require(rect.x.isFinite() && rect.y.isFinite() && rect.width.isFinite() && rect.height.isFinite())
        val x = rect.x.coerceIn(0f, 1f)
        val y = rect.y.coerceIn(0f, 1f)
        val width = rect.width.coerceIn(0f, 1f - x)
        val height = rect.height.coerceIn(0f, 1f - y)
        require(width > 0f && height > 0f)
        renderer.openPage(index).use { page ->
            val aspect = width * page.width / (height * page.height)
            var targetWidth = PdfRenderBudget.width(widthPx, aspect, pagePixels)
            while (true) {
                val key = "crop:$index:$x:$y:$width:$height:$targetWidth"
                bitmaps.get(key)?.let { return it }
                var rendered: Bitmap? = null
                try {
                    val scale = targetWidth / (width * page.width)
                    val targetHeight = max(1, (height * page.height * scale).toInt())
                    val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
                    rendered = bitmap
                    bitmap.eraseColor(Color.WHITE)
                    val matrix = android.graphics.Matrix().apply {
                        setScale(scale, scale)
                        postTranslate(-x * page.width * scale, -y * page.height * scale)
                    }
                    page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bitmaps.put(key, bitmap)
                    return bitmap
                } catch (error: OutOfMemoryError) {
                    rendered?.recycle()
                    bitmaps.evictAll()
                    if (targetWidth <= 32) throw error
                    targetWidth = (targetWidth / 2).coerceAtLeast(32)
                } catch (error: Throwable) { rendered?.recycle(); throw error }
            }
        }
    }

    @Synchronized
    override fun close() {
        bitmaps.evictAll()
        renderer.close()
        descriptor.close()
    }
}
