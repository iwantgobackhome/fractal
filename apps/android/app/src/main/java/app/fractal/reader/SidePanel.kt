package app.fractal.reader

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.data.AnnotationEntity
import app.fractal.data.WireJson
import app.fractal.design.LocalFractalColors
import app.fractal.design.ResearchSelector
import app.fractal.pdf.PdfRect
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfTextSelection
import app.fractal.sync.HubClient
import app.fractal.sync.SseParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Composable
fun SidePanel(app: ReaderApplication, paperKey: String, annotations: List<AnnotationEntity>, pages: PdfPages?, tab: String,
    onTabChange: (String) -> Unit, onJump: (Int) -> Unit, modifier: Modifier = Modifier,
    questionSelection: Pair<Int, PdfTextSelection>? = null, onClearQuestionSelection: () -> Unit = {}, onClose: () -> Unit = {},
    onRequestCreated: (String, Pair<Int, PdfTextSelection>?) -> Unit = { _, _ -> }) =
    DurableReaderPanel(app, paperKey, annotations, pages, tab, onTabChange, onJump, modifier, questionSelection, onClearQuestionSelection, onClose, onRequestCreated)

@Composable
internal fun RegionThumbnail(pages: PdfPages?, page: Int, annotationJson: String) {
    val app = LocalContext.current.applicationContext as? ReaderApplication
    var cropped by remember(pages, page, annotationJson) { mutableStateOf<Bitmap?>(null) }
    var unavailable by remember(pages, page, annotationJson) { mutableStateOf(false) }
    LaunchedEffect(pages, page, annotationJson) {
        cropped = null
        unavailable = false
        if (pages == null || page !in 1..pages.pageCount) return@LaunchedEffect
        cropped = withContext(Dispatchers.IO) {
            runCatching {
                val annotation = WireJson.format.parseToJsonElement(annotationJson).jsonObject
                val provenance = annotation["provenance"] as? JsonObject
                if (!pages.identityUnchanged() || (provenance?.get("pdfSha256")?.jsonPrimitive?.content?.let { it != pages.pdfSha256 } == true)) { unavailable = true; return@runCatching null }
                val needsLayout = provenance?.get("layoutRange") != null || provenance?.get("coordinateSpace")?.jsonPrimitive?.content == "unrotated-crop-normalized-v1"
                val layout = if (needsLayout && app != null) app.originalText.page(annotation["paperKey"]?.jsonPrimitive?.content.orEmpty(), pages.pdfSha256, page, pages.pageCount).page else null
                if (sourceContextStatus(provenance, pages.pdfSha256, page, layout) !in listOf("current", "unknown") || (needsLayout && layout == null)) { unavailable = true; return@runCatching null }
                val rect = annotation["rects"]
                    ?.jsonArray?.firstOrNull()?.jsonObject ?: return@runCatching null
                fun number(key: String) = rect[key]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                val displayed = renderedRect(PdfRect(number("x"), number("y"), number("width"), number("height")), provenance, layout?.rotation ?: 0)
                val image = pages.bitmap(page - 1, 800)
                val x = ((displayed.x - .08f).coerceIn(0f, 1f) * image.width).toInt().coerceAtMost(image.width - 1)
                val y = ((displayed.y - .015f).coerceIn(0f, 1f) * image.height).toInt().coerceAtMost(image.height - 1)
                val right = ((displayed.x + displayed.width + .08f).coerceIn(0f, 1f) * image.width).toInt()
                val bottom = ((displayed.y + displayed.height + .015f).coerceIn(0f, 1f) * image.height).toInt()
                Bitmap.createBitmap(image, x, y, (right - x).coerceAtLeast(1), (bottom - y).coerceAtLeast(1))
            }.getOrNull()
        }
    }
    if (unavailable) Text(libraryText("Source changed or unavailable. Select the region again.", "원문이 변경되었거나 사용할 수 없습니다. 영역을 다시 선택하세요."), style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
    cropped?.let { image ->
        Image(image.asImageBitmap(), stringResource(R.string.region_preview, page),
            Modifier.padding(top = 6.dp).width(240.dp).height(64.dp), contentScale = ContentScale.Fit)
    }
}
