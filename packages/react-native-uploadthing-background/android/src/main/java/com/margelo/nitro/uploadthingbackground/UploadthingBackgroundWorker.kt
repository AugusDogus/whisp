package com.margelo.nitro.uploadthingbackground

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.BufferedInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class UploadthingBackgroundWorker(
  context: Context,
  params: WorkerParameters,
) : CoroutineWorker(context, params) {
  private class StaleUploadAttemptException : Exception()

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val taskId = inputData.getString(KEY_TASK_ID)
      ?: return@withContext Result.failure()
    val initialRecord = BackgroundUploadStore.getRecord(applicationContext, taskId)
      ?: return@withContext Result.failure()
    val attemptId = id.toString()

    try {
      val sourceFile = resolveLocalFile(initialRecord.fileUri)
      val isPutUpload = initialRecord.method.uppercase() == "PUT"
      val sanitizedFileName = initialRecord.fileName
        .replace("\r", "_")
        .replace("\n", "_")
        .replace("\"", "_")
      val boundary = "UploadthingBackground-${initialRecord.taskId}"
      val headerBytes = if (isPutUpload) {
        ByteArray(0)
      } else {
        buildString {
          append("--")
          append(boundary)
          append("\r\n")
          append("Content-Disposition: form-data; name=\"file\"; filename=\"")
          append(sanitizedFileName)
          append("\"\r\n")
          append("Content-Type: ")
          append(initialRecord.mimeType)
          append("\r\n\r\n")
        }.toByteArray(Charsets.UTF_8)
      }
      val footerBytes = if (isPutUpload) {
        ByteArray(0)
      } else {
        "\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)
      }
      val totalBytes = headerBytes.size.toLong() + sourceFile.length() + footerBytes.size.toLong()

      val record = BackgroundUploadStore.claimForAttempt(
        applicationContext,
        taskId,
        attemptId,
        totalBytes.toDouble(),
      ) ?: return@withContext Result.success()

      setForeground(
        UploadthingBackgroundNotificationHelper.createForegroundInfo(
          applicationContext,
          record,
          0,
        ),
      )

      val connection = (URL(record.url).openConnection() as HttpURLConnection).apply {
        requestMethod = record.method
        doOutput = true
        useCaches = false
        connectTimeout = 30_000
        readTimeout = 120_000
        record.headers.forEach { header ->
          setRequestProperty(header.key, header.value)
        }
        if (getRequestProperty("Content-Type") == null) {
          setRequestProperty(
            "Content-Type",
            if (isPutUpload) {
              initialRecord.mimeType
            } else {
              "multipart/form-data; boundary=$boundary"
            },
          )
        }
        setFixedLengthStreamingMode(totalBytes)
      }

      val uploadResult = try {
        DataOutputStream(connection.outputStream).use { output ->
          output.write(headerBytes)
          output.flush()
          writeFileBytes(record, sourceFile, output, headerBytes.size.toLong(), totalBytes)
          output.write(footerBytes)
          output.flush()
        }

        val responseCode = connection.responseCode
        val responseBody = readResponseBody(connection)
        UploadRunResult(
          responseCode = responseCode,
          responseBody = responseBody,
          isSuccessful = responseCode in 200..299,
        )
      } finally {
        connection.disconnect()
      }

      val finalUpdate = BackgroundUploadStore.updateForAttempt(
        applicationContext,
        taskId,
        attemptId,
      ) { existing ->
        existing.copy(
          status = if (uploadResult.isSuccessful) {
            BackgroundUploadTaskStatus.COMPLETED
          } else {
            BackgroundUploadTaskStatus.FAILED
          },
          bytesSent = totalBytes.toDouble(),
          totalBytes = totalBytes.toDouble(),
          responseCode = uploadResult.responseCode.toDouble(),
          responseBody = uploadResult.responseBody,
          errorMessage = if (uploadResult.isSuccessful) null else {
            uploadResult.responseBody.ifBlank {
              "Upload failed with HTTP ${uploadResult.responseCode}"
            }
          },
        )
      }

      if (finalUpdate == null) {
        return@withContext Result.success()
      }

      if (uploadResult.isSuccessful) {
        Result.success()
      } else {
        Result.failure()
      }
    } catch (_: StaleUploadAttemptException) {
      Result.success()
    } catch (cancelled: CancellationException) {
      BackgroundUploadStore.updateForAttempt(
        applicationContext,
        taskId,
        attemptId,
      ) { existing ->
        existing.copy(
          status = BackgroundUploadTaskStatus.CANCELLED,
          errorMessage = "The upload was cancelled.",
        )
      }
      Result.failure()
    } catch (ioError: IOException) {
      val shouldRetry = runAttemptCount < 2
      BackgroundUploadStore.updateForAttempt(
        applicationContext,
        taskId,
        attemptId,
      ) { existing ->
        existing.copy(
          status = if (shouldRetry) {
            BackgroundUploadTaskStatus.QUEUED
          } else {
            BackgroundUploadTaskStatus.FAILED
          },
          errorMessage = ioError.localizedMessage ?: "The upload failed.",
        )
      }
      if (shouldRetry) Result.retry() else Result.failure()
    } catch (error: Throwable) {
      BackgroundUploadStore.updateForAttempt(
        applicationContext,
        taskId,
        attemptId,
      ) { existing ->
        existing.copy(
          status = BackgroundUploadTaskStatus.FAILED,
          errorMessage = error.localizedMessage ?: "The upload failed.",
        )
      }
      Result.failure()
    }
  }

  private suspend fun writeFileBytes(
    record: StoredBackgroundUploadTaskRecord,
    sourceFile: File,
    output: DataOutputStream,
    initialBytesSent: Long,
    totalBytes: Long,
  ) {
    var bytesSent = initialBytesSent
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var lastPersistedBytesSent = initialBytesSent
    var lastPersistTimeMs = System.currentTimeMillis()

    BufferedInputStream(sourceFile.inputStream()).use { input ->
      while (true) {
        if (isStopped) {
          throw CancellationException("Upload stopped")
        }

        val bytesRead = input.read(buffer)
        if (bytesRead == -1) {
          break
        }

        output.write(buffer, 0, bytesRead)
        bytesSent += bytesRead

        val now = System.currentTimeMillis()
        if (
          bytesSent - lastPersistedBytesSent >= PROGRESS_PERSIST_CHUNK_BYTES ||
          now - lastPersistTimeMs >= PROGRESS_PERSIST_INTERVAL_MS
        ) {
          updateProgress(record, bytesSent, totalBytes)
          lastPersistedBytesSent = bytesSent
          lastPersistTimeMs = now
        }
      }
    }

    updateProgress(record, totalBytes, totalBytes)
  }

  private suspend fun updateProgress(
    record: StoredBackgroundUploadTaskRecord,
    bytesSent: Long,
    totalBytes: Long,
  ) {
    val progressPercent =
      if (totalBytes <= 0L) 0 else ((bytesSent * 100) / totalBytes).toInt()
    val attemptId = record.attemptId ?: throw StaleUploadAttemptException()

    val updatedRecord = BackgroundUploadStore.updateForAttempt(
      applicationContext,
      record.taskId,
      attemptId,
    ) { existing ->
      existing.copy(
        status = BackgroundUploadTaskStatus.UPLOADING,
        bytesSent = bytesSent.toDouble(),
        totalBytes = totalBytes.toDouble(),
      )
    }
    if (updatedRecord == null) {
      throw StaleUploadAttemptException()
    }

    setForeground(
      UploadthingBackgroundNotificationHelper.createForegroundInfo(
        applicationContext,
        updatedRecord,
        progressPercent,
      ),
    )
    setProgress(
      androidx.work.Data.Builder()
        .putLong(KEY_BYTES_SENT, bytesSent)
        .putLong(KEY_TOTAL_BYTES, totalBytes)
        .build(),
    )
  }

  private fun resolveLocalFile(fileUri: String): File {
    val uri = Uri.parse(fileUri)
    if (!uri.scheme.isNullOrEmpty() && uri.scheme != "file") {
      throw IOException("Only file:// URIs are supported for background uploads.")
    }

    val path = if (uri.scheme == "file") uri.path else fileUri
    val file = File(path ?: throw IOException("Invalid local file path."))
    if (!file.exists()) {
      throw IOException("The upload file could not be found.")
    }
    return file
  }

  private fun readResponseBody(connection: HttpURLConnection): String {
    val stream = try {
      connection.inputStream
    } catch (_: IOException) {
      connection.errorStream
    } ?: return ""

    return stream.bufferedReader().use { it.readText() }
  }

  private data class UploadRunResult(
    val responseCode: Int,
    val responseBody: String,
    val isSuccessful: Boolean,
  )

  companion object {
    const val KEY_TASK_ID = "taskId"
    private const val KEY_BYTES_SENT = "bytesSent"
    private const val KEY_TOTAL_BYTES = "totalBytes"
    private const val PROGRESS_PERSIST_CHUNK_BYTES = 1L * 1024L * 1024L
    private const val PROGRESS_PERSIST_INTERVAL_MS = 2_000L
  }
}
