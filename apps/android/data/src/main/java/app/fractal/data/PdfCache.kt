package app.fractal.data

import android.content.Context
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PdfCache(context: Context) {
    private val root = File(context.filesDir, "pdfs").apply { mkdirs() }
    var limitBytes: Long = 2L * 1024 * 1024 * 1024

    fun file(sha256: String): File {
        require(sha256.matches(Regex("[0-9a-fA-F]{64}")))
        return File(root, sha256.lowercase() + ".pdf")
    }

    fun partial(sha256: String): File = File(root, sha256.lowercase() + ".part")

    /** Presence-only lookup for cache management; actual reads must use verified. */
    fun existing(sha256: String): File? {
        val found = file(sha256)
        if (!found.isFile) return null
        found.setLastModified(System.currentTimeMillis())
        return found
    }

    /** Read/acquisition boundary only: verify bytes on IO before trusting a cached PDF. */
    suspend fun verified(sha256: String): File? = withContext(Dispatchers.IO) {
        val found = file(sha256)
        if (!found.isFile) return@withContext null
        val actual = digest(found)
        if (!actual.equals(sha256, ignoreCase = true)) {
            check(found.delete() || !found.exists()) { "Cached PDF checksum mismatch; could not remove corrupted bytes." }
            return@withContext null
        }
        found.setLastModified(System.currentTimeMillis())
        found
    }

    /** Shelf rendering must not turn every displayed paper into a recent cache access. */
    fun contains(sha256: String): Boolean = file(sha256).isFile

    private fun digest(source: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        source.inputStream().use { input ->
            val bytes = ByteArray(8192)
            while (true) {
                val count = input.read(bytes)
                if (count < 0) break
                digest.update(bytes, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun commit(sha256: String): File {
        val source = partial(sha256)
        if (!digest(source).equals(sha256, ignoreCase = true)) {
            source.delete() // A later explicit retry must restart, rather than reuse bad partial bytes.
            throw IllegalArgumentException("PDF checksum mismatch")
        }
        val target = file(sha256)
        check(source.renameTo(target)) { "Could not commit PDF" }
        evict()
        return target
    }

    fun evict() {
        var total = root.listFiles()?.filter { it.extension == "pdf" }?.sumOf { it.length() } ?: 0
        val oldest = root.listFiles()?.filter { it.extension == "pdf" }?.sortedBy { it.lastModified() } ?: return
        for (file in oldest) {
            if (total <= limitBytes) break
            total -= file.length()
            file.delete()
        }
    }
}
