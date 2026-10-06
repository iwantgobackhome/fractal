package app.fractal.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class AnswerPlacement(val page: Int, val x: Float, val y: Float, val state: String = "open", val updatedAt: String) {
    init { java.time.Instant.parse(updatedAt); require(page > 0 && x.isFinite() && y.isFinite() && x in 0f..1f && y in 0f..1f && state in setOf("open", "collapsed", "dismissed")) }
    fun json(): JsonObject = WireJson.format.encodeToJsonElement(serializer(), this).jsonObject
}
fun HistoryEntity.answerPlacement(): AnswerPlacement? = runCatching {
    val value = WireJson.format.parseToJsonElement(json).jsonObject["placement"] ?: return null
    WireJson.format.decodeFromJsonElement<AnswerPlacement>(value)
}.getOrNull()

/** A thread's named root wins; legacy threads fall back to their oldest turn. */
fun answerThreadRoot(entries: List<HistoryEntity>, threadId: String): HistoryEntity? = entries.filter { row ->
    !row.deleted && runCatching {
        val context = WireJson.format.parseToJsonElement(row.json).jsonObject["context"] as? JsonObject
        (context?.text("threadId") ?: row.id) == threadId
    }.getOrDefault(false)
}.let { rows -> rows.firstOrNull { it.id == threadId } ?: rows.minWithOrNull(compareBy<HistoryEntity> {
    runCatching { WireJson.format.parseToJsonElement(it.json).jsonObject.text("createdAt") }.getOrNull() ?: it.updatedAt
}.thenBy { it.id }) }
