package app.fractal.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable
data class PairingPayload(
    val v: Int,
    val name: String,
    val hubId: String,
    val urls: List<String>,
    val code: String,
)

class NoPairingUrlsException : IllegalArgumentException("Enable LAN or Tailscale on your PC before pairing.")

object PairingPayloadParser {
    private val format = Json { ignoreUnknownKeys = true }
    fun parse(raw: String): PairingPayload {
        val value = format.decodeFromString<PairingPayload>(raw)
        require(value.v == 1)
        require(value.name.isNotBlank())
        UUID.fromString(value.hubId)
        require(value.code.isNotBlank())
        if (value.urls.isEmpty()) throw NoPairingUrlsException()
        require(value.urls.all { it.startsWith("http://") || it.startsWith("https://") })
        return value
    }
}

data class HubCredentials(
    val url: String,
    val name: String,
    val hubId: String,
    val deviceId: String,
    val token: String,
)

/** The bearer token is AES-GCM encrypted with a non-exportable Android Keystore key. */
class HubCredentialStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("paired_hub", Context.MODE_PRIVATE)
    private val alias = "fractal_hub_token_v1"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    fun save(credentials: HubCredentials) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(credentials.token.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString("url", credentials.url.trimEnd('/'))
            .putString("name", credentials.name)
            .putString("hubId", credentials.hubId)
            .putString("deviceId", credentials.deviceId)
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("token", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .apply()
    }

    fun load(): HubCredentials? {
        val url = prefs.getString("url", null) ?: return null
        val iv = prefs.getString("iv", null) ?: return null
        val encrypted = prefs.getString("token", null) ?: return null
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            val token = String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
            HubCredentials(
                url = url,
                name = prefs.getString("name", "") ?: "",
                hubId = prefs.getString("hubId", "") ?: "",
                deviceId = prefs.getString("deviceId", "") ?: "",
                token = token,
            )
        }.getOrNull()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
