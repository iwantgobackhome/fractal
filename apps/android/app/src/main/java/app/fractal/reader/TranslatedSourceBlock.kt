package app.fractal.reader

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.fractal.data.TranslatedBlock
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfRect
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Every region is kept, including blocks whose source spans several physical pages. */
@Composable
internal fun TranslatedSourceBlock(block: TranslatedBlock, pages: PdfPages?) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
        block.regions.forEach { region ->
            BoxWithConstraints(Modifier.fillMaxWidth().background(Color.White)) {
                val cropWidth = minOf(maxWidth, maxWidth * region.width.coerceIn(.01f, 1f) * 1.6f)
                val widthPx = with(LocalDensity.current) { cropWidth.roundToPx().coerceAtLeast(1) }
                var bitmap by remember(pages, region, widthPx) { mutableStateOf<Bitmap?>(null) }
                var failed by remember(pages, region, widthPx) { mutableStateOf(false) }
                LaunchedEffect(pages, region, widthPx) {
                    if (pages == null || region.page !in 1..pages.pageCount) { failed = true; return@LaunchedEffect }
                    try {
                        bitmap = withContext(Dispatchers.IO) {
                            pages.cropBitmap(region.page - 1, PdfRect(region.x, region.y, region.width, region.height), widthPx)
                        }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: OutOfMemoryError) { failed = true }
                    catch (_: Exception) { failed = true }
                }
                val image = bitmap
                if (image != null) {
                    Image(image.asImageBitmap(), libraryText("Original ${block.kind} · page ${region.page}", "원문 ${block.kind} · ${region.page}쪽"),
                        Modifier.width(cropWidth).aspectRatio(image.width.toFloat() / image.height))
                } else {
                    // Reserve the actual crop proportions while rasterising off the UI thread.
                    var pageAspect by remember(pages, region) { mutableStateOf<Float?>(null) }
                    LaunchedEffect(pages, region) {
                        if (pages != null && region.page in 1..pages.pageCount) {
                            pageAspect = withContext(Dispatchers.IO) { runCatching { pages.aspectRatio(region.page - 1) }.getOrNull() }
                        }
                    }
                    Box(Modifier.width(cropWidth).then(pageAspect?.let { Modifier.aspectRatio(it * region.width / region.height) } ?: Modifier.height(80.dp))) {
                        if (failed) Text(libraryText("Original image unavailable", "원문 이미지를 불러올 수 없습니다"), Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall, color = Color.DarkGray)
                    }
                }
            }
        }
    }
}
