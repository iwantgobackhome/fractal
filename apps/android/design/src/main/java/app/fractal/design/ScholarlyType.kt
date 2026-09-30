package app.fractal.design

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Typeface

val ScholarlySerif: FontFamily
    @Composable get() {
        val context = LocalContext.current
        return remember(context) {
            val font = android.graphics.fonts.Font.Builder(context.resources, R.font.source_serif_four).build()
            val family = android.graphics.fonts.FontFamily.Builder(font).build()
            val typeface = android.graphics.Typeface.CustomFallbackBuilder(family).setSystemFallback("serif").build()
            FontFamily(Typeface(typeface))
        }
    }
val ScholarlySans = FontFamily(Font(R.font.pretendard_variable))
