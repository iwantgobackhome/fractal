package app.fractal.reader.update

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import app.fractal.reader.BuildConfig
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

internal data class ReleaseUpdate(val version: String, val name: String, val apkUrl: String, val checksumsUrl: String)
internal data class UpdateStatus(
    val checking: Boolean = false,
    val release: ReleaseUpdate? = null,
    val progress: Int? = null,
    val ready: Boolean = false,
    val message: UpdateMessage? = null,
)
internal enum class UpdateMessage { Error, Current, InstallPermission }

internal class UpdateViewModel(application: Application) : AndroidViewModel(application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val preferences = application.getSharedPreferences("app_updates", 0)
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val mutableStatus = MutableStateFlow(UpdateStatus())
    val status = mutableStatus.asStateFlow()
    private val directory = File(application.cacheDir, "updates").apply { mkdirs() }

    init {
        val name = preferences.getString("pendingName", null)
        if (name != null && File(directory, name).isFile) mutableStatus.value = UpdateStatus(ready = true)
    }

    fun check(manual: Boolean = false) {
        if (mutableStatus.value.checking || mutableStatus.value.progress != null || mutableStatus.value.ready) return
        val now = System.currentTimeMillis()
        val last = preferences.getLong("lastCheck", 0)
        if (!manual && now >= last && now - last < TimeUnit.HOURS.toMillis(24)) return
        preferences.edit().putLong("lastCheck", now).apply()
        mutableStatus.value = UpdateStatus(checking = true)
        scope.launch {
            try {
                val release = withContext(Dispatchers.IO) {
                    val json = Json.parseToJsonElement(getText("https://api.github.com/repos/iwantgobackhome/fractal/releases/latest")).jsonObject
                    val tag = requireNotNull(json["tag_name"]).jsonPrimitive.content
                    if (ReleaseVersion.parse(tag) <= ReleaseVersion.parse(BuildConfig.VERSION_NAME)) return@withContext null
                    val version = tag.removePrefix("v")
                    val name = "Fractal-$version-android-debug.apk"
                    val assets = requireNotNull(json["assets"]).jsonArray.map { it.jsonObject }
                    fun assetUrl(assetName: String): String = requireNotNull(assets.singleOrNull { it["name"]?.jsonPrimitive?.content == assetName })["browser_download_url"]!!.jsonPrimitive.content
                    ReleaseUpdate(version, name, assetUrl(name), assetUrl("SHA256SUMS.txt"))
                }
                mutableStatus.value = when {
                    release == null -> UpdateStatus(message = if (manual) UpdateMessage.Current else null)
                    !manual && preferences.getString("dismissedVersion", null) == release.version -> UpdateStatus()
                    else -> UpdateStatus(release = release)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableStatus.value = UpdateStatus(message = if (manual) UpdateMessage.Error else null)
            }
        }
    }

    fun later() {
        preferences.edit().putString("dismissedVersion", mutableStatus.value.release?.version).apply()
        mutableStatus.value = UpdateStatus()
    }

    fun download() {
        val release = mutableStatus.value.release ?: return
        if (mutableStatus.value.progress != null) return
        mutableStatus.value = UpdateStatus(release = release, progress = 0)
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val checksum = requireNotNull(parseChecksums(getText(release.checksumsUrl))[release.name]) { "Missing APK checksum" }
                    val temporary = File(directory, "download.part")
                    try {
                        client.newCall(request(release.apkUrl)).execute().use { response ->
                            check(response.isSuccessful) { "APK download failed" }
                            val body = requireNotNull(response.body)
                            val total = body.contentLength()
                            require(total <= MAX_APK_SIZE) { "APK too large" }
                            var count = 0L
                            val digest = MessageDigest.getInstance("SHA-256")
                            body.byteStream().use { input ->
                                temporary.outputStream().use { output ->
                                    val buffer = ByteArray(64 * 1024)
                                    while (true) {
                                        val read = input.read(buffer)
                                        if (read < 0) break
                                        count += read
                                        require(count <= MAX_APK_SIZE) { "APK too large" }
                                        output.write(buffer, 0, read)
                                        digest.update(buffer, 0, read)
                                        if (total > 0) mutableStatus.value = UpdateStatus(release = release, progress = (count * 100 / total).toInt().coerceIn(0, 100))
                                    }
                                }
                            }
                            require(count > 0 && (total < 0 || count == total)) { "Incomplete APK" }
                            require(digest.digest().hex() == checksum) { "APK checksum mismatch" }
                        }
                        val apk = File(directory, release.name)
                        check(temporary.renameTo(apk)) { "Could not save update" }
                        preferences.edit().putString("pendingName", release.name).putString("pendingHash", checksum).apply()
                    } finally { temporary.delete() }
                }
                mutableStatus.value = UpdateStatus(release = release, ready = true)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableStatus.value = UpdateStatus(release = release, message = UpdateMessage.Error)
            }
        }
    }

    suspend fun verifiedInstaller(): File = withContext(Dispatchers.IO) {
        val name = requireNotNull(preferences.getString("pendingName", null))
        require(Regex("Fractal-[0-9A-Za-z.+-]+-android-debug\\.apk").matches(name))
        val file = File(directory, name)
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read) }
        }
        require(digest.digest().hex() == preferences.getString("pendingHash", null)) { "APK checksum mismatch" }
        file
    }

    fun message(message: UpdateMessage) { mutableStatus.value = mutableStatus.value.copy(message = message) }
    fun clearMessage() { mutableStatus.value = mutableStatus.value.copy(message = null) }
    fun installed() {
        preferences.edit().remove("pendingName").remove("pendingHash").apply()
        mutableStatus.value = UpdateStatus()
    }
    private fun request(url: String): Request {
        require(url.startsWith("https://")) { "HTTPS required" }
        return Request.Builder().url(url).header("Accept", "application/vnd.github+json").header("User-Agent", "Fractal/${BuildConfig.VERSION_NAME}").build()
    }
    private fun getText(url: String): String = client.newCall(request(url)).execute().use { response ->
        check(response.isSuccessful) { "Release request failed" }
        val body = requireNotNull(response.body)
        body.byteStream().use { input ->
            val bytes = input.readBytesLimited(2 * 1024 * 1024)
            bytes.toString(Charsets.UTF_8)
        }
    }
    override fun onCleared() { scope.cancel(); client.dispatcher.cancelAll() }
    private companion object { const val MAX_APK_SIZE = 512L * 1024 * 1024 }
}

private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 255) }
private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val read = read(buffer)
        if (read < 0) break
        require(output.size() + read <= limit) { "Release response too large" }
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}
