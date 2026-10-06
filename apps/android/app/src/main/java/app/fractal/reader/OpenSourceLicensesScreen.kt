package app.fractal.reader

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun OpenSourceLicensesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    BackHandler(onBack = onBack)
    val notices = produceState<List<Pair<String, String>>>(emptyList()) {
        value = withContext(Dispatchers.IO) {
            listOf("LICENSE", "THIRD_PARTY_NOTICES.md", "android-third-party.txt").flatMap { name ->
                val text = context.assets.open("licenses/$name").bufferedReader().use { it.readText() }
                listOf(name to "") + text.lineSequence().chunked(100).map { "" to it.joinToString("\n") }
            }
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text(stringResource(R.string.open_source_licenses))
        TextButton(onClick = onBack) { Text(stringResource(R.string.done)) }
        SelectionContainer {
            // Keep individual text layouts small even for large dependency lists.
            LazyColumn {
                items(notices.value) { (name, text) ->
                    if (name.isNotEmpty()) Text(name, Modifier.padding(vertical = 16.dp))
                    else Text(text, fontFamily = FontFamily.Monospace)
                }
            }
        }
    }
}
