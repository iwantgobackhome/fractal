package app.fractal.reader

import kotlinx.serialization.json.*

internal data class ReaderModel(val value: String, val label: String, val available: Boolean)
internal fun readerModels(response: JsonObject?): List<ReaderModel> = (response?.get("providers") as? JsonArray).orEmpty().flatMap { value ->
    val p = value.jsonObject; val status = p["status"]?.jsonObject
    val provider = status?.get("id")?.jsonPrimitive?.content.orEmpty()
    val available = status?.get("installed")?.jsonPrimitive?.booleanOrNull != false && status?.get("loggedIn")?.jsonPrimitive?.booleanOrNull != false
    (p["models"] as? JsonArray).orEmpty().map { m ->
        val id = m.jsonObject["id"]?.jsonPrimitive?.content.orEmpty()
        ReaderModel("$provider/$id", "$provider · ${m.jsonObject["label"]?.jsonPrimitive?.contentOrNull ?: id}", available)
    }
}
internal fun resolveReaderModel(value: String, options: List<ReaderModel>): Pair<String, String>? {
    if (value.isEmpty()) return null // Explicit Hub default is a legitimate choice.
    require(options.any { it.value == value && it.available }) { "The explicitly selected model is unavailable" }
    return value.substringBefore('/') to value.substringAfter('/')
}
