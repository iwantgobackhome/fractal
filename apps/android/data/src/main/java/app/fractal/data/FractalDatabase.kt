package app.fractal.data

import android.content.Context
import androidx.room.Dao
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
)

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
    entities = [LibraryEntity::class, AnnotationEntity::class, SyncStateEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class FractalDatabase : RoomDatabase() {
    abstract fun library(): LibraryDao
    abstract fun annotations(): AnnotationDao
    abstract fun syncState(): SyncStateDao

    companion object {
        @Volatile private var instance: FractalDatabase? = null

        fun get(context: Context): FractalDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    FractalDatabase::class.java,
                    "fractal-reader.db",
                ).build().also { instance = it }
            }
        }
    }
}
