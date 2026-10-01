package app.fractal.sync

import androidx.room.withTransaction
import app.fractal.data.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

class SyncEngine(private val database: FractalDatabase, private val client: HubDataClient) {
    companion object { private val syncMutex = Mutex() }

    suspend fun saveLocal(value: JsonObject) {
        database.annotations().upsert(WireJson.annotationEntity(value, dirty = true))
    }

    /** Import direct bookmark/link responses through the same pending-edit projection as pulls. */
    suspend fun acceptPaper(record: JsonObject, guard: () -> Unit = {}) = database.withTransaction {
        guard()
        project("paper", record.text("paperKey") ?: error("Missing paper key"), record)
        guard()
    }

    private suspend fun project(kind: String, id: String, remote: JsonObject) {
        val pending = database.metadata().pending(kind, id)
        val key = "$kind:$id"
        val prior = database.metadata().authority(key)
        // A replayed successful receipt can predate a newer pulled revision.
        val authoritative = if (prior != null && prior.rev > remote.revision())
            WireJson.format.parseToJsonElement(prior.json).jsonObject else remote
        database.metadata().upsert(MetadataAuthority(key, authoritative.revision(), authoritative.toString()))
        var projected = authoritative
        for (mutation in pending) projected = MetadataMerge.apply(projected,
            WireJson.format.parseToJsonElement(mutation.baseJson).jsonObject,
            WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject)
        when (kind) {
            "paper" -> database.library().upsert(libraryEntity(projected, database.library().get(id), pending.isNotEmpty()))
            "folder" -> database.metadata().upsert(folderEntity(projected))
            "history" -> database.metadata().upsert(historyEntity(projected))
        }
    }

    private suspend fun projectFolderDeletions() {
        val folders = database.metadata().folders().associateBy { it.id }
        fun liveParent(id: String?): String? {
            var parent = id
            val seen = mutableSetOf<String>()
            while (parent != null && folders[parent]?.deleted == true && seen.add(parent)) parent = folders[parent]?.parentId
            return parent
        }
        for (folder in folders.values.filterNot { it.deleted }) {
            val parent = liveParent(folder.parentId)
            if (parent != folder.parentId) {
                val value = WireJson.format.parseToJsonElement(folder.json).jsonObject
                database.metadata().upsert(folderEntity(JsonObject(value + ("parentId" to (parent?.let(::JsonPrimitive) ?: JsonNull)))))
            }
        }
        val deleted = folders.values.filter { it.deleted }.map { it.id }.toSet()
        for (paper in database.library().all()) {
            val value = WireJson.format.parseToJsonElement(paper.json).jsonObject
            val memberships = value["collections"] as? JsonArray ?: continue
            val surviving = memberships.filterNot { it.jsonPrimitive.content in deleted }
            if (surviving.size != memberships.size) database.library().upsert(libraryEntity(
                JsonObject(value + ("collections" to JsonArray(surviving))), paper, paper.dirty))
        }
    }

    /** A pulled tombstone makes old membership intent invalid; supersede it with a fresh receipt. */
    private suspend fun rebaseDeletedMemberships() {
        val remoteDeleted = mutableMapOf<String, JsonObject>()
        for (folder in database.metadata().folders()) {
            val authority = database.metadata().authority("folder:${folder.id}") ?: continue
            val value = WireJson.format.parseToJsonElement(authority.json).jsonObject
            if (value.text("deleted") == "true") remoteDeleted[folder.id] = value
        }
        if (remoteDeleted.isEmpty()) return
        fun liveParent(id: String?): String? {
            var parent = id
            val visited = mutableSetOf<String>()
            while (parent != null && parent in remoteDeleted && visited.add(parent)) parent = remoteDeleted[parent]?.text("parentId")
            return parent
        }
        for (mutation in database.metadata().pending()) {
            val patch = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject
            if (mutation.kind == "folder" && mutation.entityId in remoteDeleted) {
                settleDeletedFolder(mutation, remoteDeleted.getValue(mutation.entityId))
                continue
            }
            val invalidMembership = mutation.kind == "paper" && (patch["collections"] as? JsonArray)?.any {
                it.jsonPrimitive.content in remoteDeleted
            } == true
            val invalidParent = mutation.kind == "folder" && patch.text("parentId") in remoteDeleted
            if (!invalidMembership && !invalidParent) continue
            val authority = database.metadata().authority("${mutation.kind}:${mutation.entityId}")
            val current = authority?.let { WireJson.format.parseToJsonElement(it.json).jsonObject }
                ?: WireJson.format.parseToJsonElement(mutation.baseJson).jsonObject
            val rebased = MetadataMerge.rebase(current, mutation).toMutableMap()
            if (invalidMembership) rebased["collections"] = JsonArray(rebased.getValue("collections").jsonArray.filterNot {
                it.jsonPrimitive.content in remoteDeleted
            })
            if (invalidParent) rebased["parentId"] = liveParent(patch.text("parentId"))?.let(::JsonPrimitive) ?: JsonNull
            database.metadata().acknowledge(mutation.requestId)
            database.metadata().enqueue(mutation.copy(requestId = UUID.randomUUID().toString(), baseRev = current.revision(),
                baseJson = current.toString(), patchJson = JsonObject(rebased).toString()))
            project(mutation.kind, mutation.entityId, current)
        }
    }

    private suspend fun settleDeletedFolder(mutation: MetadataMutation, current: JsonObject) {
        val patch = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject
        if (patch.text("deleted") != "true" || patch.size > 1) {
            val retained = buildJsonObject {
                put("requestId", mutation.requestId); put("baseRev", mutation.baseRev)
                put("base", WireJson.format.parseToJsonElement(mutation.baseJson)); put("patch", patch)
                put("deviceId", mutation.deviceId); put("createdAt", mutation.createdAt)
            }
            database.metadata().upsert(MetadataConflict(mutation.requestId, "folder", mutation.entityId,
                "remote-folder-deleted", retained.toString(), current.toString(), Instant.now().toString()))
        }
        // A tombstone is authoritative. Keep obsolete intent in the audit, rather than resurrecting its ID.
        database.metadata().acknowledge(mutation.requestId)
        project("folder", mutation.entityId, current)
    }

    suspend fun syncOnce(): Int = syncMutex.withLock {
        val before = database.syncState().cursor() ?: "0"
        val pull = client.data("/api/sync/pull?since=$before").jsonObject
        fun entries(name: String) = pull[name] as? JsonArray ?: JsonArray(emptyList())
        val papers = entries("papers")
        val annotations = entries("annotations")
        database.withTransaction {
            for (value in entries("folders")) value.jsonObject.let { project("folder", it.text("id")!!, it) }
            for (value in papers) value.jsonObject.let { project("paper", it.text("paperKey")!!, it) }
            for (value in entries("history")) value.jsonObject.let { project("history", it.text("id")!!, it) }
            for (value in annotations) {
                val remote = WireJson.annotationEntity(value.jsonObject, false)
                if (MergeRules.remoteWins(database.annotations().get(remote.id), remote)) database.annotations().upsert(remote)
            }
            for (value in entries("deletedPapers")) {
                val key = if (value is JsonObject) value.text("paperKey") else value.jsonPrimitive.content
                if (key != null) {
                    database.library().delete(key)
                    database.metadata().deleteSnapshot(key)
                    database.metadata().deletePaperMutations(key)
                }
            }
            rebaseDeletedMemberships()
            projectFolderDeletions()
            // Push heads are advisory: only the atomic pull snapshot advances consumption.
            database.syncState().upsert(SyncStateEntity(cursor = MergeRules.newerCursor(before, pull.text("cursor") ?: before)))
        }

        val dirty = database.annotations().dirty()
        val pending = database.metadata().pending().distinctBy { it.kind to it.entityId }
        if (dirty.isEmpty() && pending.isEmpty()) return@withLock papers.size + annotations.size
        val folders = mutableListOf<MetadataMutation>()
        val remaining = pending.filter { mutation ->
            if (mutation.kind != "folder") false
            else {
                val deleting = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject.text("deleted") == "true"
                // Settle older membership/child edits before deleting their required folder.
                !deleting || pending.none { other ->
                    other != mutation && (other.kind == "paper" || other.kind == "folder" &&
                        WireJson.format.parseToJsonElement(other.patchJson).jsonObject.text("parentId") == mutation.entityId)
                }
            }
        }.toMutableList()
        while (remaining.isNotEmpty()) {
            val next = remaining.firstOrNull { mutation ->
                val parent = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject.text("parentId")
                remaining.none { it.entityId == parent }
            } ?: error("Queued folder cycle")
            folders += next; remaining.remove(next)
        }
        fun envelope(mutation: MetadataMutation): JsonObject = buildJsonObject {
            put("baseRev", mutation.baseRev); put("requestId", mutation.requestId)
            val patch = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject
            when (mutation.kind) {
                "paper" -> { put("paperKey", mutation.entityId); put("patch", patch); put("deviceId", mutation.deviceId) }
                "folder" -> {
                    put("id", mutation.entityId); put("deviceId", mutation.deviceId)
                    put("patch", JsonObject(patch.filterKeys { it != "deleted" }))
                    if (patch["deleted"] != null) put("deleted", patch.getValue("deleted"))
                }
                "history" -> put("entry", buildJsonObject {
                    for ((key, value) in patch) put(key, value)
                    put("deviceId", mutation.deviceId)
                })
            }
        }
        val push = client.data("/api/sync/push", "POST", buildJsonObject {
            put("annotations", JsonArray(dirty.map {
                val original = WireJson.format.parseToJsonElement(it.json).jsonObject
                // Legacy Android ink encoded absent optional fields as null. The Hub
                // contract requires omission; keep stored bytes and ack comparison intact.
                if (original.text("kind") == "ink") JsonObject(original.filterNot { (key, value) ->
                    key in setOf("brush", "shape", "tilt") && value == JsonNull
                }) else original
            }))
            put("folders", JsonArray(folders.map(::envelope)))
            put("papers", JsonArray(pending.filter { it.kind == "paper" }.map(::envelope)))
            put("history", JsonArray(pending.filter { it.kind == "history" }.map(::envelope)))
        }).jsonObject
        database.withTransaction {
            for (result in (push["results"] as? JsonArray ?: JsonArray(emptyList()))) {
                val row = result.jsonObject
                if (row.text("applied") != "true") continue
                val sent = dirty.firstOrNull { it.id == row.text("id") } ?: continue
                val rev = row.text("rev")?.toIntOrNull() ?: continue
                val updated = JsonObject(WireJson.format.parseToJsonElement(sent.json).jsonObject + ("rev" to JsonPrimitive(rev)))
                // Do not clear an annotation edited after this request was sent.
                database.annotations().markClean(sent.id, sent.json, updated.toString(), rev)
            }
            for (result in (push["metadataResults"] as? JsonArray ?: JsonArray(emptyList()))) {
                val row = result.jsonObject
                val sent = pending.firstOrNull { it.kind == row.text("kind") && it.entityId == row.text("id") } ?: continue
                val current = row["current"] as? JsonObject ?: continue
                if (row.text("applied") == "true") {
                    database.metadata().acknowledge(sent.requestId)
                    project(sent.kind, sent.entityId, current)
                } else if (row.text("conflict") == "true") {
                    if (sent.kind == "history" && current.text("status") in listOf("pending", "running")) continue
                    if (current.text("deleted") == "true") {
                        if (sent.kind == "folder") settleDeletedFolder(sent, current)
                        continue
                    }
                    val latest = database.metadata().authority("${sent.kind}:${sent.entityId}")
                        ?.takeIf { it.rev > current.revision() }?.let { WireJson.format.parseToJsonElement(it.json).jsonObject } ?: current
                    val rebased = MetadataMerge.rebase(latest, sent)
                    database.metadata().acknowledge(sent.requestId)
                    database.metadata().enqueue(sent.copy(requestId = UUID.randomUUID().toString(),
                        baseRev = latest.revision(), baseJson = latest.toString(), patchJson = rebased.toString()))
                    project(sent.kind, sent.entityId, current)
                }
            }
            // Older hubs omit metadataResults. Keep the queue for a compatible reconnect.
            projectFolderDeletions()
        }
        papers.size + annotations.size + dirty.size + pending.size
    }

    suspend fun refreshPaperMetadata(key: String, session: HubDataClient = client, guard: () -> Unit = {}): Pair<String, Int>? {
        guard()
        val snapshot = session.data("/api/papers/${HubClient.keyPath(key)}").jsonObject
        val paper = snapshot["paper"]?.jsonObject ?: return null
        val sha = paper.text("pdfSha256") ?: return null
        val pages = paper.text("pageCount")?.toIntOrNull()
        database.withTransaction {
            guard()
            database.metadata().upsert(SnapshotEntity(key, snapshot.toString(), Instant.now().toString()))
            database.library().setPdf(key, sha, pages)
            guard()
        }
        return sha to (pages ?: 0)
    }
}
