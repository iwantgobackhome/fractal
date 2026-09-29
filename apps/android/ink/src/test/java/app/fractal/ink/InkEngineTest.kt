package app.fractal.ink

import org.testng.Assert.*
import org.testng.annotations.Test

class InkEngineTest {
    private fun p(x: Float, y: Float, t: Long = 0) = InkPoint(x,y,.5f,t)
    private fun stroke(points: List<InkPoint>) = InkStroke(
        id="5018b04e-39e2-4d70-8347-301db8a0364b",paperKey="doi:10.1234/test",
        updatedAt="2026-09-30T00:00:00Z",deviceId="tablet-1",page=2,color="#233F65",width=.003f,points=points,brush="ballpoint")

    @Test fun contractFixtureRoundTrip() {
        val fixture = """[{"id":"5018b04e-39e2-4d70-8347-301db8a0364b","paperKey":"doi:10.1234/test","updatedAt":"2026-09-30T00:00:00Z","deleted":false,"rev":0,"deviceId":"tablet-1","kind":"ink","page":2,"tool":"pen","color":"#233F65","width":0.003,"points":[[0.1,0.2,0.5,0],[0.3,0.4,0.8,16]],"brush":"ballpoint"}]"""
        val decoded = InkJson.decode(fixture)
        assertEquals(2, decoded[0].points.size)
        assertEquals(decoded,InkJson.decode(InkJson.encode(decoded)))
        assertEquals("pen",decoded[0].tool)
        assertEquals(.3f,decoded[0].points[1].x)
    }

    @Test fun partialEraserSplitsVectorInputs() {
        val original = stroke((0..100).map { p(it/100f,.5f,it.toLong()) })
        val pieces = splitStroke(original,listOf(p(.5f,.4f),p(.5f,.6f)),.02f)
        assertEquals(2,pieces.size)
        assertTrue(pieces[0].points.last().x < .5f)
        assertTrue(pieces[1].points.first().x > .5f)
        assertEquals(original.id, splitStroke(original,listOf(p(.8f,.8f)),.01f).single().id)
        val exported = eraseStrokes(listOf(original),listOf(p(.5f,.4f),p(.5f,.6f)),.02f,EraserMode.Partial)
        assertTrue(exported.first().deleted)
        assertEquals(2,exported.count { !it.deleted })
    }

    @Test fun undoRedoCoversTransformsAndDeletes() {
        val state = InkPageState()
        val original = stroke(listOf(p(.2f,.2f),p(.4f,.4f,10)))
        state.apply(listOf(original))
        state.select(setOf(original.id))
        state.transformSelection(.1f,.1f)
        assertEquals(.3f,state.strokes[0].points[0].x, .00001f)
        state.deleteSelection()
        assertTrue(state.strokes.single().deleted)
        assertTrue(state.undo()); assertEquals(.3f,state.strokes[0].points[0].x, .00001f)
        assertTrue(state.undo()); assertEquals(original,state.strokes[0])
        assertTrue(state.redo()); assertEquals(.3f,state.strokes[0].points[0].x, .00001f)
        assertTrue(state.redo()); assertTrue(state.strokes.single().deleted)
    }

    @Test fun buttonTemporaryEraser() {
        val button = PenButtonState()
        assertFalse(button.update(true,false,false))
        assertTrue(button.update(true,true,false))
        assertFalse(button.update(true,false,false))
        assertTrue(button.update(true,false,true))
        assertFalse(button.update(false,true,false))
    }

    @Test fun highlighterHasIndependentPaperColour() {
        val tool = InkToolState()
        assertEquals("#1C1B19",tool.color)
        tool.active = InkTool.Highlighter
        assertEquals("#F5DC6B",tool.color)
        tool.chooseColor("#A9D9A0")
        tool.active = InkTool.Ballpoint
        assertEquals("#1C1B19",tool.color)
        tool.active = InkTool.Highlighter
        assertEquals("#A9D9A0",tool.color)
    }

    @Test fun recognizesLineArrowRectangleEllipseTriangleAndKeepsScribble() {
        val line = (0..20).map { p(.1f+it*.03f,.2f+it*.01f,it.toLong()) }
        assertEquals("line",recognizeShape(line)?.type)
        val rect = buildList {
            for (i in 0..20) add(p(.2f+i*.02f,.2f))
            for (i in 1..20) add(p(.6f,.2f+i*.02f))
            for (i in 1..20) add(p(.6f-i*.02f,.6f))
            for (i in 1..20) add(p(.2f,.6f-i*.02f))
        }
        assertEquals("rectangle",recognizeShape(rect)?.type)
        val ellipse = (0..80).map { i -> p(.5f+.2f*kotlin.math.cos(i*2*kotlin.math.PI/80).toFloat(),.5f+.1f*kotlin.math.sin(i*2*kotlin.math.PI/80).toFloat()) }
        assertEquals("ellipse",recognizeShape(ellipse)?.type)
        fun segment(a: InkPoint,b: InkPoint) = (0..20).map { i -> p(a.x+(b.x-a.x)*i/20,a.y+(b.y-a.y)*i/20) }
        val a=p(.2f,.2f); val b=p(.8f,.2f); val c=p(.5f,.75f)
        val triangle = segment(a,b)+segment(b,c).drop(1)+segment(c,a).drop(1)
        assertEquals("triangle",recognizeShape(triangle)?.type)
        val tip=p(.8f,.5f); val wing1=p(.7f,.4f); val wing2=p(.7f,.6f)
        val arrow = segment(p(.15f,.5f),tip)+segment(tip,wing1).drop(1)+segment(wing1,tip).drop(1)+segment(tip,wing2).drop(1)
        assertEquals("arrow",recognizeShape(arrow)?.type)
        assertNull(recognizeShape(listOf(p(.1f,.1f),p(.9f,.8f),p(.2f,.7f),p(.7f,.1f))))
    }
}
