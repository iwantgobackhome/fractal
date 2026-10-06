package app.fractal.reader

import androidx.compose.ui.geometry.Offset
import app.fractal.pdf.*
import app.fractal.data.*
import kotlinx.serialization.json.*
import org.testng.Assert.*
import org.testng.annotations.Test

class AnswerCardPositionTest {
    @Test fun cardClampsAgainstItsMeasuredSize() {
        assertEquals(answerCardPosition(Offset(400f, 700f), 400f, 800f, 320f, 300f), Offset(80f, 500f))
        assertEquals(answerCardPosition(Offset(-20f, -20f), 200f, 200f, 320f, 300f), Offset.Zero)
        assertEquals(answerCardPosition(Offset(30f, 200f), 400f, 800f, 320f, 300f), Offset(30f, 200f))
    }
    @Test fun sourceQuadsSurviveLocalContextPersistence() {
        val quads = listOf(listOf(.1f to .2f, .4f to .2f, .4f to .24f, .1f to .24f))
        val selected = 1 to PdfTextSelection("selected line", listOf(PdfRect(.1f, .2f, .3f, .04f)), quads = quads)
        assertEquals(contextSelection(selectionContext(selected)), selected)
    }
    @Test fun followUpsShareOneMarkerAndUseRootSource() {
        fun entry(id: String, time: String, x: Float) = historyEntity(buildJsonObject {
            put("id", id); put("kind", "question"); put("createdAt", time)
            put("context", buildJsonObject { put("threadId", "root"); put("page", 1)
                put("rect", buildJsonObject { put("x", x); put("y", .2); put("width", .3); put("height", .04) })
            })
        })
        val pins = readerAnswerPins(emptyList(), listOf(entry("older", "01", .1f), entry("root", "02", .4f), entry("followup", "03", .8f)))
        assertEquals(pins.size, 1); assertEquals(pins.single().key, "root"); assertEquals(pins.single().rect.x, .4f)
    }

}
