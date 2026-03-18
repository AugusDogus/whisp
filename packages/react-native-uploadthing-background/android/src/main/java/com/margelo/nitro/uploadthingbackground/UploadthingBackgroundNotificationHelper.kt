package com.margelo.nitro.uploadthingbackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

internal object UploadthingBackgroundNotificationHelper {
  private const val CHANNEL_ID = "uploadthing-background"
  private const val CHANNEL_NAME = "Background uploads"

  fun createForegroundInfo(
    context: Context,
    record: StoredBackgroundUploadTaskRecord,
    progressPercent: Int,
  ): ForegroundInfo {
    ensureChannel(context)

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(record.notificationTitle ?: "Sending media")
      .setContentText(
        record.notificationBody ?: "Background upload in progress",
      )
      .setSmallIcon(resolveSmallIcon(context))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setProgress(100, progressPercent.coerceIn(0, 100), false)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .build()

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(
        record.taskId.hashCode(),
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      ForegroundInfo(record.taskId.hashCode(), notification)
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val notificationManager =
      context.getSystemService(Service.NOTIFICATION_SERVICE) as NotificationManager
    if (notificationManager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }

    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows the progress of background UploadThing uploads."
    }
    notificationManager.createNotificationChannel(channel)
  }

  private fun resolveSmallIcon(context: Context): Int {
    val appIcon = context.applicationInfo.icon
    return if (appIcon != 0) appIcon else android.R.drawable.stat_sys_upload
  }
}
