package chat.whisp.mls

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import expo.modules.kotlin.modules.ModuleDefinition
import chat.whisp.mls.core.enqueueSendJob
import chat.whisp.mls.core.listSendJobs
import chat.whisp.mls.core.acknowledgeSendJob

class WhispSendModule : Module() {
  private val configurations = Mutex()
  override fun definition() = ModuleDefinition {
    Name("WhispSend")
    AsyncFunction("configure") Coroutine { config: String? ->
      // Acquire in Expo invocation order before switching dispatchers. Enqueue
      // uses a separate executor and can never block account changes.
      configurations.withLock { withContext(Dispatchers.IO) {
      val context = requireNotNull(appContext.reactContext)
      val previous = SendVault.get(context)
      SendVault.set(context, config)
      if (config != null) {
        WhispSendRecoveryWorker.install(context)
        WhispSendWorker.resume(context, previous != config)
      }
      } }
    }
    AsyncFunction("enqueue") Coroutine { input: String -> withContext(Dispatchers.IO) {
      val context = requireNotNull(appContext.reactContext)
      val config = checkNotNull(SendVault.get(context)) { "Sign in before sending a whisp." }
      val id = enqueueSendJob(config, input)
      WhispSendWorker.schedule(context, id)
      id
    } }
    AsyncFunction("list") Coroutine { -> withContext(Dispatchers.IO) {
      val context = requireNotNull(appContext.reactContext)
      SendVault.get(context)?.let { listSendJobs(it) } ?: "[]"
    } }
    AsyncFunction("acknowledge") Coroutine { id: String -> withContext(Dispatchers.IO) {
      val context = requireNotNull(appContext.reactContext)
      SendVault.get(context)?.let { acknowledgeSendJob(it, id) }
    } }
    AsyncFunction("resume") Coroutine { -> withContext(Dispatchers.IO) {
      WhispSendWorker.resume(requireNotNull(appContext.reactContext), restart = true)
    } }
  }
}
