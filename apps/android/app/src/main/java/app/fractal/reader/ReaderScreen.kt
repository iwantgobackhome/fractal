package app.fractal.reader

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.Image
import app.fractal.data.AnnotationEntity
import app.fractal.data.LibraryEntity
import app.fractal.data.TranslatedBlock
import app.fractal.data.translatedBlocks
import app.fractal.data.ReadProgress
import app.fractal.data.WireJson
import app.fractal.design.LocalFractalColors
import app.fractal.ink.InkCanvas
import app.fractal.ink.InkJson
import app.fractal.ink.InkPageState
import app.fractal.ink.InkStroke
import app.fractal.ink.InkToolbar
import app.fractal.ink.InkToolState
import app.fractal.ink.rememberInkToolState
import app.fractal.pdf.PdfPages
import app.fractal.pdf.PdfTextSelection
import app.fractal.sync.SyncScheduler
import app.fractal.sync.HubClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID
import kotlin.math.roundToInt

@Composable
fun ReaderScreen(app: ReaderApplication, paper: LibraryEntity, onBack: () -> Unit) = StableReaderScreen(app, paper, onBack)

internal suspend fun saveMemo(
    app: ReaderApplication,
    paperKey: String,
    page: Int,
    selection: PdfTextSelection,
    text: String,
    color: String = "yellow",
) {
    val rect = selection.rects.firstOrNull()
    val value = buildJsonObject {
        put("id", UUID.randomUUID().toString())
        put("paperKey", paperKey)
        put("updatedAt", Instant.now().toString())
        put("deleted", false)
        put("rev", 0)
        put("deviceId", app.credentials.load()?.deviceId ?: "android")
        put("kind", "memo")
        put("page", page)
        put("provenance", selectionProvenance(page, selection))
        put("text", text)
        put("quote", selection.text)
        put("color", color)
        put("collapsed", false)
        val rectJson = rect?.let {
            buildJsonObject {
                put("x", it.x)
                put("y", it.y)
                put("width", it.width)
                put("height", it.height)
            }
        } ?: kotlinx.serialization.json.JsonNull
        put("rect", rectJson)
    }
    app.sync.saveLocal(value)
    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
}

internal suspend fun saveHighlight(
    app: ReaderApplication,
    paperKey: String,
    page: Int,
    selection: PdfTextSelection,
    color: String,
    note: String? = null,
) {
    val deviceId = app.credentials.load()?.deviceId ?: "android"
    val rects = selection.rects.map {
        buildJsonObject {
            put("x", it.x)
            put("y", it.y)
            put("width", it.width)
            put("height", it.height)
        }
    }
    val value = buildJsonObject {
        put("id", UUID.randomUUID().toString())
        put("paperKey", paperKey)
        put("updatedAt", Instant.now().toString())
        put("deleted", false)
        put("rev", 0)
        put("deviceId", deviceId)
        put("kind", "highlight")
        put("page", page)
        put("provenance", selectionProvenance(page, selection))
        put("text", selection.text)
        put("color", color)
        put("rects", kotlinx.serialization.json.JsonArray(rects))
        put("note", note)
    }
    app.sync.saveLocal(value)
    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
}

fun highlightColor(name: String) = when (name) {
    "green" -> androidx.compose.ui.graphics.Color(0xFF90CDA2)
    "blue" -> androidx.compose.ui.graphics.Color(0xFF98BEE8)
    "pink" -> androidx.compose.ui.graphics.Color(0xFFE8A6BC)
    else -> androidx.compose.ui.graphics.Color(0xFFE8D46F)
}
