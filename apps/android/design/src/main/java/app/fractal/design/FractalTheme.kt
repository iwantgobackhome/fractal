package app.fractal.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.Shapes
import androidx.compose.material3.LocalContentColor
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
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
    val inverse = if (theme == PaperTheme.Dark) FractalTokens.lightColors else FractalTokens.darkColors
    val scheme = (if (theme == PaperTheme.Dark) darkColorScheme() else lightColorScheme()).copy(
        primary = colors.accent, onPrimary = colors.accentInk,
        primaryContainer = colors.accentWash, onPrimaryContainer = colors.accent,
        inversePrimary = inverse.accent,
        secondary = colors.focus, onSecondary = colors.accentInk,
        secondaryContainer = colors.sunken, onSecondaryContainer = colors.focus,
        tertiary = colors.inkSoft, onTertiary = colors.paper,
        tertiaryContainer = colors.sunken, onTertiaryContainer = colors.ink,
        background = colors.paper, onBackground = colors.ink,
        surface = colors.surface, onSurface = colors.ink,
        surfaceVariant = colors.sunken, onSurfaceVariant = colors.inkSoft,
        surfaceTint = Color.Transparent, inverseSurface = inverse.paper, inverseOnSurface = inverse.ink,
        error = colors.danger, onError = colors.accentInk,
        errorContainer = colors.accentWash, onErrorContainer = colors.danger,
        outline = colors.ruleStrong, outlineVariant = colors.rule, scrim = colors.scrim,
        surfaceBright = colors.surface, surfaceDim = colors.sunken,
        surfaceContainer = colors.surface, surfaceContainerHigh = colors.sunken,
        surfaceContainerHighest = colors.sunken, surfaceContainerLow = colors.paper,
        surfaceContainerLowest = colors.paper,
    )
    CompositionLocalProvider(LocalFractalColors provides colors) {
        val type = Typography(
            bodyLarge = TextStyle(fontFamily = ScholarlySans, fontSize = 16.sp, lineHeight = 24.sp),
            bodyMedium = TextStyle(fontFamily = ScholarlySans, fontSize = 14.sp, lineHeight = 21.sp),
            bodySmall = TextStyle(fontFamily = ScholarlySans, fontSize = 12.sp, lineHeight = 18.sp),
            labelLarge = TextStyle(fontFamily = ScholarlySans, fontSize = 14.sp, lineHeight = 20.sp),
            titleLarge = TextStyle(fontFamily = ScholarlySerif, fontSize = 24.sp, lineHeight = 30.sp),
            headlineLarge = TextStyle(fontFamily = ScholarlySerif, fontSize = 30.sp, lineHeight = 36.sp),
        )
        val shapes = Shapes(RoundedCornerShape(2.dp), RoundedCornerShape(2.dp), RoundedCornerShape(2.dp),
            RoundedCornerShape(4.dp), RoundedCornerShape(4.dp))
        MaterialTheme(colorScheme = scheme, typography = type, shapes = shapes) {
            CompositionLocalProvider(LocalContentColor provides colors.ink, content = content)
        }
    }
}
