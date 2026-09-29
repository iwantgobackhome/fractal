package app.fractal.sync

import androidx.room.withTransaction
import app.fractal.data.AnnotationEntity
import app.fractal.data.FractalDatabase
import app.fractal.data.LibraryEntity
import app.fractal.data.LibraryRecord
import app.fractal.data.MergeRules
import app.fractal.data.SyncStateEntity
import app.fractal.data.WireJson
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class SyncEngine(
    private val database: FractalDatabase,
    private val client: HubClient,
) {
    suspend fun saveLocal(value: JsonObject) {
        database.annotations().upsert(WireJson.annotationEntity(value, dirty = true))
    }

    suspend fun syncOnce(): Int {
        val before = database.syncState().cursor() ?: "0"
        val pull = client.data("/api/sync/pull?since=$before").jsonObject
        val papers = pull["papers"]?.jsonArray ?: JsonArray(emptyList())
        val annotations = pull["annotations"]?.jsonArray ?: JsonArray(emptyList())
        val pulledCursor = pull["cursor"]?.jsonPrimitive?.content ?: before

        database.withTransaction {
            for (value in papers) {
                val wire = WireJson.format.decodeFromString<LibraryRecord>(value.toString())
                val previous = database.library().get(wire.paperKey)
                database.library().upsert(
                    LibraryEntity(
                        paperKey = wire.paperKey,
                        title = wire.title,
                        authors = wire.authors.joinToString(", ") { it.family },
                        year = wire.year,
                        venue = wire.venue,
                        addedAt = wire.addedAt,
                        updatedAt = wire.updatedAt,
                        status = wire.status,
                        pdfSha256 = previous?.pdfSha256,
                        pageCount = previous?.pageCount,
                        dirty = previous?.dirty ?: false,
                        json = value.toString(),
                    )
                )
            }
            for (value in annotations) {
                val remote = WireJson.annotationEntity(value.jsonObject, dirty = false)
                val local = database.annotations().get(remote.id)
                if (MergeRules.remoteWins(local, remote)) {
                    database.annotations().upsert(remote)
                }
            }
            database.syncState().upsert(
                SyncStateEntity(cursor = MergeRules.newerCursor(before, pulledCursor))
            )
        }

        val dirty = database.annotations().dirty()
        if (dirty.isEmpty()) return papers.size + annotations.size
        val outgoing = JsonArray(dirty.map { WireJson.format.parseToJsonElement(it.json) })
        val push = client.data(
            "/api/sync/push",
            "POST",
            buildJsonObject { put("annotations", outgoing) },
        ).jsonObject
        val results = push["results"]?.jsonArray ?: JsonArray(emptyList())
        database.withTransaction {
            for (result in results) {
                val row = result.jsonObject
                if (row["applied"]?.jsonPrimitive?.content != "true") continue
                val id = row["id"]?.jsonPrimitive?.content ?: continue
                val previous = dirty.firstOrNull { it.id == id } ?: continue
                val rev = row["rev"]?.jsonPrimitive?.content?.toIntOrNull() ?: continue
                val updated = buildJsonObject {
                    for ((key, value) in WireJson.format.parseToJsonElement(previous.json).jsonObject) {
                        put(key, value)
                    }
                    put("rev", rev)
                }
                database.annotations().markClean(id, previous.json, updated.toString(), rev)
            }
            val cursor = push["cursor"]?.jsonPrimitive?.content ?: pulledCursor
            val current = database.syncState().cursor() ?: before
            database.syncState().upsert(
                SyncStateEntity(cursor = MergeRules.newerCursor(current, cursor))
            )
        }
        return papers.size + annotations.size + dirty.size
    }

    suspend fun refreshPaperMetadata(key: String): Pair<String, Int>? {
        val path = HubClient.keyPath(key)
        val snapshot = client.data("/api/papers/$path").jsonObject
        val paper = snapshot["paper"]?.jsonObject ?: return null
        val sha = paper["pdfSha256"]?.jsonPrimitive?.content ?: return null
        if (sha == "null") return null
        val pages = paper["pageCount"]?.jsonPrimitive?.content?.toIntOrNull()
        database.library().setPdf(key, sha, pages)
        return sha to (pages ?: 0)
    }
}
