package app.fractal.reader

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.fractal.data.LibraryEntity
import app.fractal.data.LibraryRecord
import app.fractal.data.WireJson
import app.fractal.design.FractalTheme
import app.fractal.design.LocalFractalColors
import app.fractal.design.PaperTheme
import app.fractal.sync.PairingPayloadParser
import app.fractal.sync.HubClient
import app.fractal.sync.SyncScheduler
import app.fractal.ink.EraserMode
import app.fractal.ink.rememberInkToolState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString

class MainActivity : AppCompatActivity() {
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        cameraGranted.value = granted
    }
    private val cameraGranted = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraGranted.value = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val app = application as ReaderApplication
        setContent {
            val themeName = app.settings.getString("theme", "System") ?: "System"
            var theme by remember { mutableStateOf(themeName) }
            val darkSystem = androidx.compose.foundation.isSystemInDarkTheme()
            val paperTheme = when (theme) {
                "Dark" -> PaperTheme.Dark
                "Sepia" -> PaperTheme.Sepia
                "Light" -> PaperTheme.Light
                else -> if (darkSystem) PaperTheme.Dark else PaperTheme.Light
            }
            FractalTheme(paperTheme) {
                ReaderApp(app, cameraGranted.value, { cameraPermission.launch(Manifest.permission.CAMERA) }, theme) {
                    theme = it
                    app.settings.edit().putString("theme", it).apply()
                }
            }
        }
    }
}

@Composable
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
private fun ReaderApp(
    app: ReaderApplication,
    cameraGranted: Boolean,
    requestCamera: () -> Unit,
    theme: String,
    setTheme: (String) -> Unit,
) {
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    var screen by rememberSaveable {
        mutableStateOf(when {
            app.credentials.load() != null -> "library"
            !app.settings.getBoolean("languageIntroDone", false) -> "language"
            else -> "connect"
        })
    }
    var activePaperKey by rememberSaveable { mutableStateOf<String?>(null) }
    var menuPaper by remember { mutableStateOf<LibraryEntity?>(null) }
    var error by remember { mutableStateOf("") }
    val papers by app.database.library().observeAll().collectAsState(initial = emptyList())
    val activePaper = papers.firstOrNull { it.paperKey == activePaperKey }
    LaunchedEffect(papers, app.settings.getBoolean("autoDownload", false)) {
        if (app.settings.getBoolean("autoDownload", false) && app.credentials.load() != null) {
            for (paper in papers) {
                runCatching {
                    val metadata = app.sync.refreshPaperMetadata(paper.paperKey) ?: return@runCatching
                    if (app.cache.existing(metadata.first) == null) {
                        app.downloader.download(paper.paperKey, metadata.first)
                    }
                }
            }
        }
    }
    val width = LocalConfiguration.current.screenWidthDp
    val expanded = width >= 840
    LaunchedEffect(screen) {
        if (screen == "library" && app.credentials.load() != null) {
            runCatching { app.sync.syncOnce() }
        }
    }
    Column(Modifier.fillMaxSize().background(colors.paper)) {
        when (screen) {
            "language" -> LanguageIntroScreen(app) { screen = "connect" }
            "connect" -> ConnectScreen(
                app = app,
                cameraGranted = cameraGranted,
                requestCamera = requestCamera,
                onConnected = {
                    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
                    screen = "library"
                    scope.launch { adoptHubLanguageIfUnset(app) }
                },
            )
            "settings" -> SettingsScreen(app, theme, setTheme, onBack = { screen = "library" }, onPair = { screen = "connect" })
            "reader" -> {
                val paper = activePaper
                if (paper != null) {
                    ReaderScreen(app, paper, onBack = { screen = "library" })
                }
            }
            else -> {
                Row(Modifier.fillMaxSize()) {
                    Column(Modifier.weight(1f)) {
                        Header(stringResource(R.string.library), action = stringResource(R.string.settings),
                            onAction = { screen = "settings" }, largeTitle = true)
                        var search by remember { mutableStateOf("") }
                        var filter by remember { mutableStateOf("all") }
                        var refreshing by remember { mutableStateOf(false) }
                        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                            BasicTextField(
                                value = search,
                                onValueChange = { search = it },
                                singleLine = true,
                                textStyle = TextStyle(color = colors.ink, fontSize = 16.sp),
                                modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                decorationBox = { inner ->
                                    if (search.isEmpty()) Text(stringResource(R.string.search), color = colors.inkSoft)
                                    inner()
                                },
                            )
                            HorizontalDivider(Modifier.align(Alignment.BottomCenter), color = colors.rule, thickness = .5.dp)
                        }
                        Row {
                            listOf("all" to R.string.all_papers, "reading" to R.string.reading,
                                "offline" to R.string.saved_offline).forEach { (id, label) ->
                                TextButton(onClick = { filter = id }) {
                                    Text(stringResource(label), color = if (filter == id) colors.ink else colors.inkSoft)
                                }
                            }
                        }
                        PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
                            refreshing = true
                            scope.launch {
                                runCatching { app.sync.syncOnce() }.onFailure { error = it.message.orEmpty() }
                                refreshing = false
                            }
                        }) {
                        LazyColumn(Modifier.fillMaxSize()) {
                            val visible = papers.filter { paper ->
                                (paper.title.orEmpty().contains(search, ignoreCase = true) || paper.authors.contains(search, ignoreCase = true)) &&
                                    (filter == "all" || filter == "reading" && paper.status == "reading" ||
                                        filter == "offline" && paper.pdfSha256?.let(app.cache::existing) != null)
                            }
                            items(visible, key = { it.paperKey }) { paper ->
                                LibraryRow(paper, paper.pdfSha256?.let(app.cache::existing) != null, onLongClick = { menuPaper = paper }) {
                                    activePaperKey = paper.paperKey
                                    if (!expanded) screen = "reader"
                                }
                            }
                        }
                        }
                    }
                    if (expanded && activePaper != null) {
                        Column(Modifier.width(400.dp).fillMaxHeight().border(BorderStroke(.5.dp, colors.rule))
                            .verticalScroll(rememberScrollState()).padding(24.dp)) {
                            val paper = activePaper
                            val record = remember(paper.json) {
                                runCatching { WireJson.format.decodeFromString<LibraryRecord>(paper.json) }.getOrNull()
                            }
                            Text(paper.title.orEmpty(), fontFamily = FontFamily.Serif, fontSize = 25.sp)
                            Spacer(Modifier.height(16.dp))
                            Text(record?.authors?.joinToString(", ") { "${it.given} ${it.family}".trim() }
                                ?: paper.authors, color = colors.inkSoft)
                            Text(listOfNotNull(paper.venue, paper.year?.toString()).joinToString(" · "), color = colors.inkSoft)
                            record?.abstract?.takeIf { it.isNotBlank() }?.let {
                                Spacer(Modifier.height(20.dp))
                                Text(it, color = colors.ink)
                            }
                            record?.tags?.takeIf { it.isNotEmpty() }?.let {
                                Spacer(Modifier.height(16.dp))
                                Text(it.joinToString(" · "), color = colors.inkSoft)
                            }
                            Spacer(Modifier.height(24.dp))
                            Button(onClick = { screen = "reader" }) { Text(stringResource(R.string.read)) }
                        }
                    }
                }
            }
        }
        if (error.isNotEmpty()) Text(error, color = colors.accent)
    }
    menuPaper?.let { paper ->
        ModalBottomSheet(onDismissRequest = { menuPaper = null }) {
            TextButton(onClick = {
                menuPaper = null
                scope.launch {
                    runCatching {
                        val metadata = app.sync.refreshPaperMetadata(paper.paperKey)
                            ?: throw IllegalStateException(app.getString(R.string.pdf_unavailable))
                        app.downloader.download(paper.paperKey, metadata.first)
                    }.onFailure { error = it.message.orEmpty() }
                }
            }) { Text(stringResource(R.string.save_offline)) }
            TextButton(onClick = {
                paper.pdfSha256?.let { app.cache.existing(it)?.delete() }
                menuPaper = null
            }) { Text(stringResource(R.string.remove_offline)) }
            TextButton(onClick = {
                menuPaper = null
                scope.launch {
                    runCatching {
                        app.client.data("/api/library/${HubClient.keyPath(paper.paperKey)}", "DELETE")
                        app.database.library().delete(paper.paperKey)
                    }.onFailure { error = it.message.orEmpty() }
                }
            }) { Text(stringResource(R.string.delete_paper)) }
        }
    }
}

@Composable
fun Header(title: String, action: String, onAction: () -> Unit, onBack: (() -> Unit)? = null,
    largeTitle: Boolean = false) {
    val colors = LocalFractalColors.current
    Column {
        Row(Modifier.fillMaxWidth().height(if (largeTitle) 64.dp else 48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) TextButton(onClick = onBack) { Text(stringResource(R.string.back_symbol), fontSize = 28.sp) }
            Text(title, modifier = Modifier.weight(1f), fontFamily = FontFamily.Serif,
                fontSize = if (largeTitle) 29.sp else 21.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.ink)
            TextButton(onClick = onAction) { Text(action, color = colors.ink) }
        }
        HorizontalDivider(color = colors.rule, thickness = .5.dp)
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun LibraryRow(paper: LibraryEntity, cached: Boolean, onLongClick: () -> Unit, onClick: () -> Unit) {
    val colors = LocalFractalColors.current
    Column(Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick)
        .padding(horizontal = 20.dp, vertical = 15.dp)) {
        Text(paper.title ?: paper.paperKey, fontFamily = FontFamily.Serif, fontSize = 17.sp,
            maxLines = 2, overflow = TextOverflow.Ellipsis, color = colors.ink)
        Text(shortAuthors(paper.authors), maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.inkSoft)
        Text(listOfNotNull(paper.venue, paper.year?.toString(), paper.addedAt.take(10),
            if (cached) stringResource(R.string.offline_indicator) else null).joinToString(" · "),
            color = colors.inkSoft, fontSize = 12.sp)
        HorizontalDivider(Modifier.padding(top = 14.dp), color = colors.rule, thickness = .5.dp)
    }
}

@Composable
private fun shortAuthors(authors: String): String {
    val names = authors.split(",").map(String::trim).filter(String::isNotEmpty)
    val first = names.take(2).joinToString(", ")
    return if (names.size > 2) stringResource(R.string.more_authors, first, names.size - 2) else first
}

@Composable
private fun SettingsScreen(app: ReaderApplication, theme: String, setTheme: (String) -> Unit, onBack: () -> Unit, onPair: () -> Unit) {
    val colors = LocalFractalColors.current
    val penTool = rememberInkToolState()
    var wifiOnly by remember { mutableStateOf(app.settings.getBoolean("wifiOnly", false)) }
    var autoDownload by remember { mutableStateOf(app.settings.getBoolean("autoDownload", false)) }
    var cacheGb by remember { mutableStateOf(app.settings.getLong("cacheLimit", 2L * 1024 * 1024 * 1024) / (1024 * 1024 * 1024)) }
    CompositionLocalProvider(LocalContentColor provides colors.ink) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Header(stringResource(R.string.settings), stringResource(R.string.done), onBack, onBack)
            Text(stringResource(R.string.hub), Modifier.padding(16.dp), color = colors.inkSoft)
            Text(app.credentials.load()?.let { "${it.name} · ${it.url}" } ?: stringResource(R.string.not_connected), Modifier.padding(horizontal = 16.dp))
            TextButton(onClick = onPair) { Text(stringResource(R.string.reconnect)) }
            TextButton(onClick = {
                app.credentials.clear()
                onPair()
            }) { Text(stringResource(R.string.disconnect)) }
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.sync), Modifier.padding(16.dp), color = colors.inkSoft)
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.wifi_only), Modifier.weight(1f))
                Switch(wifiOnly, {
                    wifiOnly = it
                    app.settings.edit().putBoolean("wifiOnly", it).apply()
                    SyncScheduler.schedule(app, it)
                })
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.auto_download), Modifier.weight(1f))
                Switch(autoDownload, {
                    autoDownload = it
                    app.settings.edit().putBoolean("autoDownload", it).apply()
                })
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.pdf_storage), Modifier.weight(1f))
                listOf(1L, 2L, 4L).forEach { gb ->
                    TextButton(onClick = {
                        cacheGb = gb
                        val bytes = gb * 1024 * 1024 * 1024
                        app.settings.edit().putLong("cacheLimit", bytes).apply()
                        app.cache.limitBytes = bytes
                        app.cache.evict()
                    }) { Text(stringResource(R.string.storage_gb, gb), color = if (cacheGb == gb) colors.accent else colors.inkSoft) }
                }
            }
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.pen), Modifier.padding(16.dp), color = colors.inkSoft)
            Text(stringResource(R.string.spen_button), Modifier.padding(horizontal = 16.dp))
            Row {
                EraserMode.entries.forEach { mode ->
                    TextButton(onClick = { penTool.buttonEraserMode = mode }) {
                        Text(stringResource(if (mode == EraserMode.Stroke) R.string.stroke_eraser else R.string.partial_eraser),
                            color = if (penTool.buttonEraserMode == mode) colors.accent else colors.inkSoft)
                    }
                }
            }
            Text(stringResource(R.string.pen_hint), Modifier.padding(16.dp), color = colors.inkSoft)
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.view), Modifier.padding(16.dp), color = colors.inkSoft)
            Row {
                listOf("System", "Light", "Sepia", "Dark").forEach { item ->
                    TextButton(onClick = { setTheme(item) }) {
                        val label = when (item) {
                            "Light" -> R.string.theme_light
                            "Sepia" -> R.string.theme_sepia
                            "Dark" -> R.string.theme_dark
                            else -> R.string.theme_system
                        }
                        Text(stringResource(label), color = if (item == theme) colors.accent else colors.inkSoft)
                    }
                }
            }
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.language), Modifier.padding(16.dp), color = colors.inkSoft)
            var language by remember { mutableStateOf(app.settings.getString("appLanguage", LANGUAGE_SYSTEM) ?: LANGUAGE_SYSTEM) }
            Row {
                listOf(LANGUAGE_SYSTEM to R.string.language_system, "ko" to R.string.language_korean,
                    "en" to R.string.language_english).forEach { (tag, label) ->
                    TextButton(onClick = {
                        language = tag
                        setAppLanguage(app, tag, explicit = true)
                    }) { Text(stringResource(label), color = if (language == tag) colors.accent else colors.inkSoft) }
                }
            }
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.app_version), Modifier.padding(16.dp), color = colors.inkSoft)
        }
    }
}
