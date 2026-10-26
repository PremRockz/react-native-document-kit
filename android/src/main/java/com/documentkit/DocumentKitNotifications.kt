package com.documentkit

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReadableMap
import java.io.File

/**
 * Download notifications: one "Downloads" channel, a silent progress
 * notification while downloading, then "Downloaded" that opens the saved file.
 * Everything is skipped quietly when notifications are not allowed.
 */
internal object DocumentKitNotifications {
  private const val CHANNEL_ID = "documentkit_downloads"
  private const val NOTIFICATION_ID = 7400
  private const val PDF_MIME_TYPE = "application/pdf"
  // Large enough for the expanded picture, small enough to stay cheap.
  private const val PREVIEW_MAX_SIDE_PX = 512

  /** Labels and tag from JS, or null when notifications were not requested. */
  class Content(
    val tag: String,
    val title: String,
    val channelName: String,
    val downloadingText: String,
    val completedText: String,
    val closeLabel: String,
  ) {
    fun toBundle(): Bundle = Bundle().apply {
      putString("tag", tag)
      putString("title", title)
      putString("channelName", channelName)
      putString("downloadingText", downloadingText)
      putString("completedText", completedText)
      putString("closeLabel", closeLabel)
    }

    companion object {
      /** For screens started by an Intent, where JS objects arrive as a Bundle. */
      fun from(bundle: Bundle?): Content? = bundle?.let {
        Content(
          tag = it.getString("tag").orEmpty(),
          title = it.getString("title").orEmpty(),
          channelName = it.getString("channelName").orEmpty(),
          downloadingText = it.getString("downloadingText").orEmpty(),
          completedText = it.getString("completedText").orEmpty(),
          closeLabel = it.getString("closeLabel").orEmpty(),
        )
      }

      fun from(map: ReadableMap?): Content? = map?.let {
        Content(
          tag = it.getString("tag").orEmpty(),
          title = it.getString("title").orEmpty(),
          channelName = it.getString("channelName").orEmpty(),
          downloadingText = it.getString("downloadingText").orEmpty(),
          completedText = it.getString("completedText").orEmpty(),
          closeLabel = it.getString("closeLabel").orEmpty(),
        )
      }
    }
  }

  fun showProgress(context: Context, content: Content, bytesWritten: Long, totalBytes: Long) {
    val builder = baseBuilder(context, content)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentText(content.downloadingText)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
    if (totalBytes > 0) {
      builder.setProgress(100, ((bytesWritten * 100) / totalBytes).toInt(), false)
    } else {
      builder.setProgress(0, 0, true)
    }
    post(context, content, builder)
  }

  /**
   * [savedUri] is the file in Downloads; [cachedFile] (when known) gives a picture preview.
   * Tapping opens PDFs in DocumentKit's viewer, anything else through "Open with".
   */
  fun showCompleted(context: Context, content: Content, savedUri: Uri, mimeType: String, cachedFile: File?) {
    val builder = baseBuilder(context, content)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentText(content.completedText)
      .setAutoCancel(true)
      .setContentIntent(openIntent(context, content, savedUri, mimeType))
    imagePreview(cachedFile, mimeType)?.let { picture ->
      builder.setLargeIcon(picture)
      builder.setStyle(NotificationCompat.BigPictureStyle().bigPicture(picture).bigLargeIcon(null as Bitmap?))
    }
    post(context, content, builder)
  }

  fun cancel(context: Context, content: Content) {
    NotificationManagerCompat.from(context).cancel(content.tag, NOTIFICATION_ID)
  }

  private fun post(context: Context, content: Content, builder: NotificationCompat.Builder) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) {
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    ensureChannel(context, content.channelName)
    manager.notify(content.tag, NOTIFICATION_ID, builder.build())
  }

  private fun baseBuilder(context: Context, content: Content) =
    NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(content.title)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)

  /** Creating an existing channel only updates its name, so this is safe on every post. */
  private fun ensureChannel(context: Context, channelName: String) {
    val channel = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_DEFAULT)
    context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
  }

  /** Opens the file directly (no trampoline), as Android 12+ requires. */
  private fun openIntent(context: Context, content: Content, savedUri: Uri, mimeType: String): PendingIntent {
    val intent = if (mimeType == PDF_MIME_TYPE) {
      Intent(context, DocumentKitPdfActivity::class.java)
        .putExtra(DocumentKitPdfActivity.EXTRA_URI, savedUri.toString())
        .putExtra(DocumentKitPdfActivity.EXTRA_TITLE, content.title)
        .putExtra(DocumentKitPdfActivity.EXTRA_CLOSE_LABEL, content.closeLabel)
    } else {
      val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(savedUri, mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      Intent.createChooser(view, content.title)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      content.tag.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun imagePreview(file: File?, mimeType: String): Bitmap? {
    if (file == null || !mimeType.startsWith("image/")) {
      return null
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    val largestSide = maxOf(bounds.outWidth, bounds.outHeight)
    if (largestSide <= 0) {
      return null
    }
    var sampleSize = 1
    while (largestSide / (sampleSize * 2) >= PREVIEW_MAX_SIDE_PX) {
      sampleSize *= 2
    }
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
  }
}
