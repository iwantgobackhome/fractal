package app.fractal.reader

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ReaderHistoryRepositoryTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun record(request: String, rev: Int = 1, status: String = "running") = buildJsonObject {
        put("id", "retained-answer"); put("paperKey", "p"); put("requestId", request); put("kind", "question")
        put("question", "Complete selected context question"); put("text", if (status == "completed") "Retained answer [p.2]" else "Partial answer")
        put("status", status); put("createdAt", "2026-10-01T00:00:00Z"); put("updatedAt", "2026-10-01T00:00:01Z")
        put("completedAt", JsonNull); put("context", buildJsonObject { put("page", 2); put("selectedText", "😀 fi é") })
        put("answer", JsonNull); put("error", JsonNull); put("rev", rev); put("deviceId", "hub"); put("deleted", false)
    }
    @Test fun lostAdmissionResponseRetriesImmutableIdAndRetainsContextAcrossRepositoryRestart() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val ids = java.util.concurrent.CopyOnWriteArrayList<String>()
        var offline = true
        var current: JsonObject? = null
        val client = object : HubHistoryClient {
            override suspend fun attachHistory(path: String, body: JsonObject): String {
                val id = body["requestId"]!!.jsonPrimitive.content; ids += id
                current = record(id)
                if (offline) throw IOException("Lost response after durable admission")
                return "retained-answer"
            }
            override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
                if (offline) throw IOException("Hub unavailable")
                return buildJsonObject { put("history", JsonArray(listOfNotNull(current))) }
            }
        }
        try {
            val repo = HistoryRepository(db, client, scope)
            val id = repo.create("p", "question", buildJsonObject { put("question", "Complete selected context question"); put("page", 2); put("selectedText", "😀 fi é") }, buildJsonObject { put("text", "😀 fi é"); put("origin", "original"); put("page", 2) })
            withTimeout(5000) { while (db.reader().request(id)?.status != "failed") delay(20) }
            assertTrue(db.reader().request(id)!!.contextJson.contains("😀 fi é"))
            offline = false
            // A new repository has no surviving panel observer/job. Same intent remains in Room.
            HistoryRepository(db, client, scope).send(id)
            withTimeout(5000) { while (db.metadata().history("retained-answer") == null) delay(20) }
            assertEquals(listOf(id, id), ids.toList()); assertEquals("running", db.metadata().history("retained-answer")!!.status)
            current = record(id, 3, "completed")
            HistoryRepository(db, client, scope).refresh("p")
            assertTrue(db.metadata().history("retained-answer")!!.json.contains("Retained answer"))
            current = record(id, 2, "running")
            HistoryRepository(db, client, scope).refresh("p")
            assertEquals("completed", db.metadata().history("retained-answer")!!.status)
            assertEquals(3, db.metadata().authority("history:retained-answer")!!.rev)
            assertEquals("attached", db.reader().request(id)!!.status)
        } finally { scope.cancel(); db.close() }
    }

    @Test fun cropBytesStayOutOfRoomAndRetryRebuildsImageAfterRestart() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val sent = java.util.concurrent.CopyOnWriteArrayList<JsonObject>()
        var offline = true
        val client = object : HubHistoryClient {
            override suspend fun attachHistory(path: String, body: JsonObject): String {
                sent += body
                if (offline) throw IOException("Offline")
                return "retained-answer"
            }
            override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement =
                buildJsonObject { put("history", JsonArray(emptyList())) }
        }
        try {
            val body = buildJsonObject {
                put("question", "Figure 3 설명"); put("croppedPngBase64", "first-crop")
                put("attachment", buildJsonObject { put("label", "Figure 3"); put("page", 2) })
            }
            val id = HistoryRepository(db, client, scope).create("p", "question", body, JsonObject(emptyMap()))
            withTimeout(5000) { while (db.reader().request(id)?.status != "failed") delay(20) }
            assertFalse(db.reader().request(id)!!.bodyJson.contains("croppedPngBase64"))
            assertEquals("first-crop", sent.single()["croppedPngBase64"]!!.jsonPrimitive.content)
            offline = false
            HistoryRepository(db, client, scope) { _, retained ->
                assertEquals("Figure 3", retained["attachment"]!!.jsonObject["label"]!!.jsonPrimitive.content)
                "rebuilt-crop"
            }.send(id)
            withTimeout(5000) { while (db.reader().request(id)?.status != "attached") delay(20) }
            assertEquals("rebuilt-crop", sent.last()["croppedPngBase64"]!!.jsonPrimitive.content)
            assertEquals(sent.first()["requestId"], sent.last()["requestId"])
            assertFalse(db.reader().request(id)!!.bodyJson.contains("croppedPngBase64"))
        } finally { scope.cancel(); db.close() }
    }

    @Test fun closeDoesNotCancelExplicitCancelQueuesOfflineAndIsIdempotent() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        var offline = true; var cancels = 0
        val client = object : HubHistoryClient {
            override suspend fun attachHistory(path: String, body: JsonObject) = "retained-answer"
            override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
                if (offline) throw IOException("Offline")
                if (path.endsWith("/cancel")) { cancels++; return buildJsonObject { put("history", record("request", 2, "canceled")) } }
                return buildJsonObject { put("history", JsonArray(listOf(record("request")))) }
            }
        }
        try {
            db.metadata().upsert(historyEntity(record("request")))
            val repo = HistoryRepository(db, client, scope)
            assertEquals(0, cancels) // Retained history and repository construction perform no cancellation.
            val id = repo.action("p", "retained-answer", "cancel")
            withTimeout(5000) { while (db.reader().request(id)?.status != "failed") delay(20) }
            offline = false
            assertEquals(id, repo.action("p", "retained-answer", "cancel"))
            withTimeout(5000) { while (db.reader().request(id)?.status != "done") delay(20) }
            assertEquals(1, cancels); assertEquals("canceled", db.metadata().history("retained-answer")!!.status)
        } finally { scope.cancel(); db.close() }
    }
    @Test fun placementIntentAttachesWithoutMountedCardAndPushesFullEntry() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()
        val placement = AnswerPlacement(2, .2f, .4f, "collapsed", "2026-10-06T00:00:00Z")
        var pushed: JsonObject? = null
        val remote = record("request")
        val client = object : HubDataClient {
            override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
                if (path.startsWith("/api/sync/pull")) return buildJsonObject {
                    put("cursor", "1"); put("history", JsonArray(listOf(remote)))
                }
                pushed = body!!.jsonObject["history"]!!.jsonArray.single().jsonObject
                return buildJsonObject { put("metadataResults", JsonArray(emptyList())) }
            }
        }
        try {
            db.reader().upsert(AiRequestEntity("answer-placement:retained-answer", "p", "draft", placement.json().toString(),
                "{\"deviceId\":\"android-fixture\"}", "draft", null, null, false, placement.updatedAt, placement.updatedAt))
            SyncEngine(db, client).syncOnce()
            assertEquals(placement, db.metadata().history("retained-answer")!!.answerPlacement())
            assertEquals(1, pushed!!["baseRev"]!!.jsonPrimitive.int)
            val entry = pushed!!["entry"]!!.jsonObject
            remote.filterKeys { it != "deviceId" }.forEach { (name, value) -> assertEquals(name, value, entry[name]) }
            assertEquals(placement.json(), entry["placement"])
            assertEquals("android-fixture", entry["deviceId"]!!.jsonPrimitive.content)
        } finally { db.close() }
    }

}
