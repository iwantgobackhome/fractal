package app.fractal.data

import kotlinx.serialization.Serializable

@Serializable
data class PublicationMetadata(val year: Int? = null, val venue: String? = null,
    val publicationKind: String = "unknown", val publicationDate: String? = null,
    val oaAvailability: String = "unknown", val oaPdfUrl: String? = null, val sources: List<String> = emptyList())

@Serializable
data class FeedImage(val url: String, val width: Int? = null, val height: Int? = null, val alt: String? = null)

@Serializable
data class DiscoveryPaper(val id: String = "", val kind: String = "paper", val title: String,
    val titleTranslated: String? = null, val authors: List<String> = emptyList(), val abstract: String = "",
    val source: String = "", val url: String, val arxivId: String? = null, val doi: String? = null,
    val categories: List<String> = emptyList(), val publishedAt: String = "", val reason: String = "",
    val reasonCode: String = "", val inLibrary: Boolean = false, val publication: PublicationMetadata? = null,
    val dateBasis: String? = null, val topicIds: List<String> = emptyList(), val image: FeedImage? = null,
    val year: Int? = null, val venue: String? = null, val provider: String? = null,
    val relation: String? = null, val relations: List<String> = emptyList(), val citationCount: Int? = null)

@Serializable
data class FeedSection(val field: String, val label: String? = null, val topicId: String? = null,
    val items: List<DiscoveryPaper> = emptyList())
@Serializable
data class FeedSections(val top: List<DiscoveryPaper> = emptyList(), val byField: List<FeedSection> = emptyList(),
    val rankings: List<DiscoveryPaper> = emptyList(), val news: List<DiscoveryPaper> = emptyList(),
    val newsByField: List<FeedSection> = emptyList(), val generalNews: List<DiscoveryPaper> = emptyList(),
    val newsByTopic: List<FeedSection> = emptyList(), val recommended: List<DiscoveryPaper> = emptyList())
@Serializable
data class SourceStatus(val source: String = "", val provider: String = "", val state: String,
    val fetchedAt: String? = null, val message: String? = null, val errorCode: String? = null,
    val httpStatus: Int? = null, val retryAt: String? = null)
@Serializable
data class DiscoveryFeed(val week: String, val generatedAt: String? = null, val sections: FeedSections,
    val sourceStatus: List<SourceStatus> = emptyList())
@Serializable
data class RelatedPapers(val items: List<DiscoveryPaper> = emptyList(), val source: String,
    val fetchedAt: String? = null, val status: String? = null, val providerStatus: List<SourceStatus> = emptyList())
@Serializable
data class FieldTopic(val id: String, val field: String, val label: String, val query: String,
    val origin: String, val followed: Boolean, val score: Double? = null)
@Serializable
data class TopicResponse(val topics: List<FieldTopic>)
@Serializable
data class TaxonomyField(val code: String, val group: String, val name: Map<String, String>)
@Serializable
data class TaxonomyResponse(val items: List<TaxonomyField>)
@Serializable
data class ArticleBlock(val type: String, val text: String? = null, val image: FeedImage? = null)
@Serializable
data class NewsArticle(val url: String, val finalUrl: String, val title: String, val byline: String? = null,
    val siteName: String? = null, val publishedAt: String? = null, val lang: String? = null,
    val leadImage: FeedImage? = null, val blocks: List<ArticleBlock> = emptyList())

fun DiscoveryFeed.papers(): List<DiscoveryPaper> = (sections.top + sections.rankings +
    sections.recommended + sections.byField.flatMap { it.items }).distinctBy { it.id }
fun DiscoveryFeed.news(): List<DiscoveryPaper> = (sections.news + sections.generalNews +
    sections.newsByField.flatMap { it.items } + sections.newsByTopic.flatMap { it.items }).distinctBy { it.id }

/** Conservative invalidation: bibliographic edits cannot reuse another identity's related evidence. */
fun relatedResource(paper: LibraryEntity): String {
    val record = WireJson.format.decodeFromString<LibraryRecord>(paper.json)
    val identity = kotlinx.serialization.json.buildJsonObject {
        put("title", kotlinx.serialization.json.JsonPrimitive(record.title))
        put("doi", kotlinx.serialization.json.JsonPrimitive(record.doi))
        put("arxivId", kotlinx.serialization.json.JsonPrimitive(record.arxivId))
        put("authors", WireJson.format.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(Author.serializer()), record.authors))
        put("year", kotlinx.serialization.json.JsonPrimitive(record.year))
    }.toString()
    val hash = java.security.MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString("") { "%02x".format(it) }
    return "related:${paper.paperKey}:$hash"
}

/** A URL is a location, not a bibliographic identity. Keep contradictory evidence independent. */
fun publicationFingerprint(paper: DiscoveryPaper): String {
    fun normalized(value: String) = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFKC).lowercase().trim().replace(Regex("\\s+"), " ")
    fun doi(value: String?): String? = value?.trim()?.replace(Regex("^https?://(?:dx\\.)?doi\\.org/", RegexOption.IGNORE_CASE), "")
        ?.replace(Regex("^doi:\\s*", RegexOption.IGNORE_CASE), "")?.let { runCatching { java.net.URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }.getOrElse { _ -> it } }?.lowercase()
    fun arxiv(value: String?): String? = value?.trim()?.replace(Regex("^https?://(?:www\\.)?arxiv\\.org/(?:abs|pdf)/", RegexOption.IGNORE_CASE), "")
        ?.replace(Regex("\\.pdf$", RegexOption.IGNORE_CASE), "")?.replace(Regex("v\\d+$"), "")?.lowercase()
    val identity = kotlinx.serialization.json.buildJsonObject {
        put("doi", kotlinx.serialization.json.JsonPrimitive(doi(paper.doi)))
        put("arxiv", kotlinx.serialization.json.JsonPrimitive(arxiv(paper.arxivId)))
        put("title", kotlinx.serialization.json.JsonPrimitive(normalized(paper.title)))
        put("authors", kotlinx.serialization.json.JsonArray(paper.authors.map(::normalized).sorted().map { kotlinx.serialization.json.JsonPrimitive(it) }))
        put("year", kotlinx.serialization.json.JsonPrimitive(paper.publication?.year ?: paper.year))
        if (paper.doi == null && paper.arxivId == null) put("url", kotlinx.serialization.json.JsonPrimitive(paper.url))
    }.toString()
    return java.security.MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString("") { "%02x".format(it) }
}
