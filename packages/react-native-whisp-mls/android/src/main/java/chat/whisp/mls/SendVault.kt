package chat.whisp.mls

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Credentials are encrypted with a non-exportable, app-only Android Keystore key. */
internal object SendVault {
  private const val alias = "whisp.native.send.v1"
  @Synchronized private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(alias, null)
    if (existing is SecretKey) return existing
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @Synchronized fun set(context: Context, config: String?) {
    val prefs = context.getSharedPreferences(alias, Context.MODE_PRIVATE)
    if (config == null) { check(prefs.edit().clear().commit()); return }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val encrypted = cipher.doFinal(config.toByteArray(Charsets.UTF_8))
    check(prefs.edit().putString("config", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit())
  }
  @Synchronized fun get(context: Context): String? {
    val encoded = context.getSharedPreferences(alias, Context.MODE_PRIVATE).getString("config", null) ?: return null
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    require(bytes.size > 12)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
      init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    }
    return cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
  }
}
