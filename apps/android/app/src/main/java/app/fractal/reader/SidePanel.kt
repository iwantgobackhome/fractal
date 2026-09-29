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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.data.AnnotationEntity
import app.fractal.data.WireJson
import app.fractal.design.LocalFractalColors
import app.fractal.pdf.PdfPages
import app.fractal.sync.HubClient
import app.fractal.sync.SseParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Composable
fun SidePanel(
    app: ReaderApplication,
    paperKey: String,
    annotations: List<AnnotationEntity>,
    pages: PdfPages?,
    tab: String,
    onTabChange: (String) -> Unit,
    onJump: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalFractalColors.current
    val scope = rememberCoroutineScope()
    var question by remember { mutableStateOf("") }
    var answer by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var models by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(paperKey) {
        runCatching {
            val response = app.client.data("/api/ai/providers").jsonObject
            response["providers"]?.jsonArray?.flatMap { provider ->
                val id = provider.jsonObject["status"]?.jsonObject?.get("id")?.jsonPrimitive?.content ?: ""
                provider.jsonObject["models"]?.jsonArray?.map { item ->
                    id to (item.jsonObject["id"]?.jsonPrimitive?.content ?: "")
                } ?: emptyList()
            } ?: emptyList()
        }.onSuccess {
            models = it
            model = it.firstOrNull()?.second.orEmpty()
        }
    }
    CompositionLocalProvider(LocalContentColor provides colors.ink) { Column(modifier.background(colors.paper)) {
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = { onTabChange("notes") }) { Text("노트", color = if (tab == "notes") colors.ink else colors.inkSoft) }
            TextButton(onClick = { onTabChange("questions") }) { Text("질문", color = if (tab == "questions") colors.ink else colors.inkSoft) }
        }
        HorizontalDivider(color = colors.rule)
        if (tab == "notes") {
            LazyColumn(Modifier.fillMaxSize()) {
                items(annotations.filter { it.kind == "highlight" || it.kind == "memo" }, key = { it.id }) { row ->
                    val json = runCatching { WireJson.format.parseToJsonElement(row.json).jsonObject }.getOrNull()
                    Column(Modifier.fillMaxWidth().clickable { onJump(row.page) }.padding(16.dp)) {
                        Text("p.${row.page}", color = colors.inkSoft, fontSize = 12.sp)
                        val quote = json?.get("quote")?.jsonPrimitive?.content
                            ?: json?.get("text")?.jsonPrimitive?.content.orEmpty()
                        if (quote.isBlank() && row.kind == "highlight") {
                            Text("p.${row.page} 영역", color = colors.inkSoft, fontSize = 13.sp)
                            RegionThumbnail(pages, row.page, row.json)
                        } else {
                            Text(quote.ifBlank { "선택 영역" }, fontFamily = FontFamily.Serif)
                        }
                        json?.get("note")?.jsonPrimitive?.content?.takeIf { it != "null" }?.let {
                            Text(it, color = colors.inkSoft)
                        }
                    }
                    HorizontalDivider(color = colors.rule, thickness = .5.dp)
                }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                LazyColumn(Modifier.weight(1f)) {
                    item {
                        if (answer.isNotBlank()) {
                            Text(answer, Modifier.padding(16.dp), color = colors.ink)
                            Regex("""\[p\.(\d+)]""").findAll(answer).forEach { match ->
                                TextButton(onClick = { onJump(match.groupValues[1].toInt()) }) {
                                    Text(match.value)
                                }
                            }
                        }
                    }
                }
                if (app.credentials.load() == null) Text("질문하려면 허브가 필요합니다", Modifier.padding(16.dp), color = colors.inkSoft)
                Row(Modifier.fillMaxWidth()) {
                    models.forEach { (provider, name) ->
                        TextButton(onClick = { model = name }) {
                            Text(name, color = if (name == model) colors.accent else colors.inkSoft, fontSize = 12.sp)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth()) {
                    OutlinedTextField(question, { question = it }, label = { Text("질문") },
                        modifier = Modifier.weight(1f), maxLines = 3)
                    TextButton(enabled = !busy && question.isNotBlank(), onClick = {
                        val asked = question
                        question = ""
                        answer = ""
                        busy = true
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    val selection = models.firstOrNull { it.second == model }
                                    val body = buildJsonObject {
                                        put("question", asked)
                                        if (selection != null) {
                                            put("selection", buildJsonObject {
                                                put("provider", selection.first)
                                                put("model", selection.second)
                                            })
                                        }
                                    }
                                    app.client.execute("/api/papers/${HubClient.keyPath(paperKey)}/ask", "POST", body).use { response ->
                                        if (!response.isSuccessful) error("HTTP ${response.code}")
                                        val parser = SseParser()
                                        response.body?.charStream()?.buffered()?.forEachLine { line ->
                                            parser.consume(line)?.let { event ->
                                                if (event.type == "delta") answer += event.text
                                                if (event.type == "done") answer = event.text
                                            }
                                        }
                                    }
                                }
                            }.onFailure { answer = it.message ?: "질문 실패" }
                            busy = false
                        }
                    }) { Text("↗") }
                }
            }
        }
    } }
}

@Composable
private fun RegionThumbnail(pages: PdfPages?, page: Int, annotationJson: String) {
    var cropped by remember(pages, page, annotationJson) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(pages, page, annotationJson) {
        cropped = null
        if (pages == null || page !in 1..pages.pageCount) return@LaunchedEffect
        cropped = withContext(Dispatchers.IO) {
            runCatching {
                val rect = WireJson.format.parseToJsonElement(annotationJson).jsonObject["rects"]
                    ?.jsonArray?.firstOrNull()?.jsonObject ?: return@runCatching null
                fun number(key: String) = rect[key]?.jsonPrimitive?.content?.toFloatOrNull() ?: 0f
                val image = pages.bitmap(page - 1, 800)
                val x = ((number("x") - .08f).coerceIn(0f, 1f) * image.width).toInt()
                val y = ((number("y") - .015f).coerceIn(0f, 1f) * image.height).toInt()
                val right = ((number("x") + number("width") + .08f).coerceIn(0f, 1f) * image.width).toInt()
                val bottom = ((number("y") + number("height") + .015f).coerceIn(0f, 1f) * image.height).toInt()
                Bitmap.createBitmap(image, x, y, (right - x).coerceAtLeast(1), (bottom - y).coerceAtLeast(1))
            }.getOrNull()
        }
    }
    cropped?.let { image ->
        Image(image.asImageBitmap(), "p.$page 영역 미리보기",
            Modifier.padding(top = 6.dp).width(240.dp).height(64.dp), contentScale = ContentScale.Fit)
    }
}
