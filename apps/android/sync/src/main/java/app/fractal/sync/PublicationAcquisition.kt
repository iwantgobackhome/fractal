package app.fractal.sync

import app.fractal.data.DiscoveryPaper
import app.fractal.data.text
import kotlinx.serialization.json.*

/** Explicit Read: canonical admission and verified cache, with no Save or read event. */
class PublicationAcquisition(
    private val client: HubDataClient,
    private val sync: SyncEngine,
    private val scope: () -> String,
    private val download: suspend (String, String, HubDataClient, () -> Unit) -> Unit,
) {
    suspend fun open(paper: DiscoveryPaper, currentRequest: () -> Unit = {}): String {
        val capturedScope = scope()
        require(capturedScope != "unpaired") { "Connect a Hub to acquire this PDF, or use the publication page." }
        val session = client.captured()
        val guard = {
            currentRequest()
            session.ensureCurrent()
            check(scope() == capturedScope) { "Hub changed; retry on the current connection." }
        }
        guard()
        val result = try {
            session.data("/api/publications/open", "POST", paper.bookmarkBody()).jsonObject
        } catch (error: HubHttpException) {
            if (error.reason == null && (error.code == 404 || error.code == 405)) throw java.io.IOException(
                "This Hub does not support Read PDF yet. Retry after updating the Hub, open the publication page, or save metadata and choose a PDF to link.", error)
            throw error
        }
        guard()
        val key = result.text("paperKey") ?: error("Hub returned no paper identity; retry or choose a PDF.")
        val record = result["record"] as? JsonObject ?: error("Hub returned no canonical record.")
        check(record.text("paperKey") == key) { "Hub returned conflicting paper identities." }
        check(result["hasPdf"]?.jsonPrimitive?.booleanOrNull == true) {
            "No readable PDF was acquired. Retry, open the publication page, or choose a PDF to link."
        }
        val returnedPaper = result["paper"] as? JsonObject ?: error("Hub returned no PDF metadata. Retry or choose a PDF.")
        fun verifiedMetadata(value: JsonObject): Pair<String, Int> {
            check(value.text("paperKey") == key) { "Hub returned conflicting PDF identities." }
            val sha = value.text("pdfSha256")
            val pages = value.text("pageCount")?.toIntOrNull()
            check(sha != null && sha.matches(Regex("[0-9a-f]{64}")) && pages != null && pages > 0) {
                "Hub returned incomplete PDF metadata. Retry or choose a PDF."
            }
            return sha to pages
        }
        val returnedMetadata = verifiedMetadata(returnedPaper)
        // Pull the normal authoritative snapshot used by the original reader.
        val snapshot = session.data("/api/papers/${HubClient.keyPath(key)}").jsonObject
        guard()
        val authoritativePaper = snapshot["paper"] as? JsonObject ?: error("PDF metadata is unavailable. Retry or choose a PDF.")
        val metadata = verifiedMetadata(authoritativePaper)
        check(metadata == returnedMetadata) { "PDF changed during acquisition. Retry to load the current original." }
        sync.acceptPublication(record, snapshot, guard)
        guard()
        download(key, metadata.first, session, guard)
        guard()
        return key
    }
}
