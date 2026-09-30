package app.fractal.sync

import androidx.room.withTransaction
import app.fractal.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** Local submission intent is separate from Hub-owned generation and settled metadata imports. */
class HistoryRepository(private val database: FractalDatabase, private val client: HubHistoryClient,
    private val scope: CoroutineScope) {
    private val jobs = java.util.concurrent.ConcurrentHashMap<String, Job>()
    private val draftLock = Mutex()
    fun draftId(key: String) = "reader-draft:$key"

    suspend fun draft(key: String): JsonObject = database.reader().request(draftId(key))?.bodyJson
        ?.let { WireJson.format.parseToJsonElement(it).jsonObject } ?: JsonObject(emptyMap())

    fun saveDraft(key: String, patch: JsonObject) { scope.launch {
        draftLock.withLock {
            val old = draft(key)
            val value = JsonObject(old + patch)
            val now = Instant.now().toString()
            database.reader().upsert(AiRequestEntity(draftId(key), key, "draft", value.toString(), "{}", "draft", null, null, false, now, now))
        }
    } }

    suspend fun create(key: String, kind: String, body: JsonObject, context: JsonObject): String {
        require(kind in listOf("question", "explanation"))
        val id = UUID.randomUUID().toString(); val now = Instant.now().toString()
        val immutable = JsonObject(body + ("requestId" to JsonPrimitive(id)))
        database.reader().upsert(AiRequestEntity(id, key, kind, immutable.toString(), context.toString(), "queued", null, null, false, now, now))
        send(id)
        return id
    }
    @Synchronized fun send(id: String) {
        if (jobs[id]?.isActive == true) return
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try { dispatch(id) } finally { jobs.remove(id, coroutineContext[Job]) }
        }
        jobs[id] = job; job.start()
    }
    private suspend fun dispatch(id: String) {
        val row = database.reader().request(id) ?: return
        if (row.kind == "draft" || row.status == "done") return
        database.reader().upsert(row.copy(status = "sending", error = null, updatedAt = Instant.now().toString()))
        try {
            if (row.kind in listOf("cancel", "delete")) {
                val historyId = row.historyId ?: error("History identity is unavailable")
                val path = "/api/papers/${HubClient.keyPath(row.paperKey)}/history/${HubClient.keyPath(historyId)}"
                val response = try {
                    client.data(if (row.kind == "cancel") "$path/cancel" else path,
                        if (row.kind == "cancel") "POST" else "DELETE", if (row.kind == "cancel") JsonObject(emptyMap()) else null)
                } catch (error: HubHttpException) {
                    if (error.code != 404) throw error
                    null // An already deleted entry is also no longer generating.
                }
                (response as? JsonObject)?.get("history")?.let { cache(it.jsonObject) }
                database.reader().upsert(row.copy(status = "done", error = null, updatedAt = Instant.now().toString()))
            } else {
                val body = WireJson.format.parseToJsonElement(row.bodyJson).jsonObject
                val historyId = row.historyId ?: client.attachHistory(
                    "/api/papers/${HubClient.keyPath(row.paperKey)}/${if (row.kind == "explanation") "explain" else "ask"}", body)
                database.reader().upsert(row.copy(status = "attached", historyId = historyId, error = null, updatedAt = Instant.now().toString()))
                refresh(row.paperKey)
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            // Retain the immutable request/context and ID after ambiguous send failures.
            val latest = database.reader().request(id) ?: row
            database.reader().upsert(latest.copy(status = "failed", error = error.message, updatedAt = Instant.now().toString()))
        }
    }
    suspend fun action(key: String, historyId: String, kind: String): String {
        require(kind in listOf("cancel", "delete"))
        val existing = database.reader().requests(key).firstOrNull { it.kind == kind && it.historyId == historyId && it.status != "done" }
        if (existing != null) { send(existing.requestId); return existing.requestId }
        val id = UUID.randomUUID().toString(); val now = Instant.now().toString()
        database.reader().upsert(AiRequestEntity(id, key, kind, "{}", "{}", "queued", historyId, null, true, now, now))
        send(id); return id
    }
    /** Called on active UI/reconnect. No polling observer or stream survives closing the panel. */
    suspend fun refresh(key: String) {
        val values = client.data("/api/papers/${HubClient.keyPath(key)}/history").jsonObject["history"]?.jsonArray.orEmpty()
        database.withTransaction {
            for (value in values) {
                val record = value.jsonObject
                cache(record)
                val requestId = record.text("requestId")
                val local = requestId?.let { database.reader().request(it) }
                if (local != null) database.reader().upsert(local.copy(status = "attached", historyId = record.text("id"), error = null))
            }
        }
    }
    private suspend fun cache(remote: JsonObject) = database.withTransaction {
        val id = remote.text("id") ?: return@withTransaction
        val prior = database.metadata().history(id)
        if (prior != null && prior.rev > remote.revision()) return@withTransaction
        val authority = database.metadata().authority("history:$id")
        if (authority != null && authority.rev > remote.revision()) return@withTransaction
        database.metadata().upsert(MetadataAuthority("history:$id", remote.revision(), remote.toString()))
        var projected = remote
        for (mutation in database.metadata().pending("history", id)) projected = MetadataMerge.apply(projected,
            WireJson.format.parseToJsonElement(mutation.baseJson).jsonObject,
            WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject)
        database.metadata().upsert(historyEntity(projected))
    }
    suspend fun reconnect(key: String) {
        refresh(key)
        for (row in database.reader().requests(key)) if (row.status in listOf("queued", "sending", "failed")) send(row.requestId)
    }
}
