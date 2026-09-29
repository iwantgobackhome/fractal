package app.fractal.reader

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.fractal.data.LibraryEntity
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

class MainActivity : ComponentActivity() {
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
    var screen by remember { mutableStateOf(if (app.credentials.load() == null) "connect" else "library") }
    var activePaper by remember { mutableStateOf<LibraryEntity?>(null) }
    var menuPaper by remember { mutableStateOf<LibraryEntity?>(null) }
    var error by remember { mutableStateOf("") }
    val papers by app.database.library().observeAll().collectAsState(initial = emptyList())
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
            "connect" -> ConnectScreen(
                app = app,
                cameraGranted = cameraGranted,
                requestCamera = requestCamera,
                onConnected = {
                    SyncScheduler.now(app, app.settings.getBoolean("wifiOnly", false))
                    screen = "library"
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
                        Header("보관함", action = "설정", onAction = { screen = "settings" })
                        var search by remember { mutableStateOf("") }
                        var filter by remember { mutableStateOf("모든 논문") }
                        var refreshing by remember { mutableStateOf(false) }
                        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                            BasicTextField(
                                value = search,
                                onValueChange = { search = it },
                                singleLine = true,
                                textStyle = TextStyle(color = colors.ink, fontSize = 16.sp),
                                modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                decorationBox = { inner ->
                                    if (search.isEmpty()) Text("검색", color = colors.inkSoft)
                                    inner()
                                },
                            )
                            HorizontalDivider(Modifier.align(Alignment.BottomCenter), color = colors.rule, thickness = .5.dp)
                        }
                        Row {
                            listOf("모든 논문", "읽는 중", "오프라인 저장됨").forEach { name ->
                                TextButton(onClick = { filter = name }) {
                                    Text(name, color = if (filter == name) colors.ink else colors.inkSoft)
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
                                    (filter == "모든 논문" || filter == "읽는 중" && paper.status == "reading" ||
                                        filter == "오프라인 저장됨" && paper.pdfSha256?.let(app.cache::existing) != null)
                            }
                            items(visible, key = { it.paperKey }) { paper ->
                                LibraryRow(paper, paper.pdfSha256?.let(app.cache::existing) != null, onLongClick = { menuPaper = paper }) {
                                    activePaper = paper
                                    if (!expanded) screen = "reader"
                                }
                            }
                        }
                        }
                    }
                    if (expanded) {
                        Column(Modifier.width(400.dp).fillMaxHeight().border(BorderStroke(.5.dp, colors.rule)).padding(24.dp)) {
                            val paper = activePaper
                            if (paper != null) {
                                Text(paper.title.orEmpty(), fontFamily = FontFamily.Serif, fontSize = 25.sp)
                                Spacer(Modifier.height(16.dp))
                                Text(paper.authors, color = colors.inkSoft)
                                Text(listOfNotNull(paper.venue, paper.year?.toString()).joinToString(" · "), color = colors.inkSoft)
                                Spacer(Modifier.height(24.dp))
                                Button(onClick = { screen = "reader" }) { Text("읽기") }
                            }
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
                            ?: throw IllegalStateException("PDF unavailable")
                        app.downloader.download(paper.paperKey, metadata.first)
                    }.onFailure { error = it.message.orEmpty() }
                }
            }) { Text("오프라인 저장") }
            TextButton(onClick = {
                paper.pdfSha256?.let { app.cache.existing(it)?.delete() }
                menuPaper = null
            }) { Text("오프라인 저장 해제") }
            TextButton(onClick = {
                menuPaper = null
                scope.launch {
                    runCatching {
                        app.client.data("/api/library/${HubClient.keyPath(paper.paperKey)}", "DELETE")
                        app.database.library().delete(paper.paperKey)
                    }.onFailure { error = it.message.orEmpty() }
                }
            }) { Text("논문 삭제") }
        }
    }
}

@Composable
fun Header(title: String, action: String, onAction: () -> Unit, onBack: (() -> Unit)? = null) {
    val colors = LocalFractalColors.current
    Column {
        Row(Modifier.fillMaxWidth().height(if (title == "보관함") 64.dp else 48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) TextButton(onClick = onBack) { Text("‹", fontSize = 28.sp) }
            Text(title, modifier = Modifier.weight(1f), fontFamily = FontFamily.Serif,
                fontSize = if (title == "보관함") 29.sp else 21.sp,
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
        Text(paper.authors, maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.inkSoft)
        Text(listOfNotNull(paper.venue, paper.year?.toString(), paper.addedAt.take(10), if (cached) "↓" else null).joinToString(" · "),
            color = colors.inkSoft, fontSize = 12.sp)
        HorizontalDivider(Modifier.padding(top = 14.dp), color = colors.rule, thickness = .5.dp)
    }
}

@Composable
private fun SettingsScreen(app: ReaderApplication, theme: String, setTheme: (String) -> Unit, onBack: () -> Unit, onPair: () -> Unit) {
    val colors = LocalFractalColors.current
    val penTool = rememberInkToolState()
    var wifiOnly by remember { mutableStateOf(app.settings.getBoolean("wifiOnly", false)) }
    var autoDownload by remember { mutableStateOf(app.settings.getBoolean("autoDownload", false)) }
    var cacheGb by remember { mutableStateOf(app.settings.getLong("cacheLimit", 2L * 1024 * 1024 * 1024) / (1024 * 1024 * 1024)) }
    Column {
        Header("설정", "완료", onBack, onBack)
        Text("허브", Modifier.padding(16.dp), color = colors.inkSoft)
        Text(app.credentials.load()?.let { "${it.name} · ${it.url}" } ?: "연결되지 않음", Modifier.padding(horizontal = 16.dp))
        TextButton(onClick = onPair) { Text("다시 연결") }
        TextButton(onClick = {
            app.credentials.clear()
            onPair()
        }) { Text("연결 해제") }
        HorizontalDivider(color = colors.rule)
        Text("동기화", Modifier.padding(16.dp), color = colors.inkSoft)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Wi-Fi에서만 동기화", Modifier.weight(1f))
            Switch(wifiOnly, {
                wifiOnly = it
                app.settings.edit().putBoolean("wifiOnly", it).apply()
                SyncScheduler.schedule(app, it)
            })
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("열린 PDF 자동 다운로드", Modifier.weight(1f))
            Switch(autoDownload, {
                autoDownload = it
                app.settings.edit().putBoolean("autoDownload", it).apply()
            })
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("PDF 저장 공간", Modifier.weight(1f))
            listOf(1L, 2L, 4L).forEach { gb ->
                TextButton(onClick = {
                    cacheGb = gb
                    val bytes = gb * 1024 * 1024 * 1024
                    app.settings.edit().putLong("cacheLimit", bytes).apply()
                    app.cache.limitBytes = bytes
                    app.cache.evict()
                }) { Text("${gb}GB", color = if (cacheGb == gb) colors.accent else colors.inkSoft) }
            }
        }
        HorizontalDivider(color = colors.rule)
        Text("펜", Modifier.padding(16.dp), color = colors.inkSoft)
        Text("S Pen 버튼", Modifier.padding(horizontal = 16.dp))
        Row {
            EraserMode.entries.forEach { mode ->
                TextButton(onClick = { penTool.buttonEraserMode = mode }) {
                    Text(if (mode == EraserMode.Stroke) "획 지우개" else "부분 지우개",
                        color = if (penTool.buttonEraserMode == mode) colors.accent else colors.inkSoft)
                }
            }
        }
        Text("펜은 쓰고, 손가락은 스크롤합니다", Modifier.padding(16.dp), color = colors.inkSoft)
        HorizontalDivider(color = colors.rule)
        Text("보기", Modifier.padding(16.dp), color = colors.inkSoft)
        Row {
            listOf("System", "Light", "Sepia", "Dark").forEach { item ->
                TextButton(onClick = { setTheme(item) }) {
                    Text(item, color = if (item == theme) colors.accent else colors.inkSoft)
                }
            }
        }
        HorizontalDivider(color = colors.rule)
        Text("Fractal · 0.1", Modifier.padding(16.dp), color = colors.inkSoft)
    }
}
