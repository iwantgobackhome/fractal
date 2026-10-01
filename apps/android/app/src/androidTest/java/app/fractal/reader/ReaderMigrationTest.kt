package app.fractal.reader

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ReaderMigrationTest {
    @Test fun explicitV2ToV3PreservesSavedShelfCacheHistoryAnnotationsAndUnsentReceipts(): Unit = runBlocking {
        val instrument = InstrumentationRegistry.getInstrumentation(); val context = instrument.targetContext
        val name = "reader-v2-fixture-${UUID.randomUUID()}.db"
        val bytes = instrument.context.assets.open("text-layout.pdf").use { it.readBytes() }
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val cache = PdfCache(context); cache.file(hash).writeBytes(bytes)
        val paper = WireJson.format.parseToJsonElement("""{"id":"v2-paper","paperKey":"v2-paper","title":"Retained paper","authors":[],"addedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","bibtexKey":"v2","saved":true,"lastReadAt":null,"rev":7}""").jsonObject
        val annotation = WireJson.format.parseToJsonElement("""{"id":"memo","paperKey":"v2-paper","page":2,"kind":"memo","text":"Complete old memo body","quote":"Separate selected quote","rect":{"x":0.88415625,"y":0.41452,"width":0.02890625,"height":0.02664},"collapsed":true,"color":"pink","rev":4,"updatedAt":"2026-01-01T00:00:00Z","deleted":false,"deviceId":"tablet"}""").jsonObject
        val history = WireJson.format.parseToJsonElement("""{"id":"old-history","paperKey":"v2-paper","kind":"question","question":"Old question","text":"Complete retained answer","status":"completed","rev":3,"updatedAt":"2026-01-01T00:00:00Z","deleted":false}""").jsonObject
        val receipt = MetadataMutation("immutable-v2-request", "paper", "v2-paper", 7, paper.toString(), "{\"tags\":[\"unsent\"]}", "tablet", 7)
        val first = Room.databaseBuilder(context, FractalDatabase::class.java, name).build()
        first.library().upsert(libraryEntity(paper, null, true).copy(pdfSha256 = hash, pageCount = 5))
        first.annotations().upsert(WireJson.annotationEntity(annotation, true))
        first.metadata().upsert(historyEntity(history)); first.metadata().enqueue(receipt)
        first.syncState().upsert(SyncStateEntity(cursor = "18446744073709551615"))
        first.close()
        // Construct the exact predecessor schema: v3 adds only these three derived tables.
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { old ->
            old.execSQL("DROP TABLE pdf_text_pages"); old.execSQL("DROP TABLE reader_positions"); old.execSQL("DROP TABLE ai_requests"); old.version = 2
        }
        val migrated = Room.databaseBuilder(context, FractalDatabase::class.java, name).addMigrations(FractalDatabase.MIGRATION_2_3, FractalDatabase.MIGRATION_3_4).build()
        try {
            val retained = migrated.library().get("v2-paper")!!
            assertEquals(paper.toString(), retained.json); assertTrue(retained.saved); assertNull(retained.lastReadAt); assertEquals(hash, retained.pdfSha256)
            assertEquals(annotation.toString(), migrated.annotations().get("memo")!!.json); assertTrue(migrated.annotations().get("memo")!!.dirty)
            assertEquals(history.toString(), migrated.metadata().history("old-history")!!.json)
            assertEquals(listOf(receipt), migrated.metadata().pending()); assertEquals("18446744073709551615", migrated.syncState().cursor())
            assertArrayEquals(bytes, cache.existing(hash)!!.readBytes())
            assertNull(migrated.reader().position("v2-paper")); assertEquals(emptyList<AiRequestEntity>(), migrated.reader().requests("v2-paper"))
        } finally { migrated.close(); context.deleteDatabase(name) }
    }
}
