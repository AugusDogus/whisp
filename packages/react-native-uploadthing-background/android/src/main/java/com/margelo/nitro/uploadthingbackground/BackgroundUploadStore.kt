package com.margelo.nitro.uploadthingbackground

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal object BackgroundUploadStore {
  private const val PREFS_NAME = "uploadthing_background_uploads"
  private const val TASKS_KEY = "tasks"
  private val lock = Any()

  fun activeTaskCount(context: Context): Int = synchronized(lock) {
    readAll(context).values.count {
      it.status == BackgroundUploadTaskStatus.QUEUED ||
        it.status == BackgroundUploadTaskStatus.UPLOADING
    }
  }

  fun listTasks(context: Context): Array<BackgroundUploadTask> = synchronized(lock) {
    readAll(context)
      .values
      .sortedBy { it.createdAt }
      .map { it.toPublicTask() }
      .toTypedArray()
  }

  fun getTask(context: Context, taskId: String): BackgroundUploadTask? = synchronized(lock) {
    readAll(context)[taskId]?.toPublicTask()
  }

  fun getRecord(context: Context, taskId: String): StoredBackgroundUploadTaskRecord? =
    synchronized(lock) {
      readAll(context)[taskId]
    }

  fun upsert(context: Context, record: StoredBackgroundUploadTaskRecord) = synchronized(lock) {
    val records = readAll(context).toMutableMap()
    records[record.taskId] = record
    persist(context, records)
  }

  fun update(
    context: Context,
    taskId: String,
    mutate: (StoredBackgroundUploadTaskRecord) -> StoredBackgroundUploadTaskRecord,
  ): StoredBackgroundUploadTaskRecord? = synchronized(lock) {
    val records = readAll(context).toMutableMap()
    val existing = records[taskId] ?: return null
    val updated = mutate(existing).copy(updatedAt = nowMs())
    records[taskId] = updated
    persist(context, records)
    updated
  }

  fun claimForAttempt(
    context: Context,
    taskId: String,
    attemptId: String,
    totalBytes: Double,
  ): StoredBackgroundUploadTaskRecord? = synchronized(lock) {
    val records = readAll(context).toMutableMap()
    val existing = records[taskId] ?: return null
    if (
      existing.status == BackgroundUploadTaskStatus.COMPLETED ||
      existing.status == BackgroundUploadTaskStatus.FAILED ||
      existing.status == BackgroundUploadTaskStatus.CANCELLED
    ) {
      return null
    }

    val updated = existing.copy(
      status = BackgroundUploadTaskStatus.UPLOADING,
      totalBytes = totalBytes,
      bytesSent = 0.0,
      errorMessage = null,
      attemptId = attemptId,
      updatedAt = nowMs(),
    )
    records[taskId] = updated
    persist(context, records)
    updated
  }

  fun updateForAttempt(
    context: Context,
    taskId: String,
    attemptId: String,
    mutate: (StoredBackgroundUploadTaskRecord) -> StoredBackgroundUploadTaskRecord,
  ): StoredBackgroundUploadTaskRecord? = synchronized(lock) {
    val records = readAll(context).toMutableMap()
    val existing = records[taskId] ?: return null
    if (existing.attemptId != attemptId) {
      return null
    }

    val updated = mutate(existing).copy(updatedAt = nowMs())
    records[taskId] = updated
    persist(context, records)
    updated
  }

  fun remove(context: Context, taskId: String): StoredBackgroundUploadTaskRecord? =
    synchronized(lock) {
      val records = readAll(context).toMutableMap()
      val removed = records.remove(taskId)
      persist(context, records)
      removed
    }

  private fun readAll(context: Context): Map<String, StoredBackgroundUploadTaskRecord> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(TASKS_KEY, null) ?: return emptyMap()
    val json = JSONObject(raw)
    val records = mutableMapOf<String, StoredBackgroundUploadTaskRecord>()

    json.keys().forEach { key ->
      records[key] = StoredBackgroundUploadTaskRecord.fromJson(json.getJSONObject(key))
    }
    return records
  }

  private fun persist(
    context: Context,
    records: Map<String, StoredBackgroundUploadTaskRecord>,
  ) {
    val json = JSONObject()
    for ((taskId, record) in records) {
      json.put(taskId, record.toJson())
    }

    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(TASKS_KEY, json.toString())
      .apply()
  }

  private fun nowMs(): Double = System.currentTimeMillis().toDouble()
}

internal data class StoredBackgroundUploadTaskRecord(
  val taskId: String,
  val status: BackgroundUploadTaskStatus,
  val url: String,
  val fileUri: String,
  val fileName: String,
  val mimeType: String,
  val bytesSent: Double,
  val totalBytes: Double,
  val responseCode: Double?,
  val responseBody: String?,
  val errorMessage: String?,
  val createdAt: Double,
  val updatedAt: Double,
  val attemptId: String?,
  val method: String,
  val headers: List<BackgroundUploadHeader>,
  val notificationTitle: String?,
  val notificationBody: String?,
) {
  fun toPublicTask(): BackgroundUploadTask =
    BackgroundUploadTask(
      taskId = taskId,
      status = status,
      url = url,
      fileUri = fileUri,
      fileName = fileName,
      mimeType = mimeType,
      bytesSent = bytesSent,
      totalBytes = totalBytes,
      responseCode = responseCode,
      responseBody = responseBody,
      errorMessage = errorMessage,
      createdAt = createdAt,
      updatedAt = updatedAt,
    )

  fun toJson(): JSONObject {
    val json = JSONObject()
    json.put("taskId", taskId)
    json.put("status", status.name)
    json.put("url", url)
    json.put("fileUri", fileUri)
    json.put("fileName", fileName)
    json.put("mimeType", mimeType)
    json.put("bytesSent", bytesSent)
    json.put("totalBytes", totalBytes)
    json.put("responseCode", responseCode)
    json.put("responseBody", responseBody)
    json.put("errorMessage", errorMessage)
    json.put("createdAt", createdAt)
    json.put("updatedAt", updatedAt)
    json.put("attemptId", attemptId)
    json.put("method", method)
    json.put(
      "headers",
      JSONArray().apply {
        headers.forEach { header ->
          put(
            JSONObject()
              .put("key", header.key)
              .put("value", header.value),
          )
        }
      },
    )
    json.put("notificationTitle", notificationTitle)
    json.put("notificationBody", notificationBody)
    return json
  }

  companion object {
    fun fromRequest(request: BackgroundUploadRequest): StoredBackgroundUploadTaskRecord {
      val now = System.currentTimeMillis().toDouble()

      return StoredBackgroundUploadTaskRecord(
        taskId = request.taskId,
        status = BackgroundUploadTaskStatus.QUEUED,
        url = request.url,
        fileUri = request.fileUri,
        fileName = request.fileName,
        mimeType = request.mimeType,
        bytesSent = 0.0,
        totalBytes = 0.0,
        responseCode = null,
        responseBody = null,
        errorMessage = null,
        createdAt = now,
        updatedAt = now,
        attemptId = null,
        method = request.method ?: "PUT",
        headers = request.headers?.toList() ?: emptyList(),
        notificationTitle = request.notificationTitle,
        notificationBody = request.notificationBody,
      )
    }

    fun fromJson(json: JSONObject): StoredBackgroundUploadTaskRecord {
      val now = System.currentTimeMillis().toDouble()
      val headersJson = json.optJSONArray("headers") ?: JSONArray()
      val headers = buildList {
        for (index in 0 until headersJson.length()) {
          val item = headersJson.getJSONObject(index)
          add(
            BackgroundUploadHeader(
              key = item.getString("key"),
              value = item.getString("value"),
            ),
          )
        }
      }

      return StoredBackgroundUploadTaskRecord(
        taskId = json.getString("taskId"),
        status = BackgroundUploadTaskStatus.valueOf(json.getString("status")),
        url = json.getString("url"),
        fileUri = json.getString("fileUri"),
        fileName = json.getString("fileName"),
        mimeType = json.getString("mimeType"),
        bytesSent = json.optDouble("bytesSent", 0.0),
        totalBytes = json.optDouble("totalBytes", 0.0),
        responseCode = json.optDouble("responseCode").takeUnless { json.isNull("responseCode") },
        responseBody = json.optString("responseBody").takeUnless { json.isNull("responseBody") },
        errorMessage = json.optString("errorMessage").takeUnless { json.isNull("errorMessage") },
        createdAt = json.optDouble("createdAt", now),
        updatedAt = json.optDouble("updatedAt", now),
        attemptId = json.optString("attemptId").takeUnless { json.isNull("attemptId") },
        method = json.optString("method", "PUT"),
        headers = headers,
        notificationTitle = json.optString("notificationTitle")
          .takeUnless { json.isNull("notificationTitle") },
        notificationBody = json.optString("notificationBody")
          .takeUnless { json.isNull("notificationBody") },
      )
    }
  }
}
