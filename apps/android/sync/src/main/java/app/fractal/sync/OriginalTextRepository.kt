package app.fractal.sync

import androidx.room.withTransaction
import app.fractal.data.*
import kotlinx.serialization.decodeFromString

data class TextPageResult(val page: OriginalTextPage?, val message: String, val retryable: Boolean)

/** A captured local PDF hash, current extraction version and physical page identify every hit map. */
class OriginalTextRepository(private val database: FractalDatabase, private val client: HubDataClient) {
    suspend fun page(key: String, hash: String, physicalPage: Int, pageCount: Int): TextPageResult {
        val cached = database.reader().textPage(hash, PDF_TEXT_LAYOUT_VERSION, physicalPage)
        if (cached != null) {
            val value = runCatching { WireJson.format.decodeFromString<PdfTextLayout>(cached.json) }.getOrNull()
            // Identical PDFs may have aliases; the derived cache identity is deliberately key-independent.
            val valid = value?.copy(paperKey = key)?.verifiedPage(key, hash, physicalPage, pageCount)
            if (valid != null) {
                database.reader().upsert(cached.copy(accessedAt = System.currentTimeMillis()))
                return TextPageResult(valid, "", false)
            }
        }
        return runCatching {
            val raw = client.data("/api/papers/${HubClient.keyPath(key)}/text-layout?page=$physicalPage")
            val value = WireJson.format.decodeFromString<PdfTextLayout>(raw.toString())
            val valid = value.verifiedPage(key, hash, physicalPage, pageCount)
            if (valid == null) TextPageResult(null, value.message ?: "Text positions do not match this PDF or extraction version.", value.retryable)
            else {
                database.withTransaction {
                    database.reader().upsert(PdfTextEntity(hash, PDF_TEXT_LAYOUT_VERSION, physicalPage, raw.toString(), System.currentTimeMillis()))
                    database.reader().trimTextPages()
                    while (database.reader().textBytes() > 128L * 1024 * 1024) database.reader().evictOldestTextPage()
                }
                TextPageResult(valid, "", false)
            }
        }.getOrElse {
            if (it is kotlinx.coroutines.CancellationException) throw it
            TextPageResult(null, "Original text positions are not cached for this page. Reconnect to load them, or deliberately select a region.", true)
        }
    }
}
