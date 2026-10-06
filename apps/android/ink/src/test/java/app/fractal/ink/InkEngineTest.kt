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
        assertTrue(state.undo()); assertEquals(original.points,state.strokes[0].points)
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
    @Test fun legacySelectionToolMigratesToPen() {
        assertEquals(migratedInkTool("TextSelection"),InkTool.Ballpoint)
        assertEquals(migratedInkTool("unknown"),InkTool.Ballpoint)
        assertEquals(migratedInkTool(null),InkTool.Ballpoint)
        assertEquals(migratedInkTool("Pencil"),InkTool.Pencil)
    }
    @Test fun eraserUsesOnePixelRadiusOnNonSquarePages() {
        assertEquals(eraserRadiusPx(.02f,1000f),10f)
        val inside = stroke(listOf(p(.5f,.504f),p(.51f,.504f)))
        val outside = inside.copy(id="outside",points=listOf(p(.5f,.51f),p(.51f,.51f)))
        val result = eraseStrokesOnPage(listOf(inside,outside),listOf(p(.5f,.5f)),.02f,1000f,2000f,EraserMode.Stroke)
        assertTrue(result[0].deleted); assertFalse(result[1].deleted)
    }
    @Test fun liveEraseIsOneUndoGestureAndCancelRestoresInk() {
        val state = InkPageState(); val original = stroke(listOf(p(.1f,.1f),p(.2f,.2f)))
        state.load(listOf(original)); var changes = 0; state.onChange = { changes++ }
        state.beginGesture(); state.previewGesture(listOf(original.copy(deleted=true)))
        assertTrue(state.strokes.single().deleted); assertEquals(changes,0)
        state.finishGesture(false); assertEquals(state.strokes,listOf(original)); assertFalse(state.undo())
        state.beginGesture(); state.previewGesture(listOf(original.copy(deleted=true))); state.finishGesture(true)
        assertEquals(changes,1); assertTrue(state.undo()); assertEquals(state.strokes.single().points,original.points); assertFalse(state.undo())
    }

    @Test fun groupPreviewUsesOriginalPositionsAndOneUndoEntry() {
        val a = stroke(listOf(p(.2f,.2f),p(.3f,.3f)))
        val b = a.copy(id="second",points=listOf(p(.4f,.4f),p(.5f,.5f)))
        val state = InkPageState(); state.load(listOf(a,b)); state.select(setOf(a.id,b.id))
        var changes = 0; state.onChange = { changes++ }
        state.beginGesture(); state.previewSelectionTransform(.05f,.06f); state.previewSelectionTransform(.1f,.12f)
        assertEquals(changes,0)
        state.strokes.zip(listOf(a,b)).forEach { (moved, original) ->
            assertEquals(moved.points.first().x-original.points.first().x,.1f,.00001f)
            assertEquals(moved.points.first().y-original.points.first().y,.12f,.00001f)
        }
        state.finishGesture(true); assertEquals(changes,1)
        assertTrue(state.undo()); assertFalse(state.undo())
        assertEquals(state.strokes.map { it.points },listOf(a,b).map { it.points })
    }
    @Test fun reconciliationIgnoresEchoPreservesSelectionAndDefersDuringGesture() {
        val a = stroke(listOf(p(.2f,.2f),p(.3f,.3f)))
        val b = a.copy(id="remote",updatedAt="2027-01-01T00:00:00Z")
        val state = InkPageState(); state.load(listOf(a)); state.select(setOf(a.id))
        state.transformSelection(.1f,0f)
        assertFalse(state.reconcile(state.strokes.reversed()))
        state.beginGesture(); state.previewSelectionTransform(.1f,0f)
        assertFalse(state.reconcile(listOf(a,b))); assertEquals(state.strokes.size,1)
        state.finishGesture(true); assertEquals(state.strokes.size,2)
        assertEquals(state.selectedIds,setOf(a.id))
        assertTrue(state.undo()); assertTrue(state.strokes.any { it.id == b.id })
        assertTrue(state.undo()); assertTrue(state.strokes.any { it.id == b.id })
    }
    @Test fun explicitShapesPreviewActualGeometryInEitherDragDirection() {
        val start = p(.7f,.8f); val end = p(.2f,.3f)
        val rectangle = explicitShape(start,end,ShapeMode.Rectangle)
        assertEquals(rectangle.type,"rectangle"); assertEquals(rectangle.points.size,5)
        assertEquals(rectangle.points.first(),rectangle.points.last())
        assertEquals(rectangle.points[0].x,.2f); assertEquals(rectangle.points[0].y,.3f)
        assertEquals(explicitShape(start,end,ShapeMode.Line).points,listOf(start,end))
        assertEquals(explicitShape(start,end,ShapeMode.Arrow).points.size,5)
        assertEquals(explicitShape(start,end,ShapeMode.Ellipse).points.size,49)
    }

    @Test fun reorderedEchoAndRemoteEditKeepLocalHistory() {
        val a = stroke(listOf(p(.2f,.2f),p(.3f,.3f)))
        val b = a.copy(id="remote")
        val state = InkPageState(); val initial = listOf(a,b); state.load(initial)
        assertFalse(state.reconcile(listOf(b,a))); assertTrue(state.strokes === initial)
        state.select(setOf(a.id)); state.transformSelection(.1f,.1f)
        val remote = b.copy(color="#FF0000",rev=1,updatedAt="2027-01-01T00:00:00Z")
        assertTrue(state.reconcile(listOf(remote,a)))
        assertEquals(state.selectedIds,setOf(a.id)); assertTrue(state.undo())
        assertEquals(state.strokes.first().points,a.points); assertEquals(state.strokes.last(),remote)
        assertTrue(a.sameDrawing(a.copy(rev=2,updatedAt="2027-01-01T00:00:00Z")))
        assertFalse(a.sameDrawing(a.copy(color="#FF0000")))
    }

    @Test fun groupTranslationStopsTogetherAtPageEdge() {
        val a = stroke(listOf(p(.2f,.2f),p(.3f,.3f)))
        val b = a.copy(id="right",points=listOf(p(.8f,.4f),p(.9f,.5f)))
        val state = InkPageState(); state.load(listOf(a,b)); state.select(setOf(a.id,b.id))
        state.beginGesture(); state.previewSelectionTransform(.4f,0f)
        state.strokes.zip(listOf(a,b)).forEach { (moved, original) ->
            assertEquals(moved.points.first().x-original.points.first().x,.1f,.00001f)
        }
        assertEquals(state.strokes[0].updatedAt,state.strokes[1].updatedAt)
    }

}
