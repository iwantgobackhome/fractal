package app.fractal.sync

import kotlinx.serialization.json.*

/** Preserve folder dependency order and bound the actual UTF-8 request body. */
internal object SyncPushBatches {
    const val MAX_BYTES = 48 * 1024
    const val MAX_ENTRIES = 1000
    private val kinds = listOf("folders", "papers", "history", "annotations")

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
                require(emptyBytes + itemBytes <= MAX_BYTES) {
                    "A single sync $kind item exceeds the 48 KiB upload limit; reduce its size before retrying."
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
