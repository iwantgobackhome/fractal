package app.fractal.reader

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.UUID

class DiscoveryRepositoryTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun memory() = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()
    private fun objectOf(raw: String) = WireJson.format.parseToJsonElement(raw).jsonObject
    private val topic = FieldTopic("user:one", "cs.CL", "Models", "Models", "user", false)
    private fun record() = objectOf("""{"id":"p","paperKey":"p","title":"Real paper","authors":[],"addedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","bibtexKey":"p","saved":true,"tags":["remote"],"collections":[],"rev":2}""")

    @Test fun delayedFailedFollowPreservesLaterChoiceAndOneCoalescedIntent(): Unit = runBlocking {
        val db = memory(); val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            entered.complete(Unit); release.await(); throw IOException("Delayed network loss")
        } }
        val repo = DiscoveryRepository(db, client, SyncEngine(db, client)) { "qa" }
        try {
            repo.follow(topic, true); val old = db.discovery().pending("qa").single()
            val sending = async(Dispatchers.IO) { repo.flush() }; entered.await()
            coroutineScope { repeat(10) { launch(Dispatchers.IO) { repo.follow(topic, false) } } }
            release.complete(Unit); sending.await()
            val latest = db.discovery().pending("qa").single()
            assertEquals(old.id, latest.id); assertEquals("false", objectOf(latest.bodyJson).text("followed")); assertNull(latest.error)
        } finally { db.close() }
    }

    @Test fun lostCustomTopicAdmissionReconcilesInsteadOfDuplicatingPost(): Unit = runBlocking {
        val db = memory(); var posts = 0; val topics = mutableListOf<JsonObject>()
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            if (method == "POST") { posts++; val b = body!!.jsonObject
                topics += objectOf("""{"id":"user:created","field":"cs.CL","label":"Models","query":"Models","origin":"user","followed":true}""")
                throw IOException("Admission completed, response lost")
            }
            return buildJsonObject { put("topics", JsonArray(topics)) }
        } }
        try { val repo = DiscoveryRepository(db, client, SyncEngine(db, client)) { "qa" }
            repo.createTopic("cs.CL", "Models", "Models"); assertTrue(repo.flush().isNotEmpty()); assertEquals(1, db.discovery().pending("qa").size)
            assertTrue(repo.flush().isEmpty()); assertEquals(1, posts); assertTrue(db.discovery().pending("qa").isEmpty())
            assertEquals(1, WireJson.format.decodeFromString<TopicResponse>(db.discovery().get("qa", "topics:cs.CL")!!.json).topics.size)
        } finally { db.close() }
    }

    @Test fun failedRelatedFallbackKeepsUsefulRowsAndTheirActualFetchTime(): Unit = runBlocking {
        val db = memory()
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?) =
            objectOf("""{"items":[],"source":"openAlex","fetchedAt":null,"status":"unavailable","providerStatus":[{"provider":"openAlex","state":"rate_limited","httpStatus":429}]}""") }
        try { val repo = DiscoveryRepository(db, client, SyncEngine(db, client)) { "qa" }
            repo.cache("related:p", objectOf("""{"items":[{"title":"Useful actual row","url":"https://example.org/related"}],"source":"semanticScholar","fetchedAt":"2026-01-01T00:00:00Z","status":"ready"}"""))
            val response = WireJson.format.decodeFromString<RelatedPapers>(repo.refresh("related:p", "/api/papers/p/related").toString())
            assertEquals("Useful actual row", response.items.single().title); assertEquals("2026-01-01T00:00:00Z", response.fetchedAt)
            assertEquals("stale", response.status); assertEquals(429, response.providerStatus.single().httpStatus)
            assertEquals("semanticScholar", response.source)
        } finally { db.close() }
    }

    @Test fun bookmarkResponsePreservesIndependentPendingMetadataPdfAndHistory(): Unit = runBlocking {
        val db = memory()
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?) = buildJsonObject { put("paperKey", "p"); put("record", record()); put("hasPdf", true) } }
        try {
            val original = record(); val hash = "a".repeat(64)
            db.library().upsert(libraryEntity(original, null, false).copy(pdfSha256 = hash, pageCount = 5))
            val metadata = MetadataStore(db) { "qa" }; metadata.patchPaper("p", objectOf("""{"tags":["remote","unsent"],"collections":["folder"]}"""))
            val memo = WireJson.annotationEntity(objectOf("""{"id":"note","paperKey":"p","page":2,"kind":"memo","text":"Full body","quote":"Selected context","deleted":false,"rev":4}"""), true)
            db.annotations().upsert(memo)
            val repo = DiscoveryRepository(db, client, SyncEngine(db, client)) { "qa" }
            repo.save(DiscoveryPaper(title = "Real paper", url = "https://example.org/p")); assertTrue(repo.flush().isEmpty())
            val paper = db.library().get("p")!!; assertEquals(hash, paper.pdfSha256); assertEquals(5, paper.pageCount); assertNull(paper.lastReadAt)
            assertEquals(listOf("remote", "unsent"), WireJson.format.decodeFromString<LibraryRecord>(paper.json).tags)
            assertEquals(listOf("folder"), WireJson.format.decodeFromString<LibraryRecord>(paper.json).collections)
            assertEquals(memo, db.annotations().get("note")); assertEquals(1, db.metadata().pending().size)
        } finally { db.close() }
    }

    @Test fun lateOldHubObservationCannotPopulateNewHubCache(): Unit = runBlocking {
        val db = memory(); val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var identity = "old"
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement { entered.complete(Unit); release.await(); return objectOf("{\"oldHub\":true}") } }
        try { val repo = DiscoveryRepository(db, client, SyncEngine(db, client)) { identity }
            val loading = async(Dispatchers.IO) { runCatching { repo.refresh("feed", "/api/feed") } }; entered.await(); identity = "new"; release.complete(Unit)
            assertTrue(loading.await().isFailure); assertNull(db.discovery().get("new", "feed")); assertNull(db.discovery().get("old", "feed"))
        } finally { db.close() }
    }

    @Test fun conflictingSameLocationCardsRetainIndependentSaveIntents(): Unit = runBlocking {
        val db = memory()
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement = throw IOException("Offline") }
        try { val repo = DiscoveryRepository(db, client, SyncEngine(db, client)) { "qa" }
            val first = DiscoveryPaper(title = "Same title", authors = listOf("Writer"), url = "https://example.org/shared", doi = "10.1234/one", arxivId = "1706.03762", year = 2017)
            val other = first.copy(doi = "10.1234/two", arxivId = "2106.09685", year = 2021)
            repo.save(first); repo.save(other); repo.save(first)
            val retained = db.discovery().pending("qa"); assertEquals(2, retained.size)
            assertNotEquals(publicationFingerprint(first), publicationFingerprint(other))
            assertEquals(setOf("10.1234/one", "10.1234/two"), retained.map { objectOf(it.bodyJson).text("doi") }.toSet())
            repo.flush(); assertEquals(2, db.discovery().pending("qa").size)
        } finally { db.close() }
    }

    @Test fun absentInkOptionalWireFieldsKeepOriginalBytesAndConcurrentEditDirty(): Unit = runBlocking {
        val db = memory(); val id = UUID.randomUUID().toString(); var editDuringSend = true
        val original = objectOf("""{"id":"$id","paperKey":"p","kind":"ink","page":1,"tool":"pen","color":"#000000","width":0.01,"points":[[0.2,0.3,0.7,0],[0.4,0.5,0.7,10]],"brush":null,"shape":null,"tilt":null,"updatedAt":"2026-01-01T00:00:00Z","rev":0,"deviceId":"qa","deleted":false}""")
        val edited = JsonObject(original + ("width" to JsonPrimitive(.02)))
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            if (method == "GET") return objectOf("""{"cursor":"5","papers":[],"annotations":[],"folders":[],"history":[]}""")
            val wire = body!!.jsonObject.getValue("annotations").jsonArray.single().jsonObject
            assertFalse(wire.containsKey("shape")); assertFalse(wire.containsKey("brush")); assertFalse(wire.containsKey("tilt"))
            assertEquals(original["points"], wire["points"])
            if (editDuringSend) db.annotations().upsert(WireJson.annotationEntity(edited, true))
            return objectOf("""{"cursor":"99","serverHead":"99","results":[{"id":"$id","applied":true,"rev":4}],"metadataResults":[]}""")
        } }
        try {
            db.annotations().upsert(WireJson.annotationEntity(original, true)); val sync = SyncEngine(db, client)
            sync.syncOnce(); val current = db.annotations().get(id)!!
            assertTrue(current.dirty); assertEquals(edited.toString(), current.json); assertEquals("5", db.syncState().cursor())
            editDuringSend = false; sync.syncOnce(); val acknowledged = db.annotations().get(id)!!
            assertFalse(acknowledged.dirty); assertEquals(JsonNull, objectOf(acknowledged.json)["shape"])
            assertEquals(edited["points"], objectOf(acknowledged.json)["points"]); assertEquals(.02, objectOf(acknowledged.json).getValue("width").jsonPrimitive.double, .00001)
        } finally { db.close() }
    }

    @Test fun explicitV3MigrationPreservesLocalReaderAndPendingGeneration(): Unit = runBlocking {
        val name = "discovery-v3-${UUID.randomUUID()}.db"
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("text-layout.pdf").use { it.readBytes() }
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val pdfCache = PdfCache(context); pdfCache.file(hash).writeBytes(bytes)
        val first = Room.databaseBuilder(context, FractalDatabase::class.java, name).build()
        val paper = libraryEntity(record(), null, true).copy(pdfSha256 = hash, pageCount = 5)
        val position = ReaderPositionEntity("p", "{\"page\":2,\"fraction\":0.3,\"mode\":\"split\"}")
        val request = AiRequestEntity("immutable", "p", "question", "{\"selectedText\":\"Complete context\"}", "{\"page\":2}", "queued", null, null, false, "2026-01-01", "2026-01-01")
        val memo = WireJson.annotationEntity(objectOf("""{"id":"note","paperKey":"p","kind":"memo","page":2,"text":"Complete old body","quote":"Separate quote","collapsed":true,"color":"pink","rect":{"x":0.6,"y":0.2,"width":0.1,"height":0.1},"deleted":false,"rev":7}"""), true)
        first.library().upsert(paper); first.reader().upsert(position); first.reader().upsert(request); first.annotations().upsert(memo)
        first.syncState().upsert(SyncStateEntity(cursor = "18446744073709551615")); first.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { old ->
            old.execSQL("DROP TABLE discovery_cache"); old.execSQL("DROP TABLE discovery_intents"); old.version = 3
        }
        val migrated = Room.databaseBuilder(context, FractalDatabase::class.java, name).addMigrations(FractalDatabase.MIGRATION_3_4).build()
        try { assertEquals(paper, migrated.library().get("p")); assertEquals(position, migrated.reader().position("p")); assertEquals(request, migrated.reader().request("immutable"))
            assertEquals(memo, migrated.annotations().get("note")); assertArrayEquals(bytes, pdfCache.file(hash).readBytes()); assertEquals("18446744073709551615", migrated.syncState().cursor())
            assertTrue(migrated.discovery().pending("qa").isEmpty())
        } finally { migrated.close(); context.deleteDatabase(name) }
    }
}
