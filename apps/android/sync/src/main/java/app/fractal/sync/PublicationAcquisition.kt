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
            if (error.code == 404 || error.code == 405) throw java.io.IOException(
                "This Hub does not support Read PDF yet. Retry after updating the Hub, open the publication page, or save metadata and choose a PDF to link.", error)
            throw error
        }
        guard()
        val key = result.text("paperKey") ?: error("Hub returned no paper identity; retry or choose a PDF.")
        val record = result["record"] as? JsonObject ?: error("Hub returned no canonical record.")
        check(record.text("paperKey") == key) { "Hub returned conflicting paper identities." }
        sync.acceptPaper(record, guard)
        check(result["hasPdf"]?.jsonPrimitive?.booleanOrNull == true) {
            "No readable PDF was acquired. Retry, open the publication page, or choose a PDF to link."
        }
        // Pull the normal authoritative snapshot used by the original reader.
        val metadata = sync.refreshPaperMetadata(key, session, guard)
            ?: error("PDF metadata is unavailable. Retry or choose a PDF to link.")
        guard()
        download(key, metadata.first, session, guard)
        guard()
        return key
    }
}
