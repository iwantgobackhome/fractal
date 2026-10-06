package app.fractal.reader

import app.fractal.data.*
import kotlinx.serialization.json.*

internal fun JsonObject.threadText(name: String) = (this[name] as? JsonPrimitive)?.contentOrNull.orEmpty()
internal fun readerJson(raw: String) = runCatching { WireJson.format.parseToJsonElement(raw).jsonObject }.getOrDefault(JsonObject(emptyMap()))
internal fun readerThreadId(id: String, json: JsonObject): String =
    (json["context"] as? JsonObject)?.threadText("threadId")?.takeIf { it.isNotBlank() } ?: id

internal data class ReaderTurn(val id: String, val threadId: String, val question: String, val quote: String,
    val page: Int?, val text: String, val status: String, val createdAt: String, val json: JsonObject,
    val request: AiRequestEntity? = null, val historyId: String? = null)
internal data class ReaderThread(val id: String, val turns: List<ReaderTurn>) {
    val title get() = turns.first().question
}

/** Hub context is retained verbatim by sync. Local intents bridge the time before Hub attachment. */
internal fun readerThreads(history: List<HistoryEntity>, requests: List<AiRequestEntity>): List<ReaderThread> {
    val remote = history.filter { !it.deleted }.mapNotNull { row ->
        val json = readerJson(row.json)
        if (json.threadText("kind") !in listOf("question", "explanation")) return@mapNotNull null
        val context = json["context"] as? JsonObject ?: JsonObject(emptyMap())
        val local = requests.firstOrNull { it.historyId == row.id || it.requestId == json.threadText("requestId") }
        val body = local?.let { readerJson(it.bodyJson) }
        val retained = local?.let { readerJson(it.contextJson) }
        ReaderTurn(row.id, context.threadText("threadId").ifBlank { body?.threadText("threadId").orEmpty().ifBlank { row.id } },
            json.threadText("question").ifBlank { body?.threadText("question").orEmpty().ifBlank { "Explain ${context.threadText("explanationKind").ifBlank { "selection" }}" } },
            context.threadText("selectedText").ifBlank { retained?.threadText("text").orEmpty() },
            context["page"]?.jsonPrimitive?.intOrNull ?: retained?.get("page")?.jsonPrimitive?.intOrNull,
            json.threadText("text"), row.status, json.threadText("createdAt").ifBlank { local?.createdAt ?: row.updatedAt }, json, local, row.id)
    }
    val claimed = remote.mapNotNull { it.request?.requestId }.toSet()
    val knownHistory = history.map { it.id }.toSet()
    val deletedRequests = history.filter { it.deleted }.map { readerJson(it.json).threadText("requestId") }.toSet()
    val local = requests.filter { it.kind in listOf("question", "explanation") && it.requestId !in claimed && it.requestId !in deletedRequests && (it.historyId == null || it.historyId !in knownHistory) }.map { row ->
        val body = readerJson(row.bodyJson); val context = readerJson(row.contextJson)
        ReaderTurn(row.requestId, body.threadText("threadId").ifBlank { row.requestId },
            body.threadText("question").ifBlank { "Explain ${body.threadText("kind").ifBlank { "selection" }}" },
            context.threadText("text"), context["page"]?.jsonPrimitive?.intOrNull, "", row.status, row.createdAt, body, row)
    }
    return (remote + local).sortedWith(compareBy<ReaderTurn> { it.createdAt }.thenBy { it.id })
        .groupBy { it.threadId }.map { (id, turns) -> ReaderThread(id, turns) }.sortedByDescending { it.turns.last().createdAt }
}

internal fun readerTurnCitations(turn: ReaderTurn, paperKey: String): List<Int> {
    val answer = turn.json["answer"] as? JsonObject
    val structured = (answer?.get("citations") as? JsonArray).orEmpty().mapNotNull {
        val citation = it as? JsonObject ?: return@mapNotNull null
        if (citation.threadText("paperKey").ifBlank { paperKey } != paperKey) null else citation["page"]?.jsonPrimitive?.intOrNull
    }
    return (structured + Regex("\\[p\\.(\\d+)]").findAll(turn.text).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()).distinct()
}
