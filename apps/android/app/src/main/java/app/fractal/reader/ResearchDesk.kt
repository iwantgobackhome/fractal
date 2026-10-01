package app.fractal.reader

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fractal.data.*
import app.fractal.design.LocalFractalColors
import kotlinx.serialization.encodeToString

/** Four real destinations. Each nested index retains selection, filters and scroll on reader return. */
@Composable
internal fun ResearchDesk(app: ReaderApplication, onSettings: () -> Unit, onRead: (String) -> Unit) {
    var destination by rememberSaveable { mutableStateOf("library") }
    var relatedTrail by rememberSaveable { mutableStateOf(listOf<String>()) }
    val relatedHolder = rememberSaveableStateHolder()
    val holder = rememberSaveableStateHolder()
    val colors = LocalFractalColors.current
    val labels = listOf("discover" to libraryText("Discover", "발견"), "library" to libraryText("Library", "서재"),
        "news" to libraryText("News", "뉴스"), "topics" to libraryText("Topics", "주제"))
    BoxWithConstraints(Modifier.fillMaxSize().background(colors.paper)) {
        val phone = maxWidth < 600.dp
        val font = LocalConfiguration.current.fontScale.coerceAtLeast(1f)
        @Composable fun navigation(modifier: Modifier, horizontal: Boolean) {
            @Composable fun controls() {
                labels.forEach { (key, label) ->
                    TextButton(onClick = { destination = key; relatedTrail = emptyList() }, modifier = (if (horizontal) Modifier else Modifier.fillMaxWidth())
                        .heightIn(min = 48.dp).semantics { selected = destination == key },
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 12.dp)) {
                        Text(label, color = if (destination == key) colors.accent else colors.inkSoft)
                    }
                }
            }
            if (horizontal) Column(modifier.background(colors.paper).clipToBounds()) {
                // Give large-font phone labels room to remain complete words and keep all
                // four destinations visible without reducing the user's font preference.
                labels.chunked(if (font >= 1.5f) 2 else 4).forEach { row ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        row.forEach { (key, label) -> TextButton(onClick = { destination = key; relatedTrail = emptyList() }, modifier = Modifier.weight(1f)
                            .heightIn(min = 48.dp).semantics { selected = destination == key }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 12.dp)) {
                            Text(label, maxLines = 1, softWrap = false, color = if (destination == key) colors.accent else colors.inkSoft)
                        } }
                    }
                }
            }
            else Column(modifier.background(colors.paper).clipToBounds()) { controls() }
        }
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.weight(1f).clipToBounds()) {
                if (!phone) navigation(Modifier.width((94f * font).coerceAtMost(176f).dp).fillMaxHeight()
                    .verticalScroll(rememberScrollState()).border(.5.dp, colors.rule), false)
                Box(Modifier.weight(1f).fillMaxHeight().clipToBounds()) {
                    holder.SaveableStateProvider(destination) {
                        when (destination) {
                            "library" -> ScholarlyLibraryScreen(app, onSettings, onRead, embedded = true, onRelated = { paper ->
                                val record = WireJson.format.decodeFromString<LibraryRecord>(paper.json)
                                relatedTrail = listOf(WireJson.format.encodeToString(DiscoveryPaper(id = paper.paperKey,
                                    title = record.title ?: paper.paperKey, authors = record.authors.map { listOf(it.given, it.family).filter(String::isNotBlank).joinToString(" ") },
                                    abstract = record.abstract.orEmpty(), url = record.url ?: "https://doi.org/${record.doi.orEmpty()}",
                                    doi = record.doi, arxivId = record.arxivId, publication = record.publication,
                                    year = record.year, venue = record.venue)))
                            })
                            else -> DiscoveryScreen(app, destination, onSettings, onRead)
                        }
                    }
                    relatedTrail.lastOrNull()?.let { json ->
                        val paper = remember(json) { WireJson.format.decodeFromString<DiscoveryPaper>(json) }
                        relatedHolder.SaveableStateProvider(publicationFingerprint(paper)) {
                            PaperDiscoveryDetail(app, paper, { relatedTrail = relatedTrail.dropLast(1) }, onRead, onOpenPaper = {
                                relatedTrail = relatedTrail + WireJson.format.encodeToString(it)
                            })
                        }
                    }
                }
            }
            if (phone) navigation(Modifier.fillMaxWidth().heightIn(min = 64.dp).border(.5.dp, colors.rule), true)
        }
    }
}
