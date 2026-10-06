package app.fractal.sync

import app.fractal.data.*
import kotlinx.serialization.json.*

/** A card may be moved before generation attaches its first history entry, even offline. */
internal suspend fun reconcileAnswerPlacementIntents(database: FractalDatabase, paperKey: String) {
    val history = database.metadata().historyEntries(paperKey)
    for (intent in database.reader().requests(paperKey).filter { it.kind == "draft" && it.requestId.startsWith("answer-placement:") }) {
        val placement = runCatching { WireJson.format.decodeFromString<AnswerPlacement>(intent.bodyJson) }.getOrNull() ?: continue
        val thread = intent.requestId.removePrefix("answer-placement:")
        val root = answerThreadRoot(history, thread) ?: continue
        val device = runCatching { WireJson.format.parseToJsonElement(intent.contextJson).jsonObject.text("deviceId") }.getOrNull() ?: "android"
        MetadataStore(database) { device }.placeAnswer(root.id, placement)
    }
}
