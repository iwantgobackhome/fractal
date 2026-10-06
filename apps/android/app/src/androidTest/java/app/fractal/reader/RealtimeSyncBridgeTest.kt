package app.fractal.reader

import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import androidx.room.Room
import app.fractal.data.WireJson
import app.fractal.data.FractalDatabase
import app.fractal.sync.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Test
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** Opt-in, disposable hub on 17460; never uses the application's stored pairing. */
class RealtimeSyncBridgeTest {
    @Test fun phoneStrokeAndDesktopWriteReachOppositeStores(): Unit = runBlocking {
        val fixture = File("/data/local/tmp/realtime-fixture.json")
        assumeTrue("Requires a disposable local Hub fixture", fixture.isFile)
        val config = WireJson.format.parseToJsonElement(fixture.readText()).jsonObject
        val context = object : android.content.ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): android.content.Context = this
            override fun getSharedPreferences(name: String, mode: Int): android.content.SharedPreferences =
                super.getSharedPreferences("realtime_qa_$name", mode)
        }
        val credentials = HubCredentialStore(context)
        val client = HubClient(credentials)
        val database = Room.inMemoryDatabaseBuilder(context, FractalDatabase::class.java).build()
        val key = "2401.12345v1"
        lateinit var realtime: RealtimeSync
        val engine = SyncEngine(database, client) { realtime.notifyLocalChange(it) }
        realtime = RealtimeSync({ engine.syncOnce(); Unit }, client::syncEvents)
        client.claim("http://127.0.0.1:17460", config.getValue("code").jsonPrimitive.content)
        val job = launch { realtime.run(key) }
        try {
            delay(400)
            fun ink(id: String) = buildJsonObject {
                put("id", id); put("paperKey", key); put("updatedAt", java.time.Instant.now().toString())
                put("deleted", false); put("rev", 0); put("deviceId", "realtime-qa")
                put("kind", "ink"); put("page", 1); put("tool", "pen"); put("color", "#000000"); put("width", 1)
                put("points", JsonArray(listOf(JsonArray(listOf(JsonPrimitive(.5), JsonPrimitive(.5), JsonPrimitive(.5), JsonPrimitive(0))))))
            }
            val phone = ink(UUID.randomUUID().toString())
            var start = android.os.SystemClock.elapsedRealtime()
            engine.saveLocal(phone)
            withTimeout(3000) {
                while (client.data("/api/papers/$key/annotations").jsonArray.none { it.jsonObject["id"] == phone["id"] }) delay(20)
            }
            val pushMs = android.os.SystemClock.elapsedRealtime() - start
            val desktop = ink(UUID.randomUUID().toString())
            start = android.os.SystemClock.elapsedRealtime()
            withContext(Dispatchers.IO) {
                val connection = URL("http://127.0.0.1:17460/api/papers/$key/annotations").openConnection() as HttpURLConnection
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Origin", "http://127.0.0.1:17460")
                connection.setRequestProperty("x-paperread-token", config.getValue("token").jsonPrimitive.content)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(desktop.toString().toByteArray()) }
                assertEquals(201, connection.responseCode); connection.disconnect()
            }
            withTimeout(3000) { while (database.annotations().get(desktop.getValue("id").jsonPrimitive.content) == null) delay(20) }
            val pullMs = android.os.SystemClock.elapsedRealtime() - start
            Log.i("RealtimeSyncQA", "phone-to-hub=${pushMs}ms desktop-to-phone-db=${pullMs}ms")
            assertTrue("phone push ${pushMs}ms", pushMs < 1100)
            assertTrue("desktop pull ${pullMs}ms", pullMs < 1100)
        } finally { job.cancelAndJoin(); database.close(); credentials.clear() }
    }
}
