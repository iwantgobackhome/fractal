package app.fractal.ink

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged

private val Context.inkStore by preferencesDataStore("ink_tools")
private val TOOL = stringPreferencesKey("tool")
private val COLOR = stringPreferencesKey("color")
private val COLORS = stringPreferencesKey("colors")
private val WIDTHS = stringPreferencesKey("widths")
private val ERASER = stringPreferencesKey("eraser")
private val BUTTON = stringPreferencesKey("button_eraser")
private val SHAPE = stringPreferencesKey("shape")
private val RECENTS = stringPreferencesKey("recent_colors")

/** Use once at the app level; changes are persisted through Preferences DataStore. */
@Composable
fun rememberInkToolState(): InkToolState {
    val context = LocalContext.current.applicationContext
    val state = remember { InkToolState() }
    LaunchedEffect(context) {
        val initial = context.inkStore.data.first()
        state.active = migratedInkTool(initial[TOOL])
        state.loadColors(initial[COLORS] ?: "")
        if (initial[COLORS] == null && initial[COLOR] != null) state.color = initial[COLOR]!!
        state.loadWidths(initial[WIDTHS] ?: "")
        state.eraserMode = runCatching { EraserMode.valueOf(initial[ERASER] ?: "") }.getOrDefault(EraserMode.Stroke)
        state.buttonEraserMode = runCatching { EraserMode.valueOf(initial[BUTTON] ?: "") }.getOrDefault(EraserMode.Stroke)
        state.shapeMode = runCatching { ShapeMode.valueOf(initial[SHAPE] ?: "") }.getOrDefault(ShapeMode.Line)
        state.recentColors = initial[RECENTS]?.split(",")?.filter { it.isNotEmpty() } ?: emptyList()
        snapshotFlow { listOf(state.active.name,state.colorsString(),state.widthsString(),state.eraserMode.name,state.buttonEraserMode.name,state.shapeMode.name,state.recentColors.joinToString(",")) }
            .distinctUntilChanged().collect { values ->
                context.inkStore.edit { prefs ->
                    prefs[TOOL] = values[0]; prefs[COLORS] = values[1]; prefs[WIDTHS] = values[2]
                    prefs[ERASER] = values[3]; prefs[BUTTON] = values[4]; prefs[SHAPE] = values[5]; prefs[RECENTS] = values[6]
                }
            }
    }
    return state
}

internal fun migratedInkTool(value: String?): InkTool =
    runCatching { InkTool.valueOf(value ?: "") }.getOrDefault(InkTool.Ballpoint)
