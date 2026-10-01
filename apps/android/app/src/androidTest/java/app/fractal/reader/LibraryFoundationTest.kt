package app.fractal.reader

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.sync.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.UUID

/** Uses isolated fixture databases, never the user's shelf or paired hub. */
class LibraryFoundationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun objectOf(value: String) = WireJson.format.parseToJsonElement(value).jsonObject
    private fun paper(rev: Int = 1) = objectOf("""{"id":"p","paperKey":"p","title":"Original","authors":[{"family":"Writer"}],"addedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","bibtexKey":"p","saved":false,"tags":["keep"],"collections":["orphan"],"rev":$rev}""")
    private fun memory() = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()

    @Test fun migratesV1WithoutLosingPdfAnnotationsOrCursor() = runBlocking {
        val name = "migration-${UUID.randomUUID()}.db"
        val cache = PdfCache(context)
        val pdf = android.graphics.pdf.PdfDocument()
        repeat(4) { index ->
            val page = pdf.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(600, 800, index + 1).create())
            page.canvas.drawText("V1 cached PDF fixture ${index + 1}", 40f, 100f, android.graphics.Paint().apply { textSize = 20f })
            pdf.finishPage(page)
        }
        val output = java.io.ByteArrayOutputStream()
        pdf.writeTo(output); pdf.close()
        val bytes = output.toByteArray()
        val sha = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        cache.file(sha).writeBytes(bytes)
        val dbPath = context.getDatabasePath(name)
        dbPath.parentFile!!.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(dbPath, null).use { old ->
            old.execSQL("CREATE TABLE library (paperKey TEXT NOT NULL PRIMARY KEY,title TEXT,authors TEXT NOT NULL,year INTEGER,venue TEXT,addedAt TEXT NOT NULL,updatedAt TEXT NOT NULL,status TEXT NOT NULL,pdfSha256 TEXT,pageCount INTEGER,dirty INTEGER NOT NULL,json TEXT NOT NULL)")
            old.execSQL("CREATE TABLE annotations (id TEXT NOT NULL PRIMARY KEY,paperKey TEXT NOT NULL,page INTEGER NOT NULL,kind TEXT NOT NULL,updatedAt TEXT NOT NULL,deleted INTEGER NOT NULL,rev INTEGER NOT NULL,deviceId TEXT NOT NULL,dirty INTEGER NOT NULL,json TEXT NOT NULL)")
            old.execSQL("CREATE TABLE sync_state (id INTEGER NOT NULL PRIMARY KEY,cursor TEXT NOT NULL)")
            val legacy = JsonObject(paper().filterKeys { it !in setOf("saved", "rev") })
            old.execSQL("INSERT INTO library VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", arrayOf<Any>("p", "Original", "Writer", 2024, "Journal", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "reading", sha, 4, 0, legacy.toString()))
            val annotation = """{"id":"ink","paperKey":"p","page":3,"kind":"ink","updatedAt":"2026-01-01","deviceId":"tablet","rev":7,"deleted":false,"points":[[0.2,0.3]],"tilts":[0.1]}"""
            old.execSQL("INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?)", arrayOf<Any>("ink", "p", 3, "ink", "2026-01-01", 0, 7, "tablet", 1, annotation))
            old.execSQL("INSERT INTO sync_state VALUES(0,'12345678901234567890')")
            old.version = 1
        }
        val migrated = Room.databaseBuilder(context, FractalDatabase::class.java, name).addMigrations(FractalDatabase.MIGRATION_1_2, FractalDatabase.MIGRATION_2_3, FractalDatabase.MIGRATION_3_4).build()
        try {
            val row = migrated.library().get("p")!!
            assertTrue(row.saved); assertEquals(row.addedAt, row.savedAt); assertNull(row.lastReadAt)
            assertEquals(sha, row.pdfSha256); assertEquals(4, row.pageCount)
            assertEquals("reading", row.status); assertEquals("Writer", row.authors)
            assertTrue(row.record().saved); assertNull(row.record().lastReadAt)
            val ink = migrated.annotations().get("ink")!!
            assertEquals(7, ink.rev); assertEquals(3, ink.page); assertTrue(ink.dirty)
            assertTrue(ink.json.contains("\"tilts\":[0.1]"))
            assertEquals("12345678901234567890", migrated.syncState().cursor())
            assertArrayEquals(bytes, cache.existing(sha)!!.readBytes())
            val store = MetadataStore(migrated) { "fixture" }
            store.save("p", false)
            assertNull(migrated.library().get("p")!!.lastReadAt)
            store.read("p", 3)
            assertNotNull(migrated.library().get("p")!!.lastReadAt)
            assertEquals(3, migrated.library().get("p")!!.record().readProgress!!.page)
        } finally { migrated.close(); context.deleteDatabase(name); cache.file(sha).delete() }
    }

    private fun LibraryEntity.record() = WireJson.format.decodeFromString<LibraryRecord>(json)

    private inner class Hub(var current: JsonObject = paper()) : HubDataClient {
        val requests = mutableListOf<JsonObject>()
        val since = mutableListOf<String>()
        val receipts = mutableMapOf<String, JsonObject>()
        val folders = mutableMapOf<String, JsonObject>()
        val histories = mutableMapOf<String, JsonObject>()
        var offline = false
        var loseResponse = false
        var legacy = false
        var duringPush: (suspend () -> Unit)? = null
        var remoteAnnotation: JsonObject? = null
        override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            if (offline) throw IOException("Fixture hub unavailable")
            if (path.startsWith("/api/sync/pull")) {
                since += path.substringAfter("since=")
                return buildJsonObject {
                    put("cursor", "5"); put("papers", JsonArray(listOf(current)))
                    put("annotations", JsonArray(listOfNotNull(remoteAnnotation)))
                    put("folders", JsonArray(folders.values.toList())); put("history", JsonArray(histories.values.toList()))
                }
            }
            val request = body!!.jsonObject
            requests += request
            duringPush?.also { duringPush = null }?.invoke()
            val otherResults = mutableListOf<JsonElement>()
            for (value in (request["folders"] as? JsonArray).orEmpty()) {
                val mutation = value.jsonObject
                val id = mutation.text("id")!!; val receipt = mutation.text("requestId")!!
                otherResults += receipts[receipt] ?: run {
                    val previous = folders[id] ?: buildJsonObject { put("id", id); put("rev", 0); put("deleted", false) }
                    val applied = mutation.text("baseRev")!!.toInt() == previous.revision()
                    var row = previous
                    if (applied) {
                        val patch = mutation["patch"]!!.jsonObject
                        patch.text("parentId")?.let { assertTrue("Parent precedes child", folders[it] != null) }
                        row = JsonObject(previous + patch + objectOf("""{"rev":${previous.revision() + 1},"deleted":${mutation.text("deleted") == "true"}}"""))
                        folders[id] = row
                        if (row.text("deleted") == "true") {
                            for ((childId, child) in folders.toMap()) if (child.text("parentId") == id) {
                                folders[childId] = JsonObject(child + ("parentId" to (previous["parentId"] ?: JsonNull)) + ("rev" to JsonPrimitive(child.revision() + 1)))
                            }
                            current = JsonObject(current + ("collections" to JsonArray(current["collections"]!!.jsonArray.filterNot { it.jsonPrimitive.content == id })) + ("rev" to JsonPrimitive(current.revision() + 1)))
                        }
                    }
                    buildJsonObject { put("kind", "folder"); put("id", id); put("applied", applied); put("conflict", !applied); put("rev", row.revision()); put("current", row) }
                        .also { receipts[receipt] = it }
                }
            }
            for (value in (request["history"] as? JsonArray).orEmpty()) {
                val mutation = value.jsonObject; val entry = mutation["entry"]!!.jsonObject
                val id = entry.text("id")!!; val receipt = mutation.text("requestId")!!
                otherResults += receipts[receipt] ?: run {
                    val previous = histories[id]
                    val applied = mutation.text("baseRev")!!.toInt() == (previous?.revision() ?: 0)
                    val row = if (applied) JsonObject(entry + ("rev" to JsonPrimitive((previous?.revision() ?: 0) + 1))) else previous!!
                    if (applied) histories[id] = row
                    buildJsonObject { put("kind", "history"); put("id", id); put("applied", applied); put("conflict", !applied); put("rev", row.revision()); put("current", row) }
                        .also { receipts[receipt] = it }
                }
            }
            val results = (request["papers"] as? JsonArray).orEmpty().map { value ->
                val mutation = value.jsonObject
                val id = mutation.text("requestId")!!
                receipts[id] ?: run {
                    val applied = mutation.text("baseRev")!!.toInt() == current.revision()
                    if (applied) {
                        val patch = mutation["patch"]!!.jsonObject
                        val previousMemberships = current["collections"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
                        for (membership in (patch["collections"] as? JsonArray).orEmpty()) {
                            val folderId = membership.jsonPrimitive.content
                            if (folderId !in previousMemberships && (folders[folderId] == null || folders[folderId]?.text("deleted") == "true"))
                                throw IOException("Actual hub rejects newly introduced missing/deleted folder $folderId")
                        }
                        current = JsonObject(current + patch + ("rev" to JsonPrimitive(current.revision() + 1)))
                    }
                    buildJsonObject {
                        put("kind", "paper"); put("id", "p"); put("applied", applied); put("conflict", !applied)
                        put("rev", current.revision()); put("current", current)
                    }.also { receipts[id] = it }
                }
            }
            val annotations = (request["annotations"] as? JsonArray).orEmpty().map { value -> buildJsonObject {
                put("id", value.jsonObject.getValue("id")); put("applied", true); put("rev", 9)
            } }
            if (loseResponse) { loseResponse = false; throw IOException("Applied request; response lost") }
            return buildJsonObject {
                put("cursor", "100"); put("serverHead", "100"); put("results", JsonArray(annotations))
                if (!legacy) put("metadataResults", JsonArray(otherResults + results))
            }
        }
    }

    @Test fun conflictRebasesFreshReceiptAndPreservesIndependentUnsentEdit() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            sync.syncOnce()
            store.patchPaper("p", objectOf("""{"tags":["keep","local"]}"""))
            val sentId = db.metadata().pending().single().requestId
            hub.current = JsonObject(hub.current + objectOf("""{"rev":2,"tags":["keep","remote"],"venue":"Remote Journal"}"""))
            hub.duringPush = { store.patchPaper("p", objectOf("""{"title":"Unsent independent title"}""")) }
            sync.syncOnce()
            val queue = db.metadata().pending()
            assertEquals(2, queue.size); assertNotEquals(sentId, queue.first().requestId)
            val local = db.library().get("p")!!.record()
            assertEquals(setOf("keep", "local", "remote"), local.tags.toSet())
            assertEquals("Unsent independent title", local.title); assertEquals("Remote Journal", local.venue)
            repeat(4) { sync.syncOnce() }
            assertTrue(db.metadata().pending().isEmpty())
            assertEquals("Unsent independent title", hub.current.text("title"))
            assertEquals(setOf("keep", "local", "remote"), hub.current["tags"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet())
            assertTrue(hub.since.all { it == "0" || it == "5" })
            assertEquals("5", db.syncState().cursor())
        } finally { db.close() }
    }

    @Test fun ambiguousRetryUsesSameReceiptAndDoesNotRegressNewerPull() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            sync.syncOnce(); store.save("p", true)
            val receipt = db.metadata().pending().single().requestId
            hub.offline = true
            assertTrue(runCatching { sync.syncOnce() }.isFailure)
            assertEquals(receipt, db.metadata().pending().single().requestId)
            hub.offline = false; hub.loseResponse = true
            assertTrue(runCatching { sync.syncOnce() }.isFailure)
            assertEquals(receipt, db.metadata().pending().single().requestId)
            hub.current = JsonObject(hub.current + objectOf("""{"rev":3,"venue":"Newer remote venue"}"""))
            sync.syncOnce()
            assertEquals(hub.requests[0]["papers"], hub.requests[1]["papers"])
            assertTrue(db.metadata().pending().isEmpty())
            assertTrue(db.library().get("p")!!.saved)
            assertEquals("Newer remote venue", db.library().get("p")!!.venue)
        } finally { db.close() }
    }

    @Test fun legacyHubRetainsMetadataAndAnnotationAckOnlyCleansSentJson() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            sync.syncOnce(); store.save("p", true)
            val ink = objectOf("""{"id":"ink","paperKey":"p","page":1,"kind":"memo","text":"sent","quote":"selected context","updatedAt":"2026-01-01","deviceId":"fixture","rev":0,"deleted":false}""")
            sync.saveLocal(ink)
            hub.legacy = true
            hub.duringPush = { sync.saveLocal(JsonObject(ink + objectOf("""{"text":"edited while sent"}"""))) }
            sync.syncOnce()
            assertEquals(1, db.metadata().pending().size)
            val row = db.annotations().get("ink")!!
            assertTrue(row.dirty); assertEquals("edited while sent", objectOf(row.json).text("text"))
            assertEquals("selected context", objectOf(row.json).text("quote"))
            assertEquals("5", db.syncState().cursor())
        } finally { db.close() }
    }

    @Test fun nestedFolderDeletionPreservesPapersMultipleMembershipsAndMemoBodies() = runBlocking {
        val db = memory()
        try {
            db.library().upsert(libraryEntity(paper(), null, false))
            val store = MetadataStore(db) { "fixture" }
            val a = store.folder("Research", null, "a")
            store.folder("Methods", a, "b"); store.folder("Other", null, "c")
            store.patchPaper("p", objectOf("""{"collections":["orphan","a","b","c"]}"""))
            val memo = objectOf("""{"id":"memo","paperKey":"p","page":2,"kind":"memo","text":"Complete memo body","quote":"Selected context","updatedAt":"2026-01-01","deviceId":"fixture","rev":0,"deleted":false}""")
            db.annotations().upsert(WireJson.annotationEntity(memo, true))
            assertEquals(setOf("a", "b"), folderDescendants("a", db.metadata().folders()))
            assertTrue(runCatching { store.folder("Research", "b", "a") }.isFailure)
            store.deleteFolder("a")
            assertNull(db.metadata().folder("b")!!.parentId)
            assertTrue(db.metadata().folder("a")!!.deleted)
            assertEquals(setOf("orphan", "b", "c"), db.library().get("p")!!.record().collections.toSet())
            assertEquals(memo.toString(), db.annotations().get("memo")!!.json)
            assertTrue(runCatching { store.folder("Reuse", null, "a") }.isFailure)
        } finally { db.close() }
    }

    @Test fun offlineSaveRecentNestedMembershipTagsAndSettledHistoryReconnect() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            sync.syncOnce(); hub.offline = true
            store.folder("Parent", null, "parent"); store.folder("Child", "parent", "child")
            store.save("p", true); store.read("p", 2)
            store.patchPaper("p", objectOf("""{"tags":["keep","offline"],"collections":["orphan","parent","child"]}"""))
            val history = objectOf("""{"id":"history","paperKey":"p","kind":"question","question":"Why?","status":"completed","createdAt":"2026-01-01","updatedAt":"2026-01-01","requestId":"original-request","context":{"page":2,"selectedText":"Full selected quote","rect":{"x":0.1,"y":0.2,"width":0.3,"height":0.4},"modelSelection":{"model":"long-model"}},"answer":{"text":"Complete answer body","citations":[{"page":2,"blockId":"stable-block"}]},"rev":0,"deviceId":"fixture","deleted":false}""")
            store.settledHistory(history)
            assertTrue(runCatching { sync.syncOnce() }.isFailure)
            assertEquals(6, db.metadata().pending().size)
            hub.offline = false
            repeat(8) { sync.syncOnce() }
            assertTrue(db.metadata().pending().isEmpty())
            assertTrue(db.library().get("p")!!.saved); assertNotNull(db.library().get("p")!!.lastReadAt)
            assertEquals(setOf("orphan", "parent", "child"), db.library().get("p")!!.record().collections.toSet())
            assertTrue(db.library().get("p")!!.record().tags.contains("offline"))
            assertEquals("Full selected quote", objectOf(db.metadata().history("history")!!.json)["context"]!!.jsonObject.text("selectedText"))
            assertEquals(history["answer"], hub.histories["history"]!!["answer"])
            store.deleteFolder("parent"); repeat(3) { sync.syncOnce() }
            assertNull(db.metadata().folder("child")!!.parentId)
            assertEquals(setOf("orphan", "child"), db.library().get("p")!!.record().collections.toSet())
            assertEquals(history["answer"], objectOf(db.metadata().history("history")!!.json)["answer"])
        } finally { db.close() }
    }

    @Test fun localDeleteBeforeOfflineMembershipSettlementOrdersDependencies() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            sync.syncOnce(); hub.offline = true
            store.folder("Parent", null, "a"); store.folder("Child", "a", "b"); store.folder("Other", null, "c")
            store.patchPaper("p", objectOf("""{"collections":["orphan","a","b","c"],"tags":["keep","offline"]}"""))
            store.save("p", true); store.read("p", 3); store.deleteFolder("a")
            assertEquals(setOf("orphan", "b", "c"), db.library().get("p")!!.record().collections.toSet())
            assertTrue(runCatching { sync.syncOnce() }.isFailure)
            hub.offline = false
            repeat(10) { sync.syncOnce() }
            assertTrue(db.metadata().pending().isEmpty())
            assertTrue(hub.folders.getValue("a").text("deleted") == "true")
            assertNull(hub.folders.getValue("b").text("parentId"))
            assertEquals(setOf("orphan", "b", "c"), hub.current["collections"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet())
            assertTrue(db.library().get("p")!!.saved); assertEquals(3, db.library().get("p")!!.record().readProgress!!.page)
            assertEquals(listOf("keep", "offline"), db.library().get("p")!!.record().tags)
            for (request in hub.requests) {
                val deleted = (request["folders"] as? JsonArray).orEmpty().any { it.jsonObject.text("id") == "a" && it.jsonObject.text("deleted") == "true" }
                if (deleted) assertFalse((request["papers"] as? JsonArray).orEmpty().any { paper ->
                    (paper.jsonObject["patch"]!!.jsonObject["collections"] as? JsonArray).orEmpty().any { it.jsonPrimitive.content == "a" }
                })
            }
        } finally { db.close() }
    }

    @Test fun pulledRemoteTombstoneRebasesMembershipWithFreshReceiptAndKeepsOtherEdits() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            hub.folders["a"] = objectOf("""{"id":"a","name":"Parent","parentId":null,"rev":1,"deleted":false}""")
            hub.folders["b"] = objectOf("""{"id":"b","name":"Child","parentId":"a","rev":1,"deleted":false}""")
            hub.current = JsonObject(hub.current + objectOf("""{"collections":["orphan","b"]}"""))
            sync.syncOnce(); hub.offline = true
            store.patchPaper("p", objectOf("""{"collections":["orphan","b","a"],"tags":["keep","local"]}"""))
            store.save("p", true)
            val originalId = db.metadata().pending().first().requestId
            hub.folders["a"] = JsonObject(hub.folders.getValue("a") + objectOf("""{"rev":2,"deleted":true}"""))
            hub.folders["b"] = JsonObject(hub.folders.getValue("b") + objectOf("""{"rev":2,"parentId":null}"""))
            hub.current = JsonObject(hub.current + objectOf("""{"rev":2,"tags":["keep","remote"]}"""))
            hub.offline = false
            sync.syncOnce()
            assertNotEquals(originalId, hub.requests.first()["papers"]!!.jsonArray.single().jsonObject.text("requestId"))
            repeat(4) { sync.syncOnce() }
            assertTrue(db.metadata().pending().isEmpty())
            assertTrue(db.library().get("p")!!.saved)
            assertEquals(setOf("orphan", "b"), db.library().get("p")!!.record().collections.toSet())
            assertEquals(setOf("keep", "remote", "local"), db.library().get("p")!!.record().tags.toSet())
            assertNull(db.metadata().folder("b")!!.parentId)
            assertTrue(db.metadata().folder("a")!!.deleted)
        } finally { db.close() }
    }

    @Test fun remoteTombstoneSettlesObsoleteFolderEditsWithoutDiscardingTheirAudit() = runBlocking {
        val db = memory()
        try {
            val hub = Hub(); val sync = SyncEngine(db, hub); val store = MetadataStore(db) { "fixture" }
            hub.folders["a"] = objectOf("""{"id":"a","name":"Original folder","parentId":null,"rev":1,"deleted":false}""")
            hub.folders["b"] = objectOf("""{"id":"b","name":"Child","parentId":"a","rev":1,"deleted":false}""")
            sync.syncOnce(); hub.offline = true
            store.folder("Unsent rename", null, "a"); store.deleteFolder("a")
            store.patchPaper("p", objectOf("""{"tags":["keep","independent"]}""")); store.save("p", true)
            hub.folders["a"] = JsonObject(hub.folders.getValue("a") + objectOf("""{"rev":2,"deleted":true}"""))
            hub.folders["b"] = JsonObject(hub.folders.getValue("b") + objectOf("""{"rev":2,"parentId":null}"""))
            hub.offline = false
            repeat(5) { sync.syncOnce() }
            assertTrue(db.metadata().pending().isEmpty())
            assertTrue(db.metadata().folder("a")!!.deleted)
            assertEquals("Original folder", db.metadata().folder("a")!!.name)
            assertNull(db.metadata().folder("b")!!.parentId)
            assertEquals(1, db.metadata().conflicts().size)
            assertEquals("Unsent rename", objectOf(db.metadata().conflicts().single().mutationJson)["patch"]!!.jsonObject.text("name"))
            assertTrue(db.library().get("p")!!.saved)
            assertTrue(db.library().get("p")!!.record().tags.contains("independent"))
        } finally { db.close() }
    }
}
