package app.fractal.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fractal.design.LocalFractalColors

@Composable
internal fun LanguageIntroScreen(app: ReaderApplication, onContinue: () -> Unit) {
    val colors = LocalFractalColors.current
    var selected by remember { mutableStateOf(LANGUAGE_SYSTEM) }
    var touched by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(colors.paper).padding(24.dp),
        verticalArrangement = Arrangement.Center) {
        Text(stringResource(R.string.language_intro_title), fontFamily = FontFamily.Serif,
            fontSize = 29.sp, color = colors.ink)
        Spacer(Modifier.height(10.dp))
        Text(stringResource(R.string.language_intro_subtitle), color = colors.inkSoft)
        Spacer(Modifier.height(28.dp))
        listOf(
            LANGUAGE_SYSTEM to R.string.language_system,
            "ko" to R.string.language_korean,
            "en" to R.string.language_english,
        ).forEach { (tag, label) ->
            Row(Modifier.fillMaxWidth().clickable { selected = tag; touched = true }
                .padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected == tag, onClick = { selected = tag; touched = true })
                Text(stringResource(label), color = colors.ink)
            }
        }
        Spacer(Modifier.height(24.dp))
        Button(onClick = {
            app.settings.edit().putBoolean("languageIntroDone", true).apply()
            onContinue()
            setAppLanguage(app, selected, explicit = touched)
        }) { Text(stringResource(R.string.continue_label)) }
    }
}
