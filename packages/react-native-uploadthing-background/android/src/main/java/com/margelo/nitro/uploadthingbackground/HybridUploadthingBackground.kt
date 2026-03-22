package com.margelo.nitro.uploadthingbackground

import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.NullType
import com.margelo.nitro.core.Promise

class HybridUploadthingBackground : HybridUploadthingBackgroundSpec() {
  override val activeTaskCount: Double
    get() = BackgroundUploadStore.activeTaskCount(requireContext()).toDouble()

  override fun enqueueUpload(
    request: BackgroundUploadRequest,
  ): Promise<BackgroundUploadTask> = Promise.parallel {
    val context = requireContext()
    val record = StoredBackgroundUploadTaskRecord.fromRequest(request)
    BackgroundUploadStore.upsert(context, record)

    val workRequest = OneTimeWorkRequestBuilder<UploadthingBackgroundWorker>()
      .setInputData(
        androidx.work.Data.Builder()
          .putString(UploadthingBackgroundWorker.KEY_TASK_ID, request.taskId)
          .build(),
      )
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .build()

    WorkManager.getInstance(context).enqueueUniqueWork(
      uniqueWorkName(request.taskId),
      ExistingWorkPolicy.REPLACE,
      workRequest,
    )

    record.toPublicTask()
  }

  override fun getTask(taskId: String): Promise<Variant_NullType_BackgroundUploadTask> =
    Promise.parallel {
      val task = BackgroundUploadStore.getTask(requireContext(), taskId)
      if (task != null) {
        Variant_NullType_BackgroundUploadTask.create(task)
      } else {
        Variant_NullType_BackgroundUploadTask.create(NullType.NULL)
      }
    }

  override fun listTasks(): Promise<Array<BackgroundUploadTask>> = Promise.parallel {
    BackgroundUploadStore.listTasks(requireContext())
  }

  override fun markTaskObserved(
    taskId: String,
  ): Promise<Variant_NullType_BackgroundUploadTask> = Promise.parallel {
    val task = BackgroundUploadStore.markObserved(requireContext(), taskId)
    if (task != null) {
      Variant_NullType_BackgroundUploadTask.create(task)
    } else {
      Variant_NullType_BackgroundUploadTask.create(NullType.NULL)
    }
  }

  override fun cancelUpload(taskId: String): Promise<Unit> = Promise.parallel {
    val context = requireContext()
    WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(taskId))
    BackgroundUploadStore.update(context, taskId) { existing ->
      if (
        existing.status == BackgroundUploadTaskStatus.COMPLETED ||
        existing.status == BackgroundUploadTaskStatus.FAILED ||
        existing.status == BackgroundUploadTaskStatus.CANCELLED
      ) {
        existing
      } else {
        existing.copy(
          status = BackgroundUploadTaskStatus.CANCELLED,
          errorMessage = "The upload was cancelled.",
        )
      }
    }
    Unit
  }

  override fun removeTask(taskId: String): Promise<Unit> = Promise.parallel {
    val context = requireContext()
    val record = BackgroundUploadStore.getRecord(context, taskId)
    if (record == null) return@Promise.parallel Unit

    if (
      record.status == BackgroundUploadTaskStatus.COMPLETED ||
      record.status == BackgroundUploadTaskStatus.FAILED ||
      record.status == BackgroundUploadTaskStatus.CANCELLED
    ) {
      BackgroundUploadStore.remove(context, taskId)
    } else {
      BackgroundUploadStore.markPendingRemoval(context, taskId)
      WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(taskId))
    }
    Unit
  }

  private fun requireContext() =
    NitroModules.applicationContext
      ?: throw Error("ReactApplicationContext is unavailable.")

  private fun uniqueWorkName(taskId: String): String =
    "uploadthing-background-$taskId"
}
