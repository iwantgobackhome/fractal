package app.fractal.reader

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import app.fractal.ink.ReaderInputHost
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.fractal.design.ResearchSelector
import app.fractal.design.FractalTheme
import app.fractal.design.LocalFractalColors
import app.fractal.design.PaperTheme
import app.fractal.sync.SyncScheduler
import app.fractal.ink.EraserMode
import app.fractal.ink.rememberInkToolState
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    override fun setContentView(view: View?, params: ViewGroup.LayoutParams?) {
        if (view == null || view is ReaderInputHost) super.setContentView(view, params)
        else super.setContentView(ReaderInputHost(this).apply {
            addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }, params)
    }
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
internal fun ReaderApp(
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
            else -> "library"
        })
    }
    var activePaperKey by rememberSaveable { mutableStateOf<String?>(null) }
    val libraryState = rememberSaveableStateHolder()
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
    Column(Modifier.fillMaxSize().background(colors.paper)) {
        when (screen) {
            "language" -> LanguageIntroScreen(app) { screen = "connect" }
            "connect" -> ConnectScreen(
                app = app,
                cameraGranted = cameraGranted,
                requestCamera = requestCamera,
                onBrowseCached = if (papers.isNotEmpty()) ({ screen = "library" }) else null,
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
            else -> libraryState.SaveableStateProvider("library") { ResearchDesk(app, onSettings = { screen = "settings" }, onRead = {
                activePaperKey = it
                screen = "reader"
            }) }
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
            ResearchSelector(stringResource(R.string.pdf_storage), cacheGb.toString(), listOf(1L, 2L, 4L).map { it.toString() to stringResource(R.string.storage_gb, it) }, {
                cacheGb = it.toLong()
                val bytes = cacheGb * 1024 * 1024 * 1024
                app.settings.edit().putLong("cacheLimit", bytes).apply()
                app.cache.limitBytes = bytes
                app.cache.evict()
            }, Modifier.padding(16.dp))
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.pen), Modifier.padding(16.dp), color = colors.inkSoft)
            Text(stringResource(R.string.spen_button), Modifier.padding(horizontal = 16.dp))
            ResearchSelector(stringResource(R.string.spen_button), penTool.buttonEraserMode.name,
                EraserMode.entries.map { it.name to stringResource(if (it == EraserMode.Stroke) R.string.stroke_eraser else R.string.partial_eraser) },
                { penTool.buttonEraserMode = EraserMode.valueOf(it) }, Modifier.padding(16.dp))
            Text(stringResource(R.string.pen_hint), Modifier.padding(16.dp), color = colors.inkSoft)
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.view), Modifier.padding(16.dp), color = colors.inkSoft)
            ResearchSelector(stringResource(R.string.view), theme, listOf("System" to R.string.theme_system, "Light" to R.string.theme_light,
                "Sepia" to R.string.theme_sepia, "Dark" to R.string.theme_dark).map { it.first to stringResource(it.second) }, setTheme, Modifier.padding(16.dp))
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.language), Modifier.padding(16.dp), color = colors.inkSoft)
            var language by remember { mutableStateOf(app.settings.getString("appLanguage", LANGUAGE_SYSTEM) ?: LANGUAGE_SYSTEM) }
            ResearchSelector(stringResource(R.string.language), language, listOf(LANGUAGE_SYSTEM to R.string.language_system, "ko" to R.string.language_korean,
                "en" to R.string.language_english).map { it.first to stringResource(it.second) }, {
                language = it
                setAppLanguage(app, it, explicit = true)
            }, Modifier.padding(16.dp))
            HorizontalDivider(color = colors.rule)
            Text(stringResource(R.string.app_version), Modifier.padding(16.dp), color = colors.inkSoft)
        }
    }
}
