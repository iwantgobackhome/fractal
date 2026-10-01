package app.fractal.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

/** Resources are isolated by paired Hub identity; observations never replace reader data. */
@Entity(tableName = "discovery_cache", primaryKeys = ["scope", "resource"])
data class DiscoveryCacheEntity(val scope: String, val resource: String, val json: String, val fetchedAt: String)
@Entity(tableName = "discovery_intents")
data class DiscoveryIntent(@PrimaryKey val id: String, val scope: String, val kind: String,
    val resource: String, val bodyJson: String, val createdAt: Long, val error: String? = null)
@Dao
interface DiscoveryDao {
    @Query("SELECT * FROM discovery_cache WHERE scope = :scope") fun observe(scope: String): Flow<List<DiscoveryCacheEntity>>
    @Query("SELECT * FROM discovery_cache WHERE scope = :scope AND resource = :resource") suspend fun get(scope: String, resource: String): DiscoveryCacheEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: DiscoveryCacheEntity)
    @Query("SELECT * FROM discovery_intents WHERE scope = :scope ORDER BY createdAt, id") fun observeIntents(scope: String): Flow<List<DiscoveryIntent>>
    @Query("SELECT * FROM discovery_intents WHERE scope = :scope ORDER BY createdAt, id") suspend fun pending(scope: String): List<DiscoveryIntent>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(value: DiscoveryIntent)
    @Query("DELETE FROM discovery_intents WHERE id = :id AND bodyJson = :sent") suspend fun acknowledge(id: String, sent: String)
    @Query("UPDATE discovery_intents SET error = :message WHERE id = :id AND scope = :scope AND bodyJson = :sent")
    suspend fun fail(id: String, scope: String, sent: String, message: String)
}
