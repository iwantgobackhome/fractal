package app.fractal.reader

import androidx.test.platform.app.InstrumentationRegistry
import app.fractal.data.PdfCache
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class PdfCacheIntegrityTest {
    @Test fun sameSizeSameTimestampCorruptionIsRefusedAndBadPartialRetryStartsClean(): Unit = runBlocking {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val bytes = instrument.context.assets.open("text-layout.pdf").use { it.readBytes() } + "\nowned acquisition integrity fixture\n".toByteArray()
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val cache = PdfCache(instrument.targetContext)
        try {
            cache.partial(sha).writeBytes(bytes); cache.commit(sha)
            assertArrayEquals(bytes, cache.verified(sha)!!.readBytes())
            val stamp = cache.file(sha).lastModified()
            val changed = bytes.clone(); changed[changed.lastIndex] = (changed.last().toInt() xor 1).toByte()
            cache.file(sha).writeBytes(changed); cache.file(sha).setLastModified(stamp)
            assertTrue(cache.contains(sha)); assertNull(cache.verified(sha)); assertFalse(cache.contains(sha))
            cache.partial(sha).writeBytes(changed)
            assertTrue(runCatching { cache.commit(sha) }.isFailure); assertFalse(cache.partial(sha).exists())
            cache.partial(sha).writeBytes(bytes); cache.commit(sha)
            assertArrayEquals(bytes, cache.verified(sha)!!.readBytes())
        } finally { cache.file(sha).delete(); cache.partial(sha).delete() }
    }
}
