package app.fractal.sync

import android.content.Context
import app.fractal.data.PdfCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

data class RangePlan(
    val range: String?,
    val ifRange: String?,
    val appendOnPartial: Boolean,
) {
    companion object {
        fun forPartial(bytes: Long, etag: String?): RangePlan {
            if (bytes <= 0L) return RangePlan(null, null, false)
            return RangePlan("bytes=$bytes-", etag, true)
        }
    }
}

class PdfDownloader(
    context: Context,
    private val client: HubClient,
    private val cache: PdfCache = PdfCache(context),
) {
    private val prefs = context.applicationContext.getSharedPreferences("pdf_transfer", Context.MODE_PRIVATE)

    suspend fun download(paperKey: String, sha256: String, session: HubPdfSession? = null,
        guard: () -> Unit = {}): File = withContext(Dispatchers.IO) {
        guard()
        cache.verified(sha256)?.let { guard(); return@withContext it }
        val part = cache.partial(sha256)
        val etag = prefs.getString(sha256, null)
        val plan = RangePlan.forPartial(if (part.exists()) part.length() else 0, etag)
        val headers = buildMap {
            plan.range?.let { put("Range", it) }
            plan.ifRange?.let { put("If-Range", it) }
        }
        val path = "/api/papers/${HubClient.keyPath(paperKey)}/pdf"
        (session?.executePdf(path, headers) ?: client.execute(path, headers = headers)).use { response ->
            guard()
            if (response.code == 304) {
                return@withContext cache.verified(sha256)
                    ?: throw IOException("Cached PDF is missing")
            }
            if (response.code == 416 && part.isFile) {
                guard()
                return@withContext cache.commit(sha256)
            }
            if (response.code != 200 && response.code != 206) {
                throw IOException("PDF HTTP ${response.code}")
            }
            val incomingEtag = response.header("ETag")
            if (incomingEtag != null) prefs.edit().putString(sha256, incomingEtag).apply()
            val append = response.code == 206 && plan.appendOnPartial
            java.io.FileOutputStream(part, append).use { output ->
                val body = response.body ?: throw IOException("Empty PDF response")
                body.byteStream().use { input -> input.copyTo(output) }
            }
        }
        guard()
        cache.commit(sha256)
    }
}
