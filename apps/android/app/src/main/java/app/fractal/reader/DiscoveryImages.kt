package app.fractal.reader

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import app.fractal.data.FeedImage
import app.fractal.sync.HubCredentials
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.security.MessageDigest

internal fun validatedFeedImagePath(value: String?): String? = value?.takeIf {
    Regex("^/api/feed/images/[0-9a-f]{64}$").matches(it)
}
private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
    .joinToString("") { "%02x".format(it) }
internal fun imageSessionIdentity(paired: HubCredentials) = digest(listOf(paired.url, paired.hubId, paired.deviceId, paired.token).joinToString("\u0000"))

/** App-owned cache, bounded disk + sampled bitmaps; credentials are only a one-way cache identity. */
internal class DiscoveryImages(private val app: ReaderApplication) {
    private val lock = Mutex()
    private val memory = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }
    private val directory get() = File(app.cacheDir, "discovery-images").apply { mkdirs() }
    suspend fun load(path: String, paired: HubCredentials, guard: () -> Unit): Bitmap = lock.withLock {
        require(validatedFeedImagePath(path) != null)
        val session = app.client.captured()
        fun current() { session.ensureCurrent(); check(app.credentials.load() == paired); guard() }
        current()
        val key = imageSessionIdentity(paired) + "-" + path.substringAfterLast('/')
        memory.get(key)?.let { current(); return@withLock it }
        val bitmap = withContext(Dispatchers.IO) {
            currentCoroutineContext().ensureActive(); current()
            val context = currentCoroutineContext()
            val file = File(directory, key)
            var fromDisk = file.isFile && file.length() in 1..(5L * 1024 * 1024)
            var bytes = if (fromDisk) file.readBytes() else session.feedImage(path)
            currentCoroutineContext().ensureActive(); current()
            fun decode(): Bitmap? {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                check(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= 20_000_000)
                var sample = 1
                while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) sample *= 2
                context.ensureActive(); current()
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            }
            val result = runCatching { decode() }.getOrElse { error ->
                if (error is CancellationException) throw error
                if (!fromDisk) throw error
                file.delete(); fromDisk = false; bytes = session.feedImage(path); current(); decode()
            } ?: error("Image unavailable")
            currentCoroutineContext().ensureActive(); current()
            if (!fromDisk) {
                val pending = File(directory, "$key.pending")
                try { pending.writeBytes(bytes); current(); check(pending.renameTo(file)) } finally { pending.delete() }
            }
            file.setLastModified(System.currentTimeMillis())
            val files = directory.listFiles()?.filter { !it.name.endsWith(".pending") }?.sortedBy { it.lastModified() }.orEmpty()
            var total = files.sumOf { it.length() }; var count = files.size
            for (old in files) { if (total <= 24L * 1024 * 1024 && count <= 64) break
                val length = old.length(); if (old != file && old.delete()) { total -= length; count-- }
            }
            result
        }
        current(); memory.put(key, bitmap); bitmap
    }
}

/** Omitted until decoded; absent/failing images leave a compact readable text row. */
@Composable internal fun DiscoveryImage(app: ReaderApplication, image: FeedImage?, news: Boolean = false,
    detail: Boolean = false, onOpen: (() -> Unit)? = null, title: String = "") {
    val path = validatedFeedImagePath(image?.url) ?: return
    val paired = app.credentials.load() ?: return
    val identity = imageSessionIdentity(paired) + path
    var bitmap by remember(identity) { mutableStateOf<Bitmap?>(null) }
    var mounted by remember(identity) { mutableStateOf(true) }
    val request = remember(identity) { Any() }
    val activeRequest = rememberUpdatedState(request)
    DisposableEffect(request) { mounted = true; onDispose { mounted = false } }
    LaunchedEffect(identity) {
        val guard = { check(mounted && activeRequest.value === request && app.credentials.load() == paired) }
        try { val decoded = app.discoveryImages.load(path, paired, guard); guard(); bitmap = decoded }
        catch (error: Exception) { if (error is CancellationException) throw error }
    }
    bitmap?.let { ready ->
        if (app.credentials.load() != paired) return
        var modifier = Modifier.fillMaxWidth().height(if (detail) 240.dp else 152.dp).padding(bottom = 12.dp)
        if (onOpen != null) modifier = modifier.clickable(onClickLabel = title, onClick = onOpen)
        Image(ready.asImageBitmap(), image?.alt?.takeIf { it.isNotBlank() } ?: if (onOpen != null) title else null,
            modifier, contentScale = if (news && !detail) ContentScale.Crop else ContentScale.Fit)
    }
}
