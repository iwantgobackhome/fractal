package app.fractal.reader

import android.app.Application
import app.fractal.data.FractalDatabase
import app.fractal.data.PdfCache
import app.fractal.sync.HubClient
import app.fractal.sync.HubCredentialStore
import app.fractal.sync.PdfDownloader
import app.fractal.sync.SyncEngine
import app.fractal.sync.SyncScheduler

class ReaderApplication : Application() {
    val database by lazy { FractalDatabase.get(this) }
    val credentials by lazy { HubCredentialStore(this) }
    val client by lazy { HubClient(credentials) }
    val sync by lazy { SyncEngine(database, client) }
    val cache by lazy {
        PdfCache(this).also { it.limitBytes = settings.getLong("cacheLimit", 2L * 1024 * 1024 * 1024) }
    }
    val downloader by lazy { PdfDownloader(this, client, cache) }
    val settings by lazy { getSharedPreferences("reader_settings", MODE_PRIVATE) }

    override fun onCreate() {
        super.onCreate()
        SyncScheduler.schedule(this, settings.getBoolean("wifiOnly", false))
    }
}
