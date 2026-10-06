package app.fractal.sync

import app.fractal.data.*
import kotlinx.serialization.json.*

/** Sync requires the full history record, while the queue retains only the edited fields. */
internal fun historyMutationEntry(mutation: MetadataMutation): JsonObject {
    val base = WireJson.format.parseToJsonElement(mutation.baseJson).jsonObject
    val patch = WireJson.format.parseToJsonElement(mutation.patchJson).jsonObject
    return JsonObject(MetadataMerge.apply(base, base, patch) + ("deviceId" to JsonPrimitive(mutation.deviceId)))
}
