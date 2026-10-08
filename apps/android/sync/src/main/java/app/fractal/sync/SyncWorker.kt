package app.fractal.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import app.fractal.data.FractalDatabase
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val credentials = HubCredentialStore(applicationContext)
        if (credentials.load() == null) return@withContext Result.success()
        try {
            val database = FractalDatabase.get(applicationContext)
            val engine = SyncEngine(database, HubClient(credentials))
            engine.syncOnce()
            repeat(8) { if (database.metadata().pending().isNotEmpty()) engine.syncOnce() }
            engine.resolveMissingPdfs()
            if (database.metadata().pending().isEmpty()) Result.success() else Result.retry()
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

object SyncScheduler {
    private fun constraints(wifiOnly: Boolean): Constraints {
        val network = if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
        return Constraints.Builder().setRequiredNetworkType(network).build()
    }

    fun schedule(context: Context, wifiOnly: Boolean) {
        val work = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints(wifiOnly))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "fractal-sync",
            ExistingPeriodicWorkPolicy.UPDATE,
            work,
        )
    }

    fun now(context: Context, wifiOnly: Boolean) {
        val work = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints(wifiOnly))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "fractal-sync-now",
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            work,
        )
    }
}
