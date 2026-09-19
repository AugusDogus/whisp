package chat.whisp.mls

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** Repairs the crash window between a durable journal write and WorkManager enqueue. */
internal class WhispSendRecoveryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    try {
      WhispSendWorker.resume(applicationContext)
      Result.success()
    } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
    catch (_: Exception) { Result.retry() }
  }
  companion object {
    fun install(context: Context) {
      val request = PeriodicWorkRequestBuilder<WhispSendRecoveryWorker>(15, TimeUnit.MINUTES).build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork("whisp-send-recovery", ExistingPeriodicWorkPolicy.KEEP, request)
    }
  }
}
