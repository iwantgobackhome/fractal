package app.fractal.data

import android.content.Context
import androidx.room.Dao
import androidx.room.ColumnInfo
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "library")
data class LibraryEntity(
    @PrimaryKey val paperKey: String,
    val title: String?,
    val authors: String,
    val year: Int?,
    val venue: String?,
    val addedAt: String,
    val updatedAt: String,
    val status: String,
    val pdfSha256: String?,
    val pageCount: Int?,
    val dirty: Boolean,
    val json: String,
    @ColumnInfo(defaultValue = "1") val saved: Boolean = true,
    val savedAt: String? = null,
    val lastReadAt: String? = null,
    val readProgressJson: String? = null,
    @ColumnInfo(defaultValue = "0") val rev: Int = 0,
)

@Entity(tableName = "folders")
data class FolderEntity(@PrimaryKey val id: String, val name: String, val parentId: String?,
    val deleted: Boolean, val rev: Int, val updatedAt: String, val json: String)

@Entity(tableName = "history")
data class HistoryEntity(@PrimaryKey val id: String, val paperKey: String?, val status: String,
    val deleted: Boolean, val rev: Int, val updatedAt: String, val json: String)

@Entity(tableName = "snapshots")
data class SnapshotEntity(@PrimaryKey val paperKey: String, val json: String, val fetchedAt: String)

@Entity(tableName = "metadata_authority")
data class MetadataAuthority(@PrimaryKey val key: String, val rev: Int, val json: String)

@Entity(tableName = "metadata_conflicts")
data class MetadataConflict(@PrimaryKey val requestId: String, val kind: String, val entityId: String,
    val reason: String, val mutationJson: String, val currentJson: String, val recordedAt: String)

/** Immutable request receipts survive crashes and ambiguous network failures. */
@Entity(tableName = "metadata_mutations")
data class MetadataMutation(@PrimaryKey val requestId: String, val kind: String, val entityId: String,
    val baseRev: Int, val baseJson: String, val patchJson: String, val deviceId: String, val createdAt: Long)

@Entity(tableName = "pdf_text_pages", primaryKeys = ["pdfSha256", "version", "page"])
data class PdfTextEntity(val pdfSha256: String, val version: String, val page: Int, val json: String, val accessedAt: Long)

/** Device reading state only: never annotation coordinates or translated-position sync records. */
@Entity(tableName = "reader_positions")
data class ReaderPositionEntity(@PrimaryKey val paperKey: String, val json: String)

/** Idempotent generation POST intent, separate from settled-history metadata imports. */
@Entity(tableName = "ai_requests")
data class AiRequestEntity(@PrimaryKey val requestId: String, val paperKey: String, val kind: String,
    val bodyJson: String, val contextJson: String, val status: String, val historyId: String?,
    val error: String?, val cancelRequested: Boolean, val createdAt: String, val updatedAt: String)

@Dao
interface ReaderDao {
    @Query("SELECT * FROM pdf_text_pages WHERE pdfSha256 = :hash AND version = :version AND page = :page")
    suspend fun textPage(hash: String, version: String, page: Int): PdfTextEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: PdfTextEntity)
    @Query("DELETE FROM pdf_text_pages WHERE rowid NOT IN (SELECT rowid FROM pdf_text_pages ORDER BY accessedAt DESC LIMIT 512)") suspend fun trimTextPages()
    @Query("SELECT COALESCE(SUM(length(CAST(json AS BLOB))), 0) FROM pdf_text_pages") suspend fun textBytes(): Long
    @Query("DELETE FROM pdf_text_pages WHERE rowid = (SELECT rowid FROM pdf_text_pages ORDER BY accessedAt LIMIT 1)") suspend fun evictOldestTextPage()
    @Query("DELETE FROM pdf_text_pages WHERE pdfSha256 = :hash") suspend fun deleteTextPages(hash: String)
    @Query("SELECT * FROM reader_positions WHERE paperKey = :key") suspend fun position(key: String): ReaderPositionEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: ReaderPositionEntity)
    @Query("SELECT * FROM ai_requests WHERE paperKey = :key ORDER BY createdAt DESC")
    fun observeRequests(key: String): Flow<List<AiRequestEntity>>
    @Query("SELECT * FROM ai_requests WHERE requestId = :id") suspend fun request(id: String): AiRequestEntity?
    @Query("SELECT * FROM ai_requests WHERE paperKey = :key ORDER BY createdAt") suspend fun requests(key: String): List<AiRequestEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: AiRequestEntity)
}

@Dao
interface MetadataDao {
    @Query("SELECT COUNT(*) FROM metadata_mutations") fun observePendingCount(): Flow<Int>
    @Query("SELECT * FROM metadata_conflicts ORDER BY recordedAt DESC") fun observeConflicts(): Flow<List<MetadataConflict>>
    @Query("SELECT * FROM metadata_conflicts") suspend fun conflicts(): List<MetadataConflict>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: MetadataConflict)
    @Query("SELECT * FROM metadata_authority WHERE `key` = :key") suspend fun authority(key: String): MetadataAuthority?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: MetadataAuthority)
    @Query("SELECT * FROM folders ORDER BY name") fun observeFolders(): Flow<List<FolderEntity>>
    @Query("SELECT * FROM folders") suspend fun folders(): List<FolderEntity>
    @Query("SELECT * FROM folders WHERE id = :id") suspend fun folder(id: String): FolderEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: FolderEntity)
    @Query("SELECT * FROM history WHERE paperKey = :key AND deleted = 0 ORDER BY updatedAt DESC")
    fun observeHistory(key: String): Flow<List<HistoryEntity>>
    @Query("SELECT * FROM history WHERE paperKey = :key AND deleted = 0 ORDER BY updatedAt DESC")
    suspend fun historyEntries(key: String): List<HistoryEntity>
    @Query("SELECT * FROM history WHERE id = :id") suspend fun history(id: String): HistoryEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: HistoryEntity)
    @Query("SELECT * FROM snapshots WHERE paperKey = :key") suspend fun snapshot(key: String): SnapshotEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: SnapshotEntity)
    @Query("SELECT * FROM metadata_mutations ORDER BY createdAt, requestId") suspend fun pending(): List<MetadataMutation>
    @Query("SELECT * FROM metadata_mutations WHERE kind = :kind AND entityId = :id ORDER BY createdAt, requestId")
    suspend fun pending(kind: String, id: String): List<MetadataMutation>
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun enqueue(value: MetadataMutation)
    @Query("DELETE FROM metadata_mutations WHERE requestId = :id") suspend fun acknowledge(id: String)
    @Query("DELETE FROM snapshots WHERE paperKey = :key") suspend fun deleteSnapshot(key: String)
    @Query("DELETE FROM metadata_mutations WHERE kind = 'paper' AND entityId = :key") suspend fun deletePaperMutations(key: String)
}

@Entity(tableName = "annotations")
data class AnnotationEntity(
    @PrimaryKey val id: String,
    val paperKey: String,
    val page: Int,
    val kind: String,
    val updatedAt: String,
    val deleted: Boolean,
    val rev: Int,
    val deviceId: String,
    val dirty: Boolean,
    val json: String,
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = 0,
    val cursor: String = "0",
)

@Dao
interface LibraryDao {
    @Query("SELECT * FROM library ORDER BY addedAt DESC")
    fun observeAll(): Flow<List<LibraryEntity>>

    @Query("SELECT * FROM library ORDER BY addedAt DESC")
    suspend fun all(): List<LibraryEntity>

    @Query("SELECT * FROM library WHERE paperKey = :key")
    suspend fun get(key: String): LibraryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(value: LibraryEntity)

    @Query("DELETE FROM library WHERE paperKey = :key")
    suspend fun delete(key: String)

    @Query("UPDATE library SET pdfSha256 = :sha, pageCount = :pages WHERE paperKey = :key")
    suspend fun setPdf(key: String, sha: String, pages: Int?)
}

@Dao
interface AnnotationDao {
    @Query("SELECT * FROM annotations WHERE paperKey = :key AND deleted = 0 ORDER BY page, updatedAt")
    fun observePaper(key: String): Flow<List<AnnotationEntity>>

    @Query("SELECT * FROM annotations WHERE paperKey = :key ORDER BY page, updatedAt")
    suspend fun allForPaper(key: String): List<AnnotationEntity>

    @Query("SELECT * FROM annotations WHERE id = :id")
    suspend fun get(id: String): AnnotationEntity?

    @Query("SELECT * FROM annotations WHERE dirty = 1 ORDER BY updatedAt LIMIT 1000")
    suspend fun dirty(): List<AnnotationEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(value: AnnotationEntity)

    @Query("UPDATE annotations SET dirty = 0, rev = :rev, json = :updatedJson WHERE id = :id AND json = :oldJson")
    suspend fun markClean(id: String, oldJson: String, updatedJson: String, rev: Int)
}

@Dao
interface SyncStateDao {
    @Query("SELECT cursor FROM sync_state WHERE id = 0")
    suspend fun cursor(): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(value: SyncStateEntity)
}

@Database(
    entities = [LibraryEntity::class, AnnotationEntity::class, SyncStateEntity::class,
        FolderEntity::class, HistoryEntity::class, SnapshotEntity::class, MetadataMutation::class, MetadataAuthority::class, MetadataConflict::class,
        PdfTextEntity::class, ReaderPositionEntity::class, AiRequestEntity::class,
        DiscoveryCacheEntity::class, DiscoveryIntent::class],
    version = 4,
    exportSchema = false,
)
abstract class FractalDatabase : RoomDatabase() {
    abstract fun library(): LibraryDao
    abstract fun annotations(): AnnotationDao
    abstract fun syncState(): SyncStateDao
    abstract fun metadata(): MetadataDao
    abstract fun reader(): ReaderDao
    abstract fun discovery(): DiscoveryDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE library ADD COLUMN saved INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE library ADD COLUMN savedAt TEXT")
                db.execSQL("ALTER TABLE library ADD COLUMN lastReadAt TEXT")
                db.execSQL("ALTER TABLE library ADD COLUMN readProgressJson TEXT")
                db.execSQL("ALTER TABLE library ADD COLUMN rev INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE library SET savedAt = addedAt")
                // No inferred read event: an old cached paper need never have been opened.
                db.query("SELECT paperKey, json, addedAt FROM library").use { rows ->
                    val updates = mutableListOf<Pair<String, String>>()
                    while (rows.moveToNext()) {
                        val old = WireJson.format.parseToJsonElement(rows.getString(1))
                        val migrated = kotlinx.serialization.json.buildJsonObject {
                            for ((key, value) in old as kotlinx.serialization.json.JsonObject) put(key, value)
                            put("saved", kotlinx.serialization.json.JsonPrimitive(true))
                            put("savedAt", kotlinx.serialization.json.JsonPrimitive(rows.getString(2)))
                            put("lastReadAt", kotlinx.serialization.json.JsonNull)
                        }
                        updates += rows.getString(0) to migrated.toString()
                    }
                    for ((key, json) in updates) db.execSQL("UPDATE library SET json = ? WHERE paperKey = ?", arrayOf(json, key))
                }
                db.execSQL("CREATE TABLE IF NOT EXISTS folders (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, parentId TEXT, deleted INTEGER NOT NULL, rev INTEGER NOT NULL, updatedAt TEXT NOT NULL, json TEXT NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS history (id TEXT NOT NULL PRIMARY KEY, paperKey TEXT, status TEXT NOT NULL, deleted INTEGER NOT NULL, rev INTEGER NOT NULL, updatedAt TEXT NOT NULL, json TEXT NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS snapshots (paperKey TEXT NOT NULL PRIMARY KEY, json TEXT NOT NULL, fetchedAt TEXT NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS metadata_authority (`key` TEXT NOT NULL PRIMARY KEY, rev INTEGER NOT NULL, json TEXT NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS metadata_conflicts (requestId TEXT NOT NULL PRIMARY KEY, kind TEXT NOT NULL, entityId TEXT NOT NULL, reason TEXT NOT NULL, mutationJson TEXT NOT NULL, currentJson TEXT NOT NULL, recordedAt TEXT NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS metadata_mutations (requestId TEXT NOT NULL PRIMARY KEY, kind TEXT NOT NULL, entityId TEXT NOT NULL, baseRev INTEGER NOT NULL, baseJson TEXT NOT NULL, patchJson TEXT NOT NULL, deviceId TEXT NOT NULL, createdAt INTEGER NOT NULL)")
            }
        }
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS pdf_text_pages (pdfSha256 TEXT NOT NULL, version TEXT NOT NULL, page INTEGER NOT NULL, json TEXT NOT NULL, accessedAt INTEGER NOT NULL, PRIMARY KEY(pdfSha256, version, page))")
                db.execSQL("CREATE TABLE IF NOT EXISTS reader_positions (paperKey TEXT NOT NULL PRIMARY KEY, json TEXT NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS ai_requests (requestId TEXT NOT NULL PRIMARY KEY, paperKey TEXT NOT NULL, kind TEXT NOT NULL, bodyJson TEXT NOT NULL, contextJson TEXT NOT NULL, status TEXT NOT NULL, historyId TEXT, error TEXT, cancelRequested INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)")
            }
        }
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS discovery_cache (scope TEXT NOT NULL, resource TEXT NOT NULL, json TEXT NOT NULL, fetchedAt TEXT NOT NULL, PRIMARY KEY(scope, resource))")
                db.execSQL("CREATE TABLE IF NOT EXISTS discovery_intents (id TEXT NOT NULL PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, resource TEXT NOT NULL, bodyJson TEXT NOT NULL, createdAt INTEGER NOT NULL, error TEXT)")
            }
        }
        @Volatile private var instance: FractalDatabase? = null

        fun get(context: Context): FractalDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    FractalDatabase::class.java,
                    "fractal-reader.db",
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4).build().also { instance = it }
            }
        }
    }
}
