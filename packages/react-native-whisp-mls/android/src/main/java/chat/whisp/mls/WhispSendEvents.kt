package chat.whisp.mls

import java.util.concurrent.CopyOnWriteArraySet

// Process-local wakeups only. Persisted jobs remain authoritative after process
// death, background suspension, or an account change. Never broadcast job data.
internal object WhispSendEvents {
  private val listeners = CopyOnWriteArraySet<() -> Unit>()
  fun add(listener: () -> Unit) { listeners.add(listener) }
  fun remove(listener: () -> Unit) { listeners.remove(listener) }
  fun changed() { listeners.forEach { it() } }
}
