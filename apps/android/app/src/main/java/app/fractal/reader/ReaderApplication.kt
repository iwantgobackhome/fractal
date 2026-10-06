package app.fractal.reader

import android.app.Application
import app.fractal.data.FractalDatabase
import app.fractal.data.PdfCache
import app.fractal.data.MetadataStore
import java.util.UUID
import app.fractal.sync.HubClient
import app.fractal.sync.HubCredentialStore
import app.fractal.sync.PdfDownloader
import app.fractal.sync.SyncEngine
import app.fractal.sync.SyncScheduler
import app.fractal.sync.OriginalTextRepository
import app.fractal.sync.HistoryRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

class ReaderApplication : Application() {
    val database by lazy { FractalDatabase.get(this) }
    val credentials by lazy { HubCredentialStore(this) }
    val client by lazy { HubClient(credentials) }
    internal val discoveryImages by lazy { DiscoveryImages(this) }
    val sync by lazy { SyncEngine(database, client) }
    val discovery by lazy { app.fractal.sync.DiscoveryRepository(database, client, sync) {
        app.fractal.sync.discoveryScope(credentials.load())
    } }
    val structure by lazy { app.fractal.sync.StructureRepository(database, client) {
        app.fractal.sync.discoveryScope(credentials.load())
    } }
    val originalText by lazy { OriginalTextRepository(database, client) }
    internal val submissionScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val history by lazy { HistoryRepository(database, client, submissionScope) { _, body -> readerRetainedCrop(cache, body) } }
    val metadata by lazy { MetadataStore(database) {
        credentials.load()?.deviceId ?: (settings.getString("localDeviceId", null)
            ?: UUID.randomUUID().toString().also { settings.edit().putString("localDeviceId", it).commit() })
    } }
    val cache by lazy {
        PdfCache(this).also { it.limitBytes = settings.getLong("cacheLimit", 2L * 1024 * 1024 * 1024) }
    }
    val downloader by lazy { PdfDownloader(this, client, cache) }
    val acquisition by lazy { app.fractal.sync.PublicationAcquisition(client, sync,
        { app.fractal.sync.discoveryScope(credentials.load()) }) { key, sha, session, guard ->
            downloader.download(key, sha, session as app.fractal.sync.HubPdfSession, guard)
        } }
    val settings by lazy { getSharedPreferences("reader_settings", MODE_PRIVATE) }

    override fun onCreate() {
        super.onCreate()
        SyncScheduler.schedule(this, settings.getBoolean("wifiOnly", false))
    }
}
