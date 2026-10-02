package app.fractal.sync

import app.fractal.data.FractalDatabase
import app.fractal.data.DiscoveryCacheEntity
import app.fractal.data.WireJson
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.time.Instant

@Serializable data class StructureBox(val x: Double, val y: Double, val width: Double, val height: Double)
@Serializable data class StructureItem(val id: String, val kind: String, val page: Int, val bbox: StructureBox,
    val label: String = "", val caption: String = "", val latex: String? = null, val confidence: Double = 0.0)
@Serializable data class PaperStructure(val version: String, val status: String, val items: List<StructureItem> = emptyList())

fun parsePaperStructure(value: JsonElement): PaperStructure = WireJson.format.decodeFromString<PaperStructure>(value.toString()).also { structure ->
    require(structure.status in listOf("pending", "running", "ready", "failed"))
    require(structure.items.all { item ->
        val b = item.bbox
        item.id.isNotBlank() && item.kind in listOf("figure", "table", "equation") && item.page > 0 &&
            listOf(b.x, b.y, b.width, b.height).all { it.isFinite() } && b.x >= 0 && b.y >= 0 &&
            b.width > 0 && b.height > 0 && b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001
    }) { "Invalid structure geometry" }
}

/** Cached derived structure is scoped to the Hub and local PDF, never to pairing credentials. */
class StructureRepository(private val database: FractalDatabase, private val client: HubDataClient,
    private val scope: () -> String) {
    private fun resource(key: String, hash: String) = "structure:$key:$hash"
    suspend fun cached(key: String, hash: String): PaperStructure? = database.discovery().get(scope(), resource(key, hash))?.let {
        runCatching { parsePaperStructure(WireJson.format.parseToJsonElement(it.json)) }.getOrNull()
    }
    suspend fun retain(key: String, hash: String, value: JsonElement, capturedScope: String = scope()): PaperStructure {
        val parsed = parsePaperStructure(value)
        check(scope() == capturedScope) { "Hub changed while loading structure" }
        database.discovery().upsert(DiscoveryCacheEntity(capturedScope, resource(key, hash), value.toString(), Instant.now().toString()))
        return parsed
    }
    suspend fun load(key: String, hash: String, onUpdate: (PaperStructure) -> Unit) {
        cached(key, hash)?.let(onUpdate)
        val capturedScope = scope()
        if (capturedScope == "unpaired") return
        val session = client.captured()
        repeat(20) { attempt ->
            session.ensureCurrent()
            val value = session.data("/api/papers/${HubClient.keyPath(key)}/structure")
            session.ensureCurrent()
            val structure = retain(key, hash, value, capturedScope)
            onUpdate(structure)
            if (structure.status in listOf("ready", "failed")) return
            if (attempt < 19) delay(1500)
        }
    }
}
