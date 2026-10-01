package app.fractal.reader

import app.fractal.data.*
import kotlinx.serialization.json.jsonObject
import org.testng.Assert.*
import org.testng.annotations.Test

class DiscoveryIdentityTest {
    private fun row(doi: String? = null, arxiv: String? = null): LibraryEntity {
        val record = LibraryRecord("p", "p", "A real publication", listOf(Author(family = "Writer")), 2021,
            doi = doi, arxivId = arxiv, url = "https://example.org/p", addedAt = "2026-01-01T00:00:00Z", updatedAt = "2026-01-01T00:00:00Z", bibtexKey = "p")
        return libraryEntity(WireJson.format.encodeToJsonElement(LibraryRecord.serializer(), record).jsonObject, null, false)
    }
    @Test fun conflictingKnownIdentifiersCannotUnsaveAnUnrelatedRow() {
        val card = DiscoveryPaper(title = "A real publication", authors = listOf("Writer"), url = "https://example.org/p", doi = "10.1234/same", arxivId = "2106.09685")
        assertFalse(matchesPublication(card, row("10.1234/same", "1706.03762")))
        assertFalse(matchesPublication(card, row("10.1234/different", "2106.09685")))
    }
    @Test fun supportedAliasesMatchWithoutReinterpretingSourcePdfIdentity() {
        assertTrue(matchesPublication(DiscoveryPaper(title = "A", url = "https://example.org/p", doi = "HTTP://DX.DOI.ORG/10.1234%2FPAPER"), row("doi:10.1234/paper")))
        assertTrue(matchesPublication(DiscoveryPaper(title = "A", url = "https://example.org/p", arxivId = "https://arxiv.org/pdf/2106.09685v2.pdf"), row(arxiv = "2106.09685")))
        assertEquals(canonicalArxiv("https://www.arxiv.org/abs/HEP-TH/9901001v3"), "hep-th/9901001")
    }
    @Test fun malformedAndLooseTitleEvidenceStaysUnresolved() {
        assertNull(canonicalDoi("https://doi.org/no-identifier")); assertNull(canonicalDoi("10.1234/bad%zz"))
        assertFalse(matchesPublication(DiscoveryPaper(title = "A real publication", url = "https://other.org/p"), row()))
    }
}
