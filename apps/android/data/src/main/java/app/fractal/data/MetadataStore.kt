package app.fractal.data

import androidx.room.withTransaction
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull
fun JsonObject.revision(): Int = text("rev")?.toIntOrNull() ?: 0

/** Reapply intent, rather than replacing the complete remote record with a stale local copy. */
object MetadataMerge {
    private fun atLeastAsRecent(left: String, right: String): Boolean = runCatching {
        !Instant.parse(left).isBefore(Instant.parse(right))
    }.getOrElse { left >= right }
    fun apply(current: JsonObject, base: JsonObject, patch: JsonObject): JsonObject = buildJsonObject {
        for ((key, value) in current) put(key, value)
        for ((key, value) in patch) {
            if (key == "readProgress" && patch.text("lastReadAt") != null &&
                current.text("lastReadAt")?.let { atLeastAsRecent(it, patch.text("lastReadAt")!!) } == true) continue
            when (key) {
                "tags", "collections" -> {
                    fun values(obj: JsonObject) = (obj[key] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
                    val before = values(base).toSet()
                    val desired = (value as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
                    val removed = before - desired.toSet()
                    val added = desired.filterNot { it in before }
                    put(key, JsonArray((values(current).filterNot { it in removed } + added).distinct().map(::JsonPrimitive)))
                }
                "lastReadAt" -> {
                    val remote = current.text(key)
                    val local = (value as? JsonPrimitive)?.contentOrNull
                    put(key, if (remote != null && (local == null || atLeastAsRecent(remote, local))) JsonPrimitive(remote) else value)
                }
                else -> put(key, value)
            }
        }
    }

    fun rebase(current: JsonObject, mutation: MetadataMutation): JsonObject {
        val patch = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject
        val projected = apply(current, WireJson.format.parseToJsonElement(mutation.baseJson).jsonObject, patch)
        return JsonObject(patch.keys.associateWith { projected.getValue(it) })
    }
}

fun libraryEntity(value: JsonObject, previous: LibraryEntity?, dirty: Boolean): LibraryEntity {
    val record = WireJson.format.decodeFromString<LibraryRecord>(value.toString())
    return LibraryEntity(record.paperKey, record.title, record.authors.joinToString(", ") {
        listOf(it.given, it.family).filter(String::isNotBlank).joinToString(" ")
    }, record.year, record.venue, record.addedAt, record.updatedAt, record.status,
        previous?.pdfSha256, previous?.pageCount, dirty, value.toString(), record.saved,
        record.savedAt, record.lastReadAt, value["readProgress"]?.takeUnless { it is JsonNull }?.toString(), record.rev)
}

fun folderEntity(value: JsonObject) = FolderEntity(value.text("id")!!, value.text("name") ?: "",
    value.text("parentId"), value.text("deleted") == "true", value.revision(), value.text("updatedAt") ?: "", value.toString())
fun historyEntity(value: JsonObject) = HistoryEntity(value.text("id")!!, value.text("paperKey"),
    value.text("status") ?: "completed", value.text("deleted") == "true", value.revision(), value.text("updatedAt") ?: "", value.toString())

class MetadataStore(private val database: FractalDatabase, private val deviceId: () -> String) {
    private suspend fun enqueue(kind: String, id: String, base: JsonObject, patch: JsonObject) {
        val pending = database.metadata().pending()
        val sequence = maxOf(System.currentTimeMillis(), (pending.maxOfOrNull { it.createdAt } ?: 0) + 1)
        database.metadata().enqueue(MetadataMutation(UUID.randomUUID().toString(), kind, id,
            base.revision(), base.toString(), patch.toString(), deviceId(), sequence))
    }

    suspend fun patchPaper(key: String, patch: JsonObject) = database.withTransaction {
        val previous = database.library().get(key) ?: error("Paper is unavailable")
        val base = WireJson.format.parseToJsonElement(previous.json).jsonObject
        enqueue("paper", key, base, patch)
        val projected = MetadataMerge.apply(base, base, patch)
        database.library().upsert(libraryEntity(projected, previous, true))
    }

    suspend fun save(key: String, saved: Boolean) = patchPaper(key, buildJsonObject { put("saved", saved) })

    suspend fun read(key: String, page: Int, scrollOffset: Double = 0.0) = database.withTransaction {
        // A hard deletion can arrive while an already-open reader is disposing.
        if (database.library().get(key) == null) return@withTransaction
        patchPaper(key, buildJsonObject {
        require(page > 0)
        put("lastReadAt", java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now()))
        put("readProgress", buildJsonObject {
            put("page", page); put("scrollOffset", scrollOffset.coerceIn(0.0, 1.0))
        })
        })
    }

    suspend fun folder(name: String, parentId: String?, id: String = UUID.randomUUID().toString()): String {
        require(name.isNotBlank())
        database.withTransaction {
            val rows = database.metadata().folders().associateBy { it.id }
            require(rows[id]?.deleted != true) { "Deleted folder IDs cannot be reused" }
            if (parentId != null) {
                require(rows[parentId]?.deleted == false) { "Parent folder is unavailable" }
                val visited = mutableSetOf(id)
                var parent: String? = parentId
                while (parent != null) {
                    require(visited.add(parent)) { "A folder cannot contain itself" }
                    parent = rows[parent]?.parentId
                }
            }
            val base = rows[id]?.let { WireJson.format.parseToJsonElement(it.json).jsonObject }
                ?: buildJsonObject { put("id", id); put("rev", 0); put("deleted", false) }
            val patch = buildJsonObject { put("name", name.trim()); put("parentId", parentId?.let(::JsonPrimitive) ?: JsonNull) }
            enqueue("folder", id, base, patch)
            database.metadata().upsert(folderEntity(MetadataMerge.apply(base, base, patch)))
        }
        return id
    }

    suspend fun deleteFolder(id: String) = database.withTransaction {
        val row = database.metadata().folder(id) ?: return@withTransaction
        if (row.deleted) return@withTransaction
        val base = WireJson.format.parseToJsonElement(row.json).jsonObject
        val patch = buildJsonObject { put("deleted", true) }
        enqueue("folder", id, base, patch)
        database.metadata().upsert(folderEntity(MetadataMerge.apply(base, base, patch)))
        // The server performs the same promotion atomically; these are local projections only.
        for (child in database.metadata().folders().filter { !it.deleted && it.parentId == id }) {
            val json = WireJson.format.parseToJsonElement(child.json).jsonObject
            database.metadata().upsert(folderEntity(MetadataMerge.apply(json, json, buildJsonObject {
                put("parentId", row.parentId?.let(::JsonPrimitive) ?: JsonNull)
            })))
        }
        for (paper in database.library().all()) {
            val json = WireJson.format.parseToJsonElement(paper.json).jsonObject
            val memberships = (json["collections"] as? JsonArray) ?: continue
            if (memberships.any { it.jsonPrimitive.content == id }) {
                val projected = JsonObject(json + ("collections" to JsonArray(memberships.filterNot { it.jsonPrimitive.content == id })))
                database.library().upsert(libraryEntity(projected, paper, paper.dirty))
            }
        }
    }

    suspend fun settledHistory(entry: JsonObject) = database.withTransaction {
        require(entry.text("status") !in listOf("pending", "running")) { "Active generation is owned by the hub" }
        require(entry.text("kind") != "conversation") { "Conversation history is owned by the hub chat API" }
        val id = entry.text("id") ?: error("History ID is required")
        val existing = database.metadata().history(id)
        require(existing?.status !in listOf("pending", "running"))
        val base = existing?.let { WireJson.format.parseToJsonElement(it.json).jsonObject } ?: buildJsonObject { put("rev", 0) }
        enqueue("history", id, base, entry)
        database.metadata().upsert(historyEntity(entry))
    }
}
