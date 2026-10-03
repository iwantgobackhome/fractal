package app.fractal.reader.update

import org.testng.Assert.*
import org.testng.annotations.Test

class ReleaseVerificationTest {
    @Test fun comparesNumericVersionsAndIgnoresBuildMetadata() {
        assertTrue(ReleaseVersion.parse("v0.10.0") > ReleaseVersion.parse("0.2.0"))
        assertEquals(ReleaseVersion.parse("1.2.3+build").compareTo(ReleaseVersion.parse("v1.2.3")), 0)
        assertTrue(ReleaseVersion.parse("1.0.0") > ReleaseVersion.parse("1.0.0-rc.1"))
        assertTrue(ReleaseVersion.parse("1.0.0-rc.10") > ReleaseVersion.parse("1.0.0-rc.2"))
        assertTrue(ReleaseVersion.parse("1.0.0-beta") > ReleaseVersion.parse("1.0.0-alpha.1"))
        assertTrue(ReleaseVersion.parse("1.0.0-alpha.1") > ReleaseVersion.parse("1.0.0-alpha"))
        assertTrue(ReleaseVersion.parse("1.0.0-beta") > ReleaseVersion.parse("1.0.0-10"))
    }
    @Test fun rejectsMalformedVersions() {
        for (value in listOf("1.2", "01.2.3", "1.2.3-01", "v1.2.3/path", "1.2.3-", "1.2.3+")) {
            assertTrue(runCatching { ReleaseVersion.parse(value) }.isFailure, value)
        }
    }
    @Test fun parsesAggregateChecksumsAndExactApkNames() {
        val hash = "ab".repeat(32)
        val name = "Fractal-0.3.0-android-debug.apk"
        val checksums = parseChecksums("$hash  $name\r\n${hash.uppercase()} *latest.yml\n")
        assertEquals(checksums[name], hash)
        assertEquals(checksums["latest.yml"], hash)
        assertNull(checksums["Fractal-0.2.0-android-debug.apk"])
    }
    @Test fun rejectsMissingMalformedDuplicateAndPathChecksums() {
        val hash = "ab".repeat(32)
        for (value in listOf("", "bad  app.apk", "$hash  ../app.apk", "$hash  dir\\app.apk", "$hash  .", "$hash  app.apk\n$hash  app.apk")) {
            assertTrue(runCatching { parseChecksums(value) }.isFailure, value)
        }
    }
}
