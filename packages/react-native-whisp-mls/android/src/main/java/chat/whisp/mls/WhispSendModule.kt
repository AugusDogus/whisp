package chat.whisp.mls

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import chat.whisp.mls.core.enqueueSendJob
import chat.whisp.mls.core.listSendJobs
import chat.whisp.mls.core.acknowledgeSendJob

class WhispSendModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WhispSend")
    AsyncFunction("configure") { config: String? ->
      val context = requireNotNull(appContext.reactContext)
      val previous = SendVault.get(context)
      SendVault.set(context, config)
      if (config != null) {
        WhispSendRecoveryWorker.install(context)
        WhispSendWorker.resume(context, previous != config)
      }
    }
    AsyncFunction("enqueue") { input: String ->
      val context = requireNotNull(appContext.reactContext)
      val config = checkNotNull(SendVault.get(context)) { "Sign in before sending a whisp." }
      val id = enqueueSendJob(config, input)
      WhispSendWorker.schedule(context, id)
      id
    }
    AsyncFunction("list") {
      val context = requireNotNull(appContext.reactContext)
      SendVault.get(context)?.let { listSendJobs(it) } ?: "[]"
    }
    AsyncFunction("acknowledge") { id: String ->
      val context = requireNotNull(appContext.reactContext)
      SendVault.get(context)?.let { acknowledgeSendJob(it, id) }
    }
    AsyncFunction("resume") {
      WhispSendWorker.resume(requireNotNull(appContext.reactContext), restart = true)
    }
  }
}
