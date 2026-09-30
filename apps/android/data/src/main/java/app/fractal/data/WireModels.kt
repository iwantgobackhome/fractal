package app.fractal.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class Author(
    val given: String = "",
    val family: String,
    val orcid: String? = null,
)

@Serializable
data class LibraryRecord(
    val id: String,
    val paperKey: String,
    val title: String? = null,
    val authors: List<Author> = emptyList(),
    val year: Int? = null,
    val venue: String? = null,
    val doi: String? = null,
    val arxivId: String? = null,
    val url: String? = null,
    val abstract: String? = null,
    val tags: List<String> = emptyList(),
    val collections: List<String> = emptyList(),
    val addedAt: String,
    val updatedAt: String,
    val status: String = "unread",
    val bibtexKey: String,
    val saved: Boolean = true,
    val savedAt: String? = null,
    val lastReadAt: String? = null,
    val readProgress: ReadProgress? = null,
    val rev: Int = 0,
    val deviceId: String = "",
)

@Serializable
data class ReadProgress(val page: Int, val fraction: Double? = null,
    val blockId: String? = null, val scrollOffset: Double? = null)

@Serializable
data class NormalizedRect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
)

@Serializable
data class SyncedHighlight(
    val id: String,
    val paperKey: String,
    val updatedAt: String,
    val deleted: Boolean,
    val rev: Int,
    val deviceId: String,
    val kind: String = "highlight",
    val page: Int,
    val text: String,
    val color: String,
    val rects: List<NormalizedRect>,
    val note: String? = null,
)

@Serializable
data class Memo(
    val id: String,
    val paperKey: String,
    val updatedAt: String,
    val deleted: Boolean,
    val rev: Int,
    val deviceId: String,
    val kind: String = "memo",
    val page: Int,
    val text: String,
    val rect: NormalizedRect? = null,
    val quote: String? = null,
)

object WireJson {
    val format = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun annotationEntity(value: JsonObject, dirty: Boolean): AnnotationEntity {
        fun text(name: String): String = value[name]?.jsonPrimitive?.content ?: ""
        return AnnotationEntity(
            id = text("id"),
            paperKey = text("paperKey"),
            page = text("page").toIntOrNull() ?: 1,
            kind = text("kind"),
            updatedAt = text("updatedAt"),
            deleted = text("deleted") == "true",
            rev = text("rev").toIntOrNull() ?: 0,
            deviceId = text("deviceId"),
            dirty = dirty,
            json = value.toString(),
        )
    }
}
