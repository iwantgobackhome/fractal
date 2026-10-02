package app.fractal.reader.update

import java.math.BigInteger

internal data class ReleaseVersion(val numbers: List<BigInteger>, val prerelease: List<String>) : Comparable<ReleaseVersion> {
    override fun compareTo(other: ReleaseVersion): Int {
        numbers.zip(other.numbers).forEach { (left, right) ->
            left.compareTo(right).takeIf { it != 0 }?.let { return it }
        }
        if (prerelease.isEmpty() || other.prerelease.isEmpty()) {
            return when { prerelease == other.prerelease -> 0; prerelease.isEmpty() -> 1; else -> -1 }
        }
        prerelease.zip(other.prerelease).forEach { (left, right) ->
            val leftNumber = left.toBigIntegerOrNull()
            val rightNumber = right.toBigIntegerOrNull()
            val comparison = when {
                leftNumber != null && rightNumber != null -> leftNumber.compareTo(rightNumber)
                leftNumber != null -> -1
                rightNumber != null -> 1
                else -> left.compareTo(right)
            }
            if (comparison != 0) return comparison
        }
        return prerelease.size.compareTo(other.prerelease.size)
    }

    companion object {
        private val pattern = Regex("^v?(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$")
        fun parse(value: String): ReleaseVersion {
            val match = requireNotNull(pattern.matchEntire(value)) { "Invalid release version" }
            val prerelease = match.groupValues[4].takeIf { it.isNotEmpty() }?.split('.') ?: emptyList()
            require(prerelease.none { it.all(Char::isDigit) && it.length > 1 && it.startsWith('0') }) { "Invalid prerelease version" }
            return ReleaseVersion((1..3).map { match.groupValues[it].toBigInteger() }, prerelease)
        }
    }
}

internal fun parseChecksums(text: String): Map<String, String> {
    val checksums = linkedMapOf<String, String>()
    val row = Regex("^([a-fA-F0-9]{64}) [ *]([^/\\\\]+)$")
    text.lineSequence().filter { it.isNotBlank() }.forEach { line ->
        val match = requireNotNull(row.matchEntire(line.trimEnd())) { "Invalid checksum row" }
        val name = match.groupValues[2]
        require(name != "." && name != ".." && !checksums.containsKey(name)) { "Duplicate or invalid checksum name" }
        checksums[name] = match.groupValues[1].lowercase()
    }
    require(checksums.isNotEmpty()) { "Empty checksums" }
    return checksums
}
