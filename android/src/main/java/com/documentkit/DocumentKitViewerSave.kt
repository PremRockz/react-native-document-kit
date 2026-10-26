package com.documentkit

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Toast
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The optional Save button of DocumentKit's viewers: copies the shown file to
 * Download/<subdirectory>, confirms with a toast and, if given, the
 * "Downloaded" notification. Travels to the viewer inside its Intent.
 */
internal class DocumentKitViewerSave(
  private val subdirectory: String,
  private val fileName: String,
  private val notification: DocumentKitNotifications.Content?,
  val saveLabel: String,
  private val savedMessage: String,
  private val failedMessage: String,
) {
  fun putInto(intent: Intent): Intent = intent.putExtra(EXTRA_SAVE, Bundle().apply {
    putString(KEY_SUBDIRECTORY, subdirectory)
    putString(KEY_FILE_NAME, fileName)
    putString(KEY_SAVE_LABEL, saveLabel)
    putString(KEY_SAVED_MESSAGE, savedMessage)
    putString(KEY_FAILED_MESSAGE, failedMessage)
    notification?.let { putBundle(KEY_NOTIFICATION, it.toBundle()) }
  })

  fun run(activity: Activity, sourceUri: Uri, mimeType: String, button: View, headers: Map<String, String> = emptyMap()) {
    button.isEnabled = false
    val context = activity.applicationContext
    saveWorker.execute {
      val message = try {
        val saved = DocumentKitSaver.saveToDownloads(context, sourceUri, fileName, mimeType, subdirectory, headers)
        notification?.let {
          DocumentKitNotifications.showCompleted(context, it, saved.uri, saved.mimeType, DocumentKitSaver.localFileOf(sourceUri))
        }
        savedMessage
      } catch (_: Exception) {
        failedMessage
      }
      activity.runOnUiThread {
        button.isEnabled = true
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
      }
    }
  }

  companion object {
    private const val EXTRA_SAVE = "documentkit.save"
    private const val KEY_SUBDIRECTORY = "subdirectory"
    private const val KEY_FILE_NAME = "fileName"
    private const val KEY_SAVE_LABEL = "saveLabel"
    private const val KEY_SAVED_MESSAGE = "savedMessage"
    private const val KEY_FAILED_MESSAGE = "failedMessage"
    private const val KEY_NOTIFICATION = "notification"

    // Saves are rare and short; one thread keeps them in order.
    private val saveWorker: ExecutorService = Executors.newSingleThreadExecutor()

    fun from(intent: Intent): DocumentKitViewerSave? = intent.getBundleExtra(EXTRA_SAVE)?.let {
      DocumentKitViewerSave(
        subdirectory = it.getString(KEY_SUBDIRECTORY).orEmpty(),
        fileName = it.getString(KEY_FILE_NAME).orEmpty(),
        notification = DocumentKitNotifications.Content.from(it.getBundle(KEY_NOTIFICATION)),
        saveLabel = it.getString(KEY_SAVE_LABEL).orEmpty(),
        savedMessage = it.getString(KEY_SAVED_MESSAGE).orEmpty(),
        failedMessage = it.getString(KEY_FAILED_MESSAGE).orEmpty(),
      )
    }
  }
}
