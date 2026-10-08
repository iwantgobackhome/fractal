package app.fractal.sync

import app.fractal.data.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.mockito.Mockito.*
import org.testng.Assert.*
import org.testng.annotations.Test
import java.util.concurrent.atomic.AtomicInteger

class ReaderSyncTest {
    private class Hub : HubDataClient {
        val calls = AtomicInteger()
        var offline = false
        override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement {
            calls.incrementAndGet()
            if (offline) error("Offline")
            return buildJsonObject { }
        }
        suspend fun sync() {
            data("/api/sync/pull")
            data("/api/sync/push", "POST", buildJsonObject { })
        }
    }

    @Test fun localInkStaysDirtyUntilOpenLeaveOrManualTrigger() = runBlocking {
        val database = mock(FractalDatabase::class.java)
        val saved = mutableListOf<AnnotationEntity>()
        val annotations = java.lang.reflect.Proxy.newProxyInstance(AnnotationDao::class.java.classLoader,
            arrayOf(AnnotationDao::class.java)) { _, method, args ->
            check(method.name == "upsert")
            saved += args!![0] as AnnotationEntity
            Unit
        } as AnnotationDao
        `when`(database.annotations()).thenReturn(annotations)
        val hub = Hub()
        val engine = SyncEngine(database, hub)
        repeat(20) { index -> engine.saveLocal(buildJsonObject {
            put("id", "ink-$index"); put("paperKey", "paper"); put("kind", "ink")
            put("page", 1); put("updatedAt", "2026-10-08T00:00:00Z"); put("deviceId", "test")
            put("deleted", false); put("rev", 0); put("points", JsonArray(emptyList()))
        }) }
        assertEquals(saved.size, 20)
        assertTrue(saved.all { it.dirty })
        assertEquals(hub.calls.get(), 0)
        val reader = ReaderSync(this, hub::sync, {}, debounceMillis = 10)
        reader.request().await() // Open.
        assertEquals(hub.calls.get(), 2)
        val leave = reader.request()
        assertSame(reader.request(), leave) // Leave and app background coalesce.
        leave.await()
        assertEquals(hub.calls.get(), 4)
        assertTrue(reader.request().await().isSuccess) // Manual.
        assertEquals(hub.calls.get(), 6)
    }

    @Test fun failureQueuesRetryAndLaterTriggerWorks() = runBlocking {
        val hub = Hub().also { it.offline = true }
        val retries = AtomicInteger()
        val reader = ReaderSync(this, hub::sync, { retries.incrementAndGet() }, debounceMillis = 10)
        assertTrue(reader.request().await().isFailure)
        assertEquals(retries.get(), 1)
        hub.offline = false
        assertTrue(reader.request().await().isSuccess)
        assertEquals(hub.calls.get(), 3)
    }
}
