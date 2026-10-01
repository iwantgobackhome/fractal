package app.fractal.reader

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class PublicationAcquisitionTest {
    private fun memory() = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, FractalDatabase::class.java).build()
    private fun obj(raw: String) = WireJson.format.parseToJsonElement(raw).jsonObject
    private val paper = DiscoveryPaper(title = "Available publisher paper", url = "https://jmlr.org/papers/v12/pedregosa11a.html")
    private fun record(saved: Boolean = false) = obj("""{"id":"canonical","paperKey":"canonical","title":"Available publisher paper","authors":[],"addedAt":"2026-10-01","updatedAt":"2026-10-01","bibtexKey":"canonical","saved":$saved,"tags":["remote"],"collections":[],"rev":3}""")
    private fun result(hasPdf: Boolean = true) = buildJsonObject { put("paperKey", "canonical"); put("record", record()); put("hasPdf", hasPdf) }
    private fun snapshot() = obj("""{"paper":{"paperKey":"canonical","pdfSha256":"${"a".repeat(64)}","pageCount":16}}""")

    @Test fun unsavedReadAdmissionUsesCanonicalKeyAndNeverCreatesSaveOrRecent(): Unit = runBlocking {
        val db = memory(); val calls = mutableListOf<String>(); var downloads = 0
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            calls += path
            if (method == "POST") { assertEquals(paper.bookmarkBody(), body); return result() }
            return snapshot()
        } }
        try {
            val read = PublicationAcquisition(client, SyncEngine(db, client), { "scope" }) { key, hash, _, guard ->
                guard(); assertEquals("canonical", key); assertEquals("a".repeat(64), hash); downloads++
            }
            assertEquals("canonical", read.open(paper)); val row = db.library().get("canonical")!!
            assertFalse(row.saved); assertNull(row.lastReadAt); assertEquals(1, downloads)
            assertTrue(db.discovery().pending("scope").isEmpty()); assertTrue(db.metadata().pending().isEmpty())
            assertEquals(listOf("/api/publications/open", "/api/papers/canonical"), calls)
        } finally { db.close() }
    }

    @Test fun lateScopeOrSupersededRequestCannotAdmitOrDownload(): Unit = runBlocking {
        for (scopeChange in listOf(true, false)) {
            val db = memory(); val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            var identity = "old"; var active = true; var downloads = 0
            val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
                entered.complete(Unit); release.await(); return result()
            } }
            try {
                val read = PublicationAcquisition(client, SyncEngine(db, client), { identity }) { _, _, _, _ -> downloads++ }
                val pending = async(Dispatchers.IO) { runCatching { read.open(paper) { check(active) } } }
                entered.await(); if (scopeChange) identity = "new" else active = false; release.complete(Unit)
                assertTrue(pending.await().isFailure); assertTrue(db.library().all().isEmpty()); assertEquals(0, downloads)
                assertNull(db.metadata().snapshot("canonical"))
            } finally { db.close() }
        }
    }

    @Test fun acquisitionResponseProjectsConcurrentUnsavedTagsFoldersAndReadHistory(): Unit = runBlocking {
        val db = memory(); val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            if (method == "POST") { entered.complete(Unit); release.await(); return result() }; return snapshot()
        } }
        try {
            db.library().upsert(libraryEntity(record(true), null, false))
            val metadata = MetadataStore(db) { "device" }
            val read = PublicationAcquisition(client, SyncEngine(db, client), { "scope" }) { _, _, _, guard -> guard() }
            val pending = async(Dispatchers.IO) { read.open(paper) }; entered.await()
            metadata.save("canonical", false)
            metadata.patchPaper("canonical", obj("""{"tags":["remote","offline"],"collections":["nested-folder"],"lastReadAt":"2026-09-30T00:00:00Z"}"""))
            val note = WireJson.annotationEntity(obj("""{"id":"memo","paperKey":"canonical","kind":"memo","page":2,"text":"Durable body","quote":"Independent quote","rev":2,"deleted":false}"""), true)
            db.annotations().upsert(note); val intents = db.metadata().pending()
            release.complete(Unit); pending.await()
            val row = db.library().get("canonical")!!; val retained = WireJson.format.decodeFromString<LibraryRecord>(row.json)
            assertFalse(row.saved); assertEquals(listOf("remote", "offline"), retained.tags)
            assertEquals(listOf("nested-folder"), retained.collections); assertEquals("2026-09-30T00:00:00Z", row.lastReadAt)
            assertEquals(intents, db.metadata().pending()); assertEquals(note, db.annotations().get("memo")); assertTrue(row.dirty)
        } finally { db.close() }
    }

    @Test fun failureOldHubAndMissingPdfNeverDownloadOrMarkRead(): Unit = runBlocking {
        for (oldHub in listOf(true, false)) {
            val db = memory(); var downloads = 0
            val client = object : HubDataClient { override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
                if (oldHub) throw HubHttpException(404); return result(false)
            } }
            try {
                val read = PublicationAcquisition(client, SyncEngine(db, client), { "scope" }) { _, _, _, _ -> downloads++ }
                val failure = runCatching { read.open(paper) }.exceptionOrNull()!!
                assertTrue(failure.message!!.contains(if (oldHub) "does not support" else "No readable PDF"))
                assertEquals(0, downloads); assertNull(db.library().get("canonical")?.lastReadAt)
                assertTrue(db.discovery().pending("scope").isEmpty()); assertTrue(db.metadata().pending().isEmpty())
            } finally { db.close() }
        }
    }
}
