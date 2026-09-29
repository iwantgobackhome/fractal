package app.fractal.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class HubClient(private val credentials: HubCredentialStore) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()

    companion object {
        private val jsonType = "application/json; charset=utf-8".toMediaType()
        fun keyPath(key: String): String = URLEncoder.encode(key, "UTF-8").replace("+", "%20")
    }

    private fun request(
        url: String,
        path: String,
        method: String = "GET",
        body: JsonElement? = null,
        token: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): Request {
        val builder = Request.Builder().url(url.trimEnd('/') + path)
        if (token != null) builder.header("Authorization", "Bearer $token")
        for ((name, value) in headers) builder.header(name, value)
        val requestBody = body?.toString()?.toRequestBody(jsonType)
        builder.method(method, requestBody)
        return builder.build()
    }

    fun execute(
        path: String,
        method: String = "GET",
        body: JsonElement? = null,
        headers: Map<String, String> = emptyMap(),
    ): Response {
        val paired = credentials.load() ?: throw IOException("Hub is not paired")
        return http.newCall(request(paired.url, path, method, body, paired.token, headers)).execute()
    }

    suspend fun data(path: String, method: String = "GET", body: JsonElement? = null): JsonElement =
        withContext(Dispatchers.IO) {
            execute(path, method, body).use { response ->
                if (!response.isSuccessful) throw IOException("Hub HTTP ${response.code}")
                val raw = response.body?.string() ?: throw IOException("Empty hub response")
                WireJsonAdapter.data(raw)
            }
        }

    suspend fun pair(payload: PairingPayload, deviceName: String): HubCredentials {
        var last: Exception? = null
        for (url in payload.urls) {
            try {
                return claim(url, payload.code, payload.name, payload.hubId, deviceName)
            } catch (error: Exception) {
                last = error
            }
        }
        throw last ?: IOException("No reachable hub address")
    }

    suspend fun claim(
        url: String,
        code: String,
        hubName: String = "Fractal",
        hubId: String = "",
        deviceName: String = "Fractal Android",
    ): HubCredentials = withContext(Dispatchers.IO) {
        val base = url.trimEnd('/')
        http.newCall(request(base, "/api/hub/ping")).execute().use { ping ->
            if (!ping.isSuccessful) throw IOException("Hub ping failed")
        }
        val body = buildJsonObject {
            put("code", code)
            put("name", deviceName)
            put("platform", "android")
        }
        val response = http.newCall(request(base, "/api/pairing/claim", "POST", body)).execute()
        response.use {
            if (!it.isSuccessful) throw IOException("Pairing code rejected (HTTP ${it.code})")
            val data = WireJsonAdapter.data(it.body?.string() ?: "").jsonObject
            val deviceId = data["device"]?.jsonObject?.get("id")?.jsonPrimitive?.content ?: ""
            val token = data["deviceToken"]?.jsonPrimitive?.content ?: ""
            require(deviceId.isNotBlank() && token.isNotBlank())
            HubCredentials(base, hubName, hubId, deviceId, token).also(credentials::save)
        }
    }
}

object WireJsonAdapter {
    val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    fun data(raw: String): JsonElement {
        return json.parseToJsonElement(raw).jsonObject["data"]
            ?: throw IOException("Hub response has no data")
    }
}
