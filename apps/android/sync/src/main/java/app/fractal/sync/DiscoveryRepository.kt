package app.fractal.sync

import app.fractal.data.*
import androidx.room.withTransaction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

fun discoveryScope(credentials: HubCredentials?): String = credentials?.let {
    // Hub identity, not credentials, belongs in resource keys. Never serialize tokens.
    val identity = it.hubId.ifBlank { it.url.trimEnd('/') }
    MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString("") { b -> "%02x".format(b) }
} ?: "unpaired"

fun DiscoveryPaper.bookmarkBody(): JsonObject = buildJsonObject {
    put("title", title); put("authors", JsonArray(authors.map(::JsonPrimitive))); put("url", url)
    doi?.let { put("doi", it) }; arxivId?.let { put("arxivId", it) }
    if (abstract.isNotBlank()) put("abstract", abstract)
    publication?.let { put("publication", WireJson.format.encodeToJsonElement(it)) }
}

/** UI-owned observations and durable intents never alter a consumed sync cursor. */
class DiscoveryRepository(private val db: FractalDatabase, private val client: HubDataClient,
    private val sync: SyncEngine, private val scope: () -> String) {
    private val mutex = Mutex()
    suspend fun cache(resource: String, value: JsonElement, capturedScope: String = scope()) {
        db.discovery().upsert(DiscoveryCacheEntity(capturedScope, resource, value.toString(), Instant.now().toString()))
    }
    suspend fun refresh(resource: String, path: String, method: String = "GET", body: JsonElement? = null): JsonElement {
        val captured = scope()
        val session = client.captured()
        check(scope() == captured) { "Hub changed before loading; refresh the current connection." }
        val value = session.data(path, method, body)
        check(scope() == captured) { "Hub changed while loading; refresh the current connection." }
        val retained = if (resource.startsWith("related:")) {
            val fresh = WireJson.format.decodeFromString<RelatedPapers>(value.toString())
            val old = db.discovery().get(captured, resource)?.let {
                runCatching { WireJson.format.decodeFromString<RelatedPapers>(it.json) }.getOrNull()
            }
            if (fresh.items.isEmpty() && fresh.status in listOf("unavailable", "stale", "partial") && !old?.items.isNullOrEmpty())
                WireJson.format.encodeToJsonElement(fresh.copy(items = old!!.items, source = old.source, fetchedAt = old.fetchedAt, status = "stale"))
            else value
        } else value
        cache(resource, retained, captured)
        return retained
    }
    suspend fun refreshFeed(force: Boolean = false) = refresh("feed", if (force) "/api/feed/refresh" else "/api/feed",
        if (force) "POST" else "GET", if (force) buildJsonObject {} else null)

    suspend fun enqueue(kind: String, resource: String, body: JsonObject) = db.withTransaction {
        val captured = scope()
        require(captured != "unpaired") { "Connect a Hub before creating discovery changes." }
        val previous = db.discovery().pending(captured).firstOrNull { it.kind == kind && it.resource == resource }
        db.discovery().upsert(DiscoveryIntent(previous?.id ?: UUID.randomUUID().toString(), captured, kind, resource,
            body.toString(), previous?.createdAt ?: System.currentTimeMillis()))
    }

    suspend fun follow(topic: FieldTopic, followed: Boolean) = enqueue("follow", topic.id, buildJsonObject {
        put("field", topic.field); put("followed", followed)
    })
    suspend fun createTopic(field: String, label: String, query: String) {
        require(label.trim().length in 2..100 && query.trim().length <= 200)
        enqueue("topic", UUID.randomUUID().toString(), buildJsonObject { put("field", field); put("label", label.trim()); put("query", query.trim().ifBlank { label.trim() }) })
    }
    suspend fun deleteTopic(topic: FieldTopic) {
        require(topic.origin == "user")
        enqueue("deleteTopic", topic.id, buildJsonObject { put("field", topic.field) })
    }
    suspend fun save(paper: DiscoveryPaper) = enqueue("bookmark", publicationFingerprint(paper), paper.bookmarkBody())

    /** One bounded pass; failed receipts remain reviewable. Topic POST ambiguity is reconciled first. */
    suspend fun flush(): List<String> = mutex.withLock {
        val captured = scope()
        val session = client.captured()
        suspend fun send(path: String, method: String = "GET", body: JsonElement? = null): JsonElement {
            check(scope() == captured) { "Hub connection changed; retained actions belong to the earlier Hub." }
            val response = session.data(path, method, body)
            check(scope() == captured) { "Hub changed while sending; reconnect to reconcile." }
            return response
        }
        val errors = mutableListOf<String>()
        for (sent in db.discovery().pending(captured).take(30)) {
            try {
                // Do not send an older selection after another local edit superseded it.
                check(scope() == captured) { "Hub connection changed; retained actions belong to the earlier Hub." }
                if (db.discovery().pending(captured).none { it.id == sent.id && it.bodyJson == sent.bodyJson }) continue
                val body = WireJson.format.parseToJsonElement(sent.bodyJson).jsonObject
                when (sent.kind) {
                    "fields" -> {
                        val response = send("/api/feed/interests").jsonObject
                        val current = response.getValue("interests").jsonObject
                        val add = body.getValue("add").jsonArray.map { it.jsonPrimitive.content }
                        val remove = body.getValue("remove").jsonArray.map { it.jsonPrimitive.content }.toSet()
                        val categories = current.getValue("categories").jsonArray.map { it.jsonPrimitive.content }
                        send("/api/feed/interests", "PUT", JsonObject(current + ("categories" to JsonArray(
                            (categories.filterNot { it in remove } + add).distinct().map(::JsonPrimitive)))))
                        refresh("interests", "/api/feed/interests")
                    }
                    "bookmark" -> {
                        val response = send("/api/library/bookmarks", "POST", body).jsonObject
                        val record = response["record"]?.jsonObject ?: error("Hub returned no bookmark record")
                        check(scope() == captured) { "Hub changed while admitting a bookmark; reconnect to reconcile." }
                        sync.acceptPaper(record)
                    }
                    "follow" -> {
                        send("/api/feed/topics/${HubClient.keyPath(sent.resource)}", "PUT", buildJsonObject { put("followed", body.getValue("followed")) })
                        refresh("topics:${body.text("field")}", "/api/feed/topics?field=${HubClient.keyPath(body.text("field")!!)}")
                    }
                    "topic" -> {
                        val field = body.text("field")!!
                        val remote = send("/api/feed/topics?field=${HubClient.keyPath(field)}")
                        val matches = WireJson.format.decodeFromString<TopicResponse>(remote.toString()).topics.filter {
                            it.origin == "user" && it.label == body.text("label") && it.query == body.text("query")
                        }
                        require(matches.size <= 1) { "More than one matching topic exists; review on the Hub before retrying." }
                        if (matches.isEmpty()) send("/api/feed/topics", "POST", body)
                        refresh("topics:$field", "/api/feed/topics?field=${HubClient.keyPath(field)}")
                    }
                    "deleteTopic" -> {
                        try { send("/api/feed/topics/${HubClient.keyPath(sent.resource)}", "DELETE") }
                        catch (error: HubHttpException) { if (error.code != 404) throw error }
                        refresh("topics:${body.text("field")}", "/api/feed/topics?field=${HubClient.keyPath(body.text("field")!!)}")
                    }
                    else -> error("Unsupported retained discovery action")
                }
                db.discovery().acknowledge(sent.id, sent.bodyJson)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                val message = error.message ?: "Hub unavailable"
                db.discovery().fail(sent.id, captured, sent.bodyJson, message)
                errors += message
                // Connection outages should not fan out into thirty failing requests.
                if (error is java.io.IOException && error !is HubHttpException) break
            }
        }
        errors
    }

    suspend fun translate(resource: String, texts: List<String>, target: String): JsonElement {
        require(texts.isNotEmpty() && texts.size <= 100 && texts.all { it.length in 1..10000 })
        return refresh(resource, "/api/translate/quick", "POST", buildJsonObject {
            put("texts", JsonArray(texts.map(::JsonPrimitive))); put("target", target); put("source", "auto"); put("allowAiFallback", false)
        })
    }
}
