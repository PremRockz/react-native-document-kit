package com.documentkit

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import java.io.File

class DocumentKitPreviewModule(reactContext: ReactApplicationContext) :
  NativeDocumentKitPreviewSpec(reactContext), ActivityEventListener {

  private var pendingPromise: Promise? = null
  private var pendingRequestCode = 0

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    pendingPromise = null
    super.invalidate()
  }

  override fun presentFile(
    fileUri: String,
    title: String,
    mimeType: String,
    labels: ReadableMap,
    save: ReadableMap?,
    promise: Promise,
  ) {
    val activity = startableActivity(promise) ?: return
    val uri = fileUri.toUri()
    val type = mimeType.ifEmpty { DocumentKitFiles.mimeTypeOf(File(uri.path.orEmpty())) }
    val saveAction = toViewerSave(save, labels, title)

    if (type == PDF_MIME_TYPE) {
      val intent = Intent(activity, DocumentKitPdfActivity::class.java)
        .putExtra(DocumentKitPdfActivity.EXTRA_URI, fileUri)
        .putExtra(DocumentKitPdfActivity.EXTRA_TITLE, title)
        .putExtra(DocumentKitPdfActivity.EXTRA_CLOSE_LABEL, labels.getString("close"))
      saveAction?.putInto(intent)
      launchViewer(activity, intent, REQUEST_CODE_PDF, promise)
      return
    }

    if (type == TEXT_MIME_TYPE || type in DocumentKitTextActivity.CSV_MIME_TYPES) {
      val intent = Intent(activity, DocumentKitTextActivity::class.java)
        .putExtra(DocumentKitTextActivity.EXTRA_URI, fileUri)
        .putExtra(DocumentKitTextActivity.EXTRA_TITLE, title)
        .putExtra(DocumentKitTextActivity.EXTRA_MIME_TYPE, type)
        .putExtra(DocumentKitTextActivity.EXTRA_CLOSE_LABEL, labels.getString("close"))
        .putExtra(DocumentKitTextActivity.EXTRA_TRUNCATED_LABEL, labels.getString("truncated"))
      saveAction?.putInto(intent)
      launchViewer(activity, intent, REQUEST_CODE_TEXT, promise)
      return
    }

    if (type == DocumentKitHtmlActivity.HTML_MIME_TYPE) {
      val intent = Intent(activity, DocumentKitHtmlActivity::class.java)
        .putExtra(DocumentKitHtmlActivity.EXTRA_URI, fileUri)
        .putExtra(DocumentKitHtmlActivity.EXTRA_TITLE, title)
        .putExtra(DocumentKitHtmlActivity.EXTRA_CLOSE_LABEL, labels.getString("close"))
        .putExtra(DocumentKitHtmlActivity.EXTRA_TRUNCATED_LABEL, labels.getString("truncated"))
      saveAction?.putInto(intent)
      launchViewer(activity, intent, REQUEST_CODE_HTML, promise)
      return
    }

    // ImageDecoder cannot read SVG, so it goes to "Open with" below.
    if (type.startsWith(IMAGE_MIME_PREFIX) && type != SVG_MIME_TYPE) {
      val intent = Intent(activity, DocumentKitImageActivity::class.java)
        .putExtra(DocumentKitImageActivity.EXTRA_URI, fileUri)
        .putExtra(DocumentKitImageActivity.EXTRA_TITLE, title)
        .putExtra(DocumentKitImageActivity.EXTRA_MIME_TYPE, type)
        .putExtra(DocumentKitImageActivity.EXTRA_CLOSE_LABEL, labels.getString("close"))
      saveAction?.putInto(intent)
      launchViewer(activity, intent, REQUEST_CODE_IMAGE, promise)
      return
    }

    // Android has no in-app renderer for other types (e.g. Office): hand over to another app.
    val shareableUri = try {
      toShareableUri(uri)
    } catch (error: IllegalArgumentException) {
      promise.reject(E_VIEWER, "The file is outside DocumentKit's cache folder", error)
      return
    }
    val viewIntent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(shareableUri, type)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    if (viewIntent.resolveActivity(activity.packageManager) == null) {
      promise.resolve(OUTCOME_UNSUPPORTED)
      return
    }
    try {
      activity.startActivity(Intent.createChooser(viewIntent, title))
      promise.resolve(OUTCOME_OPENED_EXTERNALLY)
    } catch (_: ActivityNotFoundException) {
      promise.resolve(OUTCOME_UNSUPPORTED)
    } catch (error: Exception) {
      promise.reject(E_VIEWER, "The file could not be opened", error)
    }
  }

  override fun playMedia(url: String, headers: ReadableMap, title: String, labels: ReadableMap, options: ReadableMap, promise: Promise) {
    val activity = startableActivity(promise) ?: return
    val intent = Intent(activity, DocumentKitMediaActivity::class.java)
      .putExtra(DocumentKitMediaActivity.EXTRA_URL, url)
      .putExtra(DocumentKitMediaActivity.EXTRA_HEADERS, toStringBundle(headers))
      .putExtra(DocumentKitMediaActivity.EXTRA_TITLE, title)
      .putExtra(DocumentKitMediaActivity.EXTRA_LABELS, toStringBundle(labels))
      .putExtra(DocumentKitMediaActivity.EXTRA_MUTED, options.hasKey("muted") && options.getBoolean("muted"))
      // processColor's ARGB arrives as a double (signed on Android); 0 keeps the player's default.
      .putExtra(
        DocumentKitMediaActivity.EXTRA_ACCENT_COLOR,
        if (options.hasKey("accentColor")) options.getDouble("accentColor").toLong().toInt() else 0,
      )
      .putExtra(DocumentKitMediaActivity.EXTRA_MIME_TYPE, options.getString("mimeType").orEmpty())
      .putExtra(
        DocumentKitMediaActivity.EXTRA_START_POSITION_MS,
        if (options.hasKey("startPositionMs")) options.getDouble("startPositionMs").toLong() else 0L,
      )
      .putExtra(DocumentKitMediaActivity.EXTRA_AUTO_PLAY, !options.hasKey("autoPlay") || options.getBoolean("autoPlay"))
      .putExtra(DocumentKitMediaActivity.EXTRA_SKIP_BACK_SECONDS, options.getDoubleOr("skipBackSeconds", 5.0).toInt())
      .putExtra(DocumentKitMediaActivity.EXTRA_SKIP_FORWARD_SECONDS, options.getDoubleOr("skipForwardSeconds", 15.0).toInt())
      .putExtra(DocumentKitMediaActivity.EXTRA_ALLOW_SPEED, !options.hasKey("allowSpeed") || options.getBoolean("allowSpeed"))
      .putExtra(
        DocumentKitMediaActivity.EXTRA_ALLOW_FULL_SCREEN,
        !options.hasKey("allowFullScreen") || options.getBoolean("allowFullScreen"),
      )
    val save = if (options.hasKey("save") && !options.isNull("save")) options.getMap("save") else null
    toViewerSave(save, labels, title)?.putInto(intent)
    launchViewer(activity, intent, REQUEST_CODE_MEDIA, promise)
  }

  private fun ReadableMap.getDoubleOr(key: String, fallback: Double): Double =
    if (hasKey(key) && !isNull(key)) getDouble(key) else fallback

  private fun toStringBundle(map: ReadableMap): Bundle = Bundle().apply {
    map.toHashMap().forEach { (key, value) -> (value as? String)?.let { putString(key, it) } }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    val promise = pendingPromise ?: return
    if (requestCode != pendingRequestCode) {
      return
    }
    pendingPromise = null
    when {
      resultCode == DocumentKitPdfActivity.RESULT_VIEWER_ERROR -> promise.reject(E_VIEWER, "The file could not be shown")
      // playMedia resolves NativePlayerOutcome; the other viewers a plain outcome string.
      requestCode == REQUEST_CODE_MEDIA -> promise.resolve(Arguments.createMap().apply {
        val isUnauthorized = resultCode == DocumentKitMediaActivity.RESULT_UNAUTHORIZED
        putString("outcome", if (isUnauthorized) OUTCOME_UNAUTHORIZED else OUTCOME_CLOSED)
        putDouble("positionMs", (data?.getLongExtra(DocumentKitMediaActivity.EXTRA_RESULT_POSITION_MS, 0L) ?: 0L).toDouble())
        putInt("httpStatus", if (isUnauthorized) data?.getIntExtra(DocumentKitMediaActivity.EXTRA_RESULT_HTTP_STATUS, 0) ?: 0 else 0)
      })
      else -> promise.resolve(OUTCOME_CLOSED)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun launchViewer(activity: Activity, intent: Intent, requestCode: Int, promise: Promise) {
    pendingPromise = promise
    pendingRequestCode = requestCode
    try {
      activity.startActivityForResult(intent, requestCode)
    } catch (error: Exception) {
      // Clear it, or every later preview would fail with E_BUSY.
      pendingPromise = null
      promise.reject(E_VIEWER, "The viewer could not open", error)
    }
  }

  private fun toViewerSave(save: ReadableMap?, labels: ReadableMap, fileName: String): DocumentKitViewerSave? {
    save ?: return null
    return DocumentKitViewerSave(
      subdirectory = save.getString("subdirectory").orEmpty(),
      fileName = fileName,
      notification = DocumentKitNotifications.Content.from(
        if (save.hasKey("notification") && !save.isNull("notification")) save.getMap("notification") else null,
      ),
      saveLabel = labels.getString("save").orEmpty(),
      savedMessage = labels.getString("saved").orEmpty(),
      failedMessage = labels.getString("saveFailed").orEmpty(),
    )
  }

  /** file:// inside DocumentKit's cache becomes a content:// URI other apps may read. */
  private fun toShareableUri(uri: Uri): Uri {
    if (uri.scheme == "content") {
      return uri
    }
    val context = reactApplicationContext
    return FileProvider.getUriForFile(context, "${context.packageName}.documentkit.fileprovider", File(uri.path.orEmpty()))
  }

  private fun startableActivity(promise: Promise): Activity? {
    if (pendingPromise != null) {
      promise.reject(E_BUSY, "A preview is already open")
      return null
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "No activity to open the preview from")
    }
    return activity
  }

  companion object {
    const val NAME = NativeDocumentKitPreviewSpec.NAME

    private const val PDF_MIME_TYPE = "application/pdf"
    private const val IMAGE_MIME_PREFIX = "image/"
    private const val SVG_MIME_TYPE = "image/svg+xml"
    private const val TEXT_MIME_TYPE = "text/plain"
    private const val REQUEST_CODE_PDF = 7311
    private const val REQUEST_CODE_MEDIA = 7312
    private const val REQUEST_CODE_IMAGE = 7313
    private const val REQUEST_CODE_TEXT = 7314
    private const val REQUEST_CODE_HTML = 7315

    private const val OUTCOME_CLOSED = "closed"
    private const val OUTCOME_UNAUTHORIZED = "unauthorized"
    private const val OUTCOME_OPENED_EXTERNALLY = "opened_externally"
    private const val OUTCOME_UNSUPPORTED = "unsupported"

    private const val E_BUSY = "E_BUSY"
    private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
    private const val E_VIEWER = "E_VIEWER"
  }
}
