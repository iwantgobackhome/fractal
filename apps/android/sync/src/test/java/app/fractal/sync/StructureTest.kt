package app.fractal.sync

import app.fractal.data.WireJson
import org.testng.Assert.*
import org.testng.annotations.Test

class StructureTest {
    private fun parse(kind: String, x: Double = .1) = parsePaperStructure(WireJson.format.parseToJsonElement("""
        {"version":"v1","status":"ready","items":[{"id":"item","kind":"$kind","page":2,
        "bbox":{"x":$x,"y":0.2,"width":0.3,"height":0.4},"label":"Eq. 2","caption":"Energy","latex":"E=mc^2"}],
        "references":[],"markers":[]}
    """))
    @Test fun allKindsAndOptionalContextParse() {
        for (kind in listOf("figure", "table", "equation")) {
            val value = parse(kind)
            assertEquals(value.items.single().kind, kind)
            assertEquals(value.items.single().latex, "E=mc^2")
            assertEquals(value.items.single().bbox.width, .3)
        }
    }
    @Test fun pendingCanHaveNoItems() {
        val value = parsePaperStructure(WireJson.format.parseToJsonElement("""{"version":"v1","status":"pending"}"""))
        assertEquals(value.status, "pending"); assertTrue(value.items.isEmpty())
    }
    @Test fun invalidGeometryAndKindsRejected() {
        for (call in listOf({ parse("figure", .9) }, { parse("paragraph") })) {
            try { call(); fail("Invalid structure accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
