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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

internal class WhispSendWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    // Also serializes compressor's process-wide MediaCodec state.
    owner.withLock {
      try {
        val config = SendVault.get(applicationContext) ?: return@withLock Result.success()
        setForeground(foreground())
        val jobs = JSONArray(listSendJobs(config))
        var retry = false
        for (index in 0 until jobs.length()) {
          val job = jobs.getJSONObject(index)
          if (job.getString("id") != inputData.getString("jobId")) continue
          if (job.getString("status") != "uploading") continue
          try {
            var done = false
            while (!done) {
              if (isStopped || SendVault.get(applicationContext) != config) return@withLock Result.retry()
              val step = JSONObject(advanceSendJob(config, job.getString("id")))
              when (step.getString("stage")) {
                "compress" -> SendCompression.compress(applicationContext, step.getString("kind"), step.getString("source"), step.getString("output"))
                "upload" -> {
                  val successful = upload(step, JSONObject(config).getString("uploadthingVersion"))
                  completeSendUpload(config, job.getString("id"), successful)
                  if (!successful) { retry = true; done = true }
                }
                "confirm" -> { retry = true; done = true }
                "sent", "failed" -> done = true
                "continue" -> Unit
                else -> error("Unknown native send checkpoint")
              }
            }
          } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
          catch (_: Exception) {
            runCatching { pauseSendJob(config, job.getString("id")) }
            retry = true
          }
        }
        if (retry) Result.retry() else Result.success()
      } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
      catch (_: Exception) { Result.retry() }
    }
  }
  private fun foreground(): ForegroundInfo {
    val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("whisp-send", "Sending whisps", NotificationManager.IMPORTANCE_LOW))
    val notification = NotificationCompat.Builder(applicationContext, "whisp-send")
      .setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("Sending encrypted whisps").setOngoing(true).build()
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(9420, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(9420, notification)
  }
  private fun upload(step: JSONObject, version: String): Boolean {
    val file = File(step.getString("file"))
    val boundary = "whisp-${step.getString("id")}"
    val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"${step.getString("id")}.age\"\r\nContent-Type: application/octet-stream\r\n\r\n".toByteArray()
    val tail = "\r\n--$boundary--\r\n".toByteArray()
    val connection = URL(step.getString("url")).openConnection() as HttpURLConnection
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
    private val owner = Mutex()
    fun schedule(context: Context, id: String, restart: Boolean = false) {
      val request = OneTimeWorkRequestBuilder<WhispSendWorker>()
        .setInputData(workDataOf("jobId" to id))
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build()
      WorkManager.getInstance(context).enqueueUniqueWork("whisp-send-$id",
        if (restart) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, request)
    }
    fun resume(context: Context, restart: Boolean = false) {
      val config = SendVault.get(context) ?: return
      val jobs = JSONArray(listSendJobs(config))
      for (index in 0 until jobs.length()) {
        val job = jobs.getJSONObject(index)
        if (job.getString("status") == "uploading") schedule(context, job.getString("id"), restart)
      }
    }
  }
}
