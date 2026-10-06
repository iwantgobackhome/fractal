package app.fractal.reader

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fractal.pdf.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Descriptor-only history renders the thumbnail from the local original PDF. */
@Composable
internal fun ReaderImageAttachment(pages: PdfPages?, attachment: JsonObject, modifier: Modifier = Modifier) {
    val page = attachment["page"]?.jsonPrimitive?.intOrNull ?: return
    val box = attachment["bbox"] as? JsonObject ?: return
    var bitmap by remember(pages, attachment) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(pages, attachment) {
        if (pages == null || page !in 1..pages.pageCount) return@LaunchedEffect
        try { bitmap = withContext(Dispatchers.IO) {
            fun n(key: String) = box[key]?.jsonPrimitive?.floatOrNull ?: 0f
            pages.cropBitmap(page - 1, PdfRect(n("x"), n("y"), n("width"), n("height")), 160)
        } } catch (cancel: CancellationException) { throw cancel } catch (_: Exception) { }
    }
    Surface(modifier.testTag("reader-image-attachment"), shape = MaterialTheme.shapes.small, tonalElevation = 2.dp) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            bitmap?.let { Image(it.asImageBitmap(), null, Modifier.size(56.dp, 40.dp)) }
            Text("📎 ${attachment.threadText("label")} · p.$page", Modifier.padding(start = 6.dp),
                maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
internal fun ReaderTextAttachment(page: Int?, text: String, modifier: Modifier = Modifier) {
    var expanded by remember(page, text) { mutableStateOf(false) }
    Text("📎 p.${page ?: "?"} · “$text”", modifier.clickable { expanded = !expanded },
        maxLines = if (expanded) Int.MAX_VALUE else 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        style = MaterialTheme.typography.bodySmall)
}
