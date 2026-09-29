package app.fractal.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

enum class PaperTheme { Light, Sepia, Dark }
val LocalFractalColors = staticCompositionLocalOf { FractalTokens.lightColors }

@Composable
fun FractalTheme(theme: PaperTheme = PaperTheme.Light, content: @Composable () -> Unit) {
    val colors = when (theme) {
        PaperTheme.Light -> FractalTokens.lightColors
        PaperTheme.Sepia -> FractalTokens.sepiaColors
        PaperTheme.Dark -> FractalTokens.darkColors
    }
    val scheme = if (theme == PaperTheme.Dark) darkColorScheme(primary = colors.accent, background = colors.paper, surface = colors.surface, onSurface = colors.ink)
        else lightColorScheme(primary = colors.accent, background = colors.paper, surface = colors.surface, onSurface = colors.ink)
    CompositionLocalProvider(LocalFractalColors provides colors) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
