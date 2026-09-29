package app.fractal.data

/** Hub LWW order: timestamp, then device id. Tombstones use the same order. */
object MergeRules {
    fun remoteWins(local: AnnotationEntity?, remote: AnnotationEntity): Boolean {
        if (local == null) return true
        val time = remote.updatedAt.compareTo(local.updatedAt)
        if (time != 0) return time > 0
        return remote.deviceId > local.deviceId
    }

    fun newerCursor(current: String, candidate: String): String {
        require(current.isNotEmpty() && current.all(Char::isDigit))
        require(candidate.isNotEmpty() && candidate.all(Char::isDigit))
        val a = current.trimStart('0').ifEmpty { "0" }
        val b = candidate.trimStart('0').ifEmpty { "0" }
        return if (b.length > a.length || (b.length == a.length && b > a)) candidate else current
    }
}
