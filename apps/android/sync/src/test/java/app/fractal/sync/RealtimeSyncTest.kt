package app.fractal.sync

import kotlinx.coroutines.*
import org.testng.Assert.*
import org.testng.annotations.Test
import java.util.concurrent.atomic.AtomicInteger

class RealtimeSyncTest {
    @Test fun batchesLocalChangesAndPullsOnEvents() = runBlocking {
        val calls = AtomicInteger()
        var event: (() -> Unit)? = null
        val realtime = RealtimeSync({ calls.incrementAndGet(); Unit }, { _, notify -> event = notify; awaitCancellation() })
        val job = launch { realtime.run("paper") }
        delay(50)
        repeat(20) { realtime.notifyLocalChange("paper") }
        delay(400)
        assertEquals(calls.get(), 2)
        event!!()
        delay(400)
        assertEquals(calls.get(), 3)
        job.cancelAndJoin()
    }
    @Test fun oldHubFallsBackToForegroundPolling() = runBlocking {
        val calls = AtomicInteger()
        val subscriptions = AtomicInteger()
        val realtime = RealtimeSync({ calls.incrementAndGet(); Unit }, { _, _ -> subscriptions.incrementAndGet(); throw HubHttpException(404) })
        val job = launch { realtime.run("paper") }
        delay(5250)
        assertEquals(subscriptions.get(), 1)
        assertTrue(calls.get() >= 3)
        job.cancelAndJoin()
    }
}
