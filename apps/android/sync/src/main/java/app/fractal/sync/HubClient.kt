package app.fractal.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
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

interface HubDataClient {
    suspend fun data(path: String, method: String = "GET", body: JsonElement? = null): JsonElement
    /** Optional immutable paired-session capture for a multi-request operation. */
    fun captured(): HubDataClient = this
    fun ensureCurrent() {}
}
interface HubPdfSession : HubDataClient {
    fun executePdf(path: String, headers: Map<String, String>): Response
    fun executeLink(key: String, bytes: ByteArray): Response
    suspend fun feedImage(path: String): ByteArray = throw IOException("Hub images unavailable")
}
interface HubHistoryClient : HubDataClient {
    suspend fun attachHistory(path: String, body: JsonObject): String
}

fun isHubConnectionError(failure: Throwable): Boolean =
    generateSequence(failure) { it.cause }.any {
        it is java.net.ConnectException || it is java.net.SocketTimeoutException || it is java.net.UnknownHostException
    }

class HubHttpException(val code: Int, val reason: String? = null) : IOException(reason ?: "Hub HTTP $code")

private fun hubFailure(response: Response): HubHttpException {
    val reason = runCatching {
        val body = response.body?.string().orEmpty()
        if (body.length > 16384) null else WireJsonAdapter.json.parseToJsonElement(body)
            .jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content?.take(1000)
    }.getOrNull()?.takeIf { it.isNotBlank() }
    return HubHttpException(response.code, reason)
}

class HubClient(private val credentials: HubCredentialStore) : HubHistoryClient {
    private val http = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()
    // Topic creation has no server idempotency key. A transport retry after admission
    // can duplicate it before the durable queue gets a chance to reconcile by GET.
    private val admissionHttp = http.newBuilder().retryOnConnectionFailure(false).build()
    // The publication resolver owns a 60-second network budget; allow extraction
    // and JSON processing after that, without extending unrelated Hub requests.
    private val publicationHttp = http.newBuilder().readTimeout(90, TimeUnit.SECONDS)
        .callTimeout(100, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
    private val imageHttp = http.newBuilder().followRedirects(false).followSslRedirects(false)
        .callTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private fun transport(path: String, method: String) = when {
        method == "POST" && path.substringBefore('?') == "/api/feed/topics" -> admissionHttp
        method == "POST" && path.substringBefore('?') == "/api/publications/open" -> publicationHttp
        else -> http
    }

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
        return transport(path, method).newCall(request(paired.url, path, method, body, paired.token, headers)).execute()
    }

    override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement =
        withContext(Dispatchers.IO) {
            execute(path, method, body).use { response ->
                if (!response.isSuccessful) throw hubFailure(response)
                val raw = response.body?.string() ?: throw IOException("Empty hub response")
                WireJsonAdapter.data(raw)
            }
        }

    suspend fun syncEvents(paperKey: String, onChange: () -> Unit): Unit = withContext(Dispatchers.IO) {
        val paired = credentials.load() ?: throw IOException("Hub is not paired")
        val call = http.newCall(request(paired.url, "/api/sync/events?paperKey=${keyPath(paperKey)}", token = paired.token))
        suspendCancellableCoroutine<Unit> { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        response.use {
                            if (!it.isSuccessful) throw hubFailure(it)
                            val source = it.body?.source() ?: throw IOException("Empty sync stream")
                            while (continuation.isActive) {
                                val line = source.readUtf8Line() ?: break
                                if (credentials.load() != paired) throw IOException("Hub connection changed")
                                if (line.startsWith("data:")) onChange()
                            }
                        }
                        if (continuation.isActive) continuation.resume(Unit)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    }
                }
            })
        }
    }

    override fun captured(): HubPdfSession {
        val paired = credentials.load() ?: throw IOException("Hub is not paired")
        return object : HubPdfSession {
            override fun ensureCurrent() {
                check(credentials.load() == paired) { "Hub connection changed; retry on the current connection." }
            }
            override fun executePdf(path: String, headers: Map<String, String>): Response {
                ensureCurrent()
                return http.newCall(request(paired.url, path, token = paired.token, headers = headers)).execute()
            }
            override suspend fun feedImage(path: String): ByteArray {
                require(Regex("^/api/feed/images/[0-9a-f]{64}$").matches(path)) { "Invalid Hub image" }
                ensureCurrent()
                return suspendCancellableCoroutine { continuation ->
                    val call = imageHttp.newCall(request(paired.url, path, token = paired.token))
                    continuation.invokeOnCancellation { call.cancel() }
                    call.enqueue(object : Callback {
                        override fun onFailure(call: Call, error: IOException) {
                            if (continuation.isActive) continuation.resumeWithException(error)
                        }
                        override fun onResponse(call: Call, response: Response) {
                            try {
                                val bytes = response.use {
                                    ensureCurrent()
                                    check(it.isSuccessful) { "Image unavailable" }
                                    val body = it.body ?: error("Image unavailable")
                                    check(body.contentType()?.let { type -> type.type == "image" && type.subtype in listOf("png", "jpeg", "webp", "gif", "avif") } == true)
                                    check(body.contentLength() <= 5L * 1024 * 1024)
                                    body.byteStream().use { input ->
                                        val output = ByteArrayOutputStream()
                                        val buffer = ByteArray(8192)
                                        while (true) {
                                            check(continuation.isActive) { "Image cancelled" }
                                            ensureCurrent()
                                            val count = input.read(buffer)
                                            if (count < 0) break
                                            check(output.size() + count <= 5 * 1024 * 1024) { "Image too large" }
                                            output.write(buffer, 0, count)
                                        }
                                        check(output.size() > 0)
                                        output.toByteArray()
                                    }
                                }
                                ensureCurrent()
                                if (continuation.isActive) continuation.resume(bytes)
                            } catch (error: Exception) {
                                if (continuation.isActive) continuation.resumeWithException(error)
                            }
                        }
                    })
                }
            }
            override fun executeLink(key: String, bytes: ByteArray): Response {
                ensureCurrent()
                val upload = Request.Builder().url(paired.url.trimEnd('/') + "/api/library/${keyPath(key)}/pdf")
                    .header("Authorization", "Bearer ${paired.token}")
                    .post(bytes.toRequestBody("application/pdf".toMediaType())).build()
                return http.newCall(upload).execute()
            }
            override suspend fun data(path: String, method: String, body: JsonElement?): JsonElement = withContext(Dispatchers.IO) {
                ensureCurrent()
                transport(path, method).newCall(request(paired.url, path, method, body, paired.token)).execute().use {
                    if (!it.isSuccessful) throw hubFailure(it)
                    ensureCurrent()
                    WireJsonAdapter.data(it.body?.string() ?: throw IOException("Empty hub response"))
                }
            }
        }
    }

    /** Explicit user-selected association. No URL fetching, catalog identity derivation or read event. */
    suspend fun linkPdf(key: String, bytes: ByteArray, session: HubPdfSession = captured()): JsonObject = withContext(Dispatchers.IO) {
        require(bytes.size in 1..(300 * 1024 * 1024)) { "Choose a PDF no larger than 300 MiB." }
        session.executeLink(key, bytes).use {
            if (!it.isSuccessful) throw hubFailure(it)
            session.ensureCurrent()
            WireJsonAdapter.data(it.body?.string() ?: "").jsonObject
        }
    }

    /** Admission is durable at the Hub. Close this observation as soon as its ID is known. */
    override suspend fun attachHistory(path: String, body: JsonObject): String = withContext(Dispatchers.IO) {
        execute(path, "POST", body).use { response ->
            if (!response.isSuccessful) throw HubHttpException(response.code)
            val parser = SseParser()
            val reader = response.body?.charStream()?.buffered() ?: throw IOException("Empty generation response")
            while (true) {
                val line = reader.readLine() ?: break
                parser.consume(line)?.historyId?.let { return@withContext it }
            }
            throw IOException("The Hub did not provide durable history; request context is retained for review.")
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
        hubName: String = "News Papers",
        hubId: String = "",
        deviceName: String = "News Papers Android",
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
            if (!it.isSuccessful) throw hubFailure(it)
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
