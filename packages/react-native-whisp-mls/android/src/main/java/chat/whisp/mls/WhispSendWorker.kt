package chat.whisp.mls

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.*
import chat.whisp.mls.core.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

internal class WhispSendWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    try {
      val config = SendVault.get(applicationContext) ?: return@withContext Result.success()
      val id = inputData.getString("jobId") ?: return@withContext Result.failure()
      val job = sendJobStatuses(config).find { it.id == id } ?: return@withContext Result.success()
      if (job.status == SendStatus.SENT || job.status == SendStatus.FAILED) return@withContext Result.success()
      val settings = sendWorkerConfig(config)
      // Replaced WorkManager work can still be returning from a blocking native
      // call. Serialize only this job, including its compression and transfer.
      val lease = acquireDeviceLease("${settings.root}/sends/$id.worker")
      try {
        if (runAttemptCount == 0 && inputData.getBoolean("retryBlocked", false)) {
          retrySendJob(config, id)
          WhispSendEvents.changed()
        }
        setForeground(foreground())
        runJob(config, id, settings.uploadthingVersion)
      } finally { lease.release() }
    } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
    catch (_: Exception) { Result.retry() }
  }
  private suspend fun runJob(config: String, id: String, version: String): Result {
    try {
      while (true) {
        if (isStopped || SendVault.get(applicationContext) != config) return Result.retry()
        when (val step = advanceSendJob(config, id)) {
          is SendStep.Compress -> {
            try { SendCompression.compress(applicationContext, step.kind, step.source, step.output) }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) {
              pauseSendJob(config, id, SendInterruption.COMPRESSION)
              return Result.success() // Wait for explicit resume or expiry.
            }
          }
          is SendStep.Upload -> {
            val successful = try { upload(step.transfer, version) }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: java.io.IOException) { false }
            completeSendUpload(config, id, successful)
            if (!successful) {
              pauseSendJob(config, id, SendInterruption.TRANSFER)
              return Result.retry()
            }
          }
          SendStep.Confirm -> return Result.retry()
          SendStep.Sent, is SendStep.Failed -> return Result.success()
          is SendStep.Paused -> return if (step.failure.disposition == SendDisposition.RETRY) Result.retry() else Result.success()
          SendStep.Continue -> Unit
        }
      }
    } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
    catch (_: Exception) {
      pauseSendJob(config, id, SendInterruption.STORAGE)
      return Result.success()
    } finally { WhispSendEvents.changed() }
  }
  private fun foreground(): ForegroundInfo {
    val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("whisp-send", "Sending whisps", NotificationManager.IMPORTANCE_LOW))
    val notification = NotificationCompat.Builder(applicationContext, "whisp-send")
      .setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("Sending encrypted whisps").setOngoing(true).build()
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(9420, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(9420, notification)
  }
  private fun upload(step: SendUpload, version: String): Boolean {
    val file = File(step.file)
    val boundary = "whisp-${step.id}"
    val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"${step.id}.age\"\r\nContent-Type: application/octet-stream\r\n\r\n".toByteArray()
    val tail = "\r\n--$boundary--\r\n".toByteArray()
    val connection = URL(step.url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "PUT"
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 30_000
      connection.readTimeout = 60_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      connection.setRequestProperty("x-uploadthing-version", version)
      connection.setFixedLengthStreamingMode(head.size + file.length() + tail.size)
      connection.outputStream.use { output ->
        output.write(head)
        file.inputStream().use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            if (isStopped) throw java.io.InterruptedIOException("Send worker stopped")
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
          }
        }
        output.write(tail)
      }
      return connection.responseCode in 200..299
    } finally { connection.disconnect() }
  }
  companion object {
    fun schedule(context: Context, id: String, restart: Boolean = false) {
      val request = OneTimeWorkRequestBuilder<WhispSendWorker>()
        .setInputData(workDataOf("jobId" to id, "retryBlocked" to restart))
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build()
      WorkManager.getInstance(context).enqueueUniqueWork("whisp-send-$id",
        if (restart) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, request)
    }
    fun resume(context: Context, restart: Boolean = false) {
      val config = SendVault.get(context) ?: return
      for (job in sendJobStatuses(config)) {
        if (job.status == SendStatus.UPLOADING || job.status == SendStatus.BLOCKED) schedule(context, job.id, restart)
      }
    }
  }
}
