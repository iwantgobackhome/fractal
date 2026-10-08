package app.fractal.sync

import kotlinx.coroutines.*

/** Only explicit reader/lifecycle triggers reach the hub; local saves stay in Room. */
class ReaderSync(private val scope: CoroutineScope, private val sync: suspend () -> Unit,
    private val retry: () -> Unit, private val debounceMillis: Long = 300) {
    private var pending: Deferred<Result<Unit>>? = null

    @Synchronized fun request(): Deferred<Result<Unit>> {
        pending?.let { return it }
        return scope.async(Dispatchers.IO, start = CoroutineStart.LAZY) {
            delay(debounceMillis)
            synchronized(this@ReaderSync) { pending = null }
            try { sync(); Result.success(Unit) }
            catch (cancel: CancellationException) { throw cancel }
            catch (error: Exception) { retry(); Result.failure(error) }
        }.also { pending = it; it.start() }
    }
}
