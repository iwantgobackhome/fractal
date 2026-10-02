package app.fractal.sync

import kotlinx.serialization.json.*

/** Bound normal UTF-8 requests, isolate large items, and preserve folder dependency order. */
internal object SyncPushBatches {
    const val MAX_BYTES = 48 * 1024
    const val MAX_ENTRIES = 1000
    private val kinds = listOf("folders", "papers", "history", "annotations")

    suspend fun push(
        payload: JsonObject,
        client: HubDataClient,
        onWarning: (String) -> Unit,
        accept: suspend (JsonObject) -> Unit,
    ) {
        for (batch in split(payload)) {
            val response = try {
                client.data("/api/sync/push", "POST", batch).jsonObject
            } catch (error: HubHttpException) {
                if (error.code != 413 || batch.toString().toByteArray(Charsets.UTF_8).size <= MAX_BYTES) throw error
                onWarning("A large sync item was rejected by the Hub and remains pending; update the desktop app or reduce the item size.")
                continue
            }
            accept(response)
        }
    }

    fun split(payload: JsonObject): List<JsonObject> {
        val batches = mutableListOf<JsonObject>()
        var rows = kinds.associateWith { mutableListOf<JsonElement>() }
        fun body() = JsonObject(rows.mapValues { JsonArray(it.value) })
        val emptyBytes = body().toString().toByteArray(Charsets.UTF_8).size
        var bytes = emptyBytes
        fun flush() {
            if (rows.values.any { it.isNotEmpty() }) batches += body()
            rows = kinds.associateWith { mutableListOf<JsonElement>() }
            bytes = emptyBytes
        }
        for (kind in kinds) {
            for (item in payload[kind]?.jsonArray.orEmpty()) {
                val itemBytes = item.toString().toByteArray(Charsets.UTF_8).size
                if (emptyBytes + itemBytes > MAX_BYTES) {
                    flush()
                    rows.getValue(kind).add(item)
                    flush()
                    continue
                }
                val extra = itemBytes + if (rows.getValue(kind).isEmpty()) 0 else 1
                if (rows.getValue(kind).size == MAX_ENTRIES || bytes + extra > MAX_BYTES) flush()
                bytes += itemBytes + if (rows.getValue(kind).isEmpty()) 0 else 1
                rows.getValue(kind).add(item)
            }
        }
        flush()
        return batches
    }
}
