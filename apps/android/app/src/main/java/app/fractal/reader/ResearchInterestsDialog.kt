package app.fractal.reader

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import app.fractal.data.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable internal fun ResearchInterestsDialog(app: ReaderApplication, cache: List<DiscoveryCacheEntity>,
    fields: List<TaxonomyField>, onDismiss: () -> Unit, onSave: () -> Unit) {
    val current = remember(cache) { cache.firstOrNull { it.resource == "interests" }?.let {
        WireJson.format.parseToJsonElement(it.json).jsonObject["interests"]?.jsonObject
    } }
    val before = remember(current) { current?.get("categories")?.jsonArray?.map { it.jsonPrimitive.content }?.toSet().orEmpty() }
    var selected by remember(before) { mutableStateOf(before) }
    var query by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val ko = LocalConfiguration.current.locales[0].language == "ko"
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = onDismiss, title = { Text(libraryText("Follow research fields", "관심 분야 팔로우")) }, text = {
        Column { OutlinedTextField(query, { query = it }, label = { Text(libraryText("Search taxonomy", "분류 검색")) })
            Text(libraryText("Existing custom interests, authors and topic queries are preserved. Up to 30 fields.", "기존 개인 관심 분야·저자·주제 검색어는 유지됩니다. 최대 30개 분야입니다."))
            LazyColumn(Modifier.heightIn(max = 360.dp)) { items(fields.filter { it.code.contains(query, true) || it.name.values.any { name -> name.contains(query, true) } }, key = { it.code }) { field ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Checkbox(field.code in selected, { checked -> selected = if (checked) selected + field.code else selected - field.code })
                    Text("${field.name[if (ko) "ko" else "en"] ?: field.code} · ${field.code}", Modifier.padding(vertical = 12.dp))
                }
            } }
            if (error.isNotBlank()) Text(error)
        }
    }, confirmButton = { TextButton(enabled = current != null && selected.size <= 30, onClick = { scope.launch {
        runCatching { app.discovery.enqueue("fields", "categories", buildJsonObject {
            put("add", JsonArray((selected - before).map(::JsonPrimitive))); put("remove", JsonArray((before - selected).map(::JsonPrimitive)))
        }) }.onSuccess { onSave() }.onFailure { error = it.message.orEmpty() }
    } }) { Text(libraryText("Save interests", "관심 분야 저장")) } }, dismissButton = { TextButton(onClick = onDismiss) { Text(libraryText("Cancel", "취소")) } })
}
