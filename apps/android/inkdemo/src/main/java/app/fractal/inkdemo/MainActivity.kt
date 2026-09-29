package app.fractal.inkdemo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.fractal.design.FractalTheme
import app.fractal.design.LocalFractalColors
import app.fractal.ink.InkCanvas
import app.fractal.ink.InkPageState
import app.fractal.ink.InkPoint
import app.fractal.ink.InkStroke
import app.fractal.ink.InkToolbar
import app.fractal.ink.rememberInkToolState
import java.time.Instant
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { FractalTheme { Demo() } }
    }
}

@Composable
private fun Demo() {
    val colors = LocalFractalColors.current
    val state = remember { InkPageState() }
    val tool = rememberInkToolState()
    var pageSize by remember { mutableStateOf(Size.Zero) }
    var zoom by remember { mutableStateOf(1f) }
    var panX by remember { mutableStateOf(0f) }
    var panY by remember { mutableStateOf(0f) }
    BoxWithConstraints(Modifier.fillMaxSize().background(colors.sunken)) {
        val tablet = maxWidth >= 600.dp
        val availableHeight = maxHeight
        @Composable fun Paper() {
            BoxWithConstraints(
                Modifier.padding(16.dp).fillMaxWidth(if (tablet) 1f else 1f).aspectRatio(210f/297f)
                    .graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = panX; translationY = panY }
                    .background(Color.White).border(1.dp,colors.rule).onSizeChanged { pageSize = Size(it.width.toFloat(),it.height.toFloat()) }
            ) {
                InkCanvas(state,tool,Modifier.fillMaxSize(),pageSize,onFingerGesture = { dx,dy,factor ->
                    panX += dx*zoom; panY += dy*zoom; zoom = (zoom*factor).coerceIn(.5f,4f)
                })
            }
        }
        @Composable fun Controls() {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { state.load(emptyList()) }) { Text("Blank", color=colors.ink) }
                TextButton(onClick = { state.load(sampleStrokes()) }) { Text("Samples", color=colors.ink) }
            }
        }
        if (tablet) Row(Modifier.fillMaxSize()) {
            InkToolbar(state,tool,Modifier.width(58.dp).height(availableHeight))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { Controls(); Paper() }
        } else Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            InkToolbar(state,tool,Modifier.fillMaxWidth())
            Controls()
            Paper()
        }
    }
}

private fun sampleStrokes(): List<InkStroke> {
    val now = Instant.now().toString()
    fun line(y: Float, color: String, width: Float, brush: String, index: Int): InkStroke {
        val points = (0..100).map { i ->
            val x = .12f + i*.007f
            InkPoint(x, y + if (brush == "highlighter") 0f else .006f*sin(i/8.0).toFloat(), (.35f + .55f*sin(i/25.0).toFloat()).coerceIn(0f,1f),i*8L)
        }
        return InkStroke(paperKey="demo",page=1,deviceId="demo",updatedAt=now,color=color,width=width,
            tool=if (brush=="highlighter") "highlighter" else "pen",brush=brush,points=points)
    }
    return listOf(
        line(.16f,"#F5DC6B",.02f,"highlighter",0),
        line(.29f,"#1C1B19",.003f,"ballpoint",1),
        line(.42f,"#233F65",.004f,"fountain",2),
        line(.55f,"#75519C",.005f,"pencil",3),
        line(.68f,"#A2362A",.003f,"shape",4),
    )
}
