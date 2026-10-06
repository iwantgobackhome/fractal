package app.fractal.sync

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel

/** Owned by a foreground reader; WorkManager remains the durable background fallback. */
class RealtimeSync(private val sync: suspend () -> Unit, private val events: suspend (String, () -> Unit) -> Unit) {
    private val changes = Channel<Unit>(Channel.CONFLATED)
    fun notifyLocalChange(paperKey: String) { changes.trySend(Unit) }

    suspend fun run(paperKey: String): Unit = coroutineScope {
        suspend fun refresh() {
            try { sync() }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { /* Durable dirty rows are retried below and by WorkManager. */ }
        }
        launch {
            refresh()
            for (change in changes) {
                delay(300)
                while (changes.tryReceive().isSuccess) { }
                refresh()
            }
        }
        var backoff = 1000L
        var legacy = false
        while (isActive) {
            try {
                if (legacy) { refresh(); delay(5000) }
                else {
                    events(paperKey) { changes.trySend(Unit) }
                    refresh()
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(30_000)
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) {
                if (error is HubHttpException && error.code == 404) legacy = true
                refresh()
                delay(if (legacy) 5000 else backoff)
                backoff = (backoff * 2).coerceAtMost(30_000)
            }
        }
    }
}
