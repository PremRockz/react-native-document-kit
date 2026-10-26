package com.documentkit

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.ext.SdkExtensions
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class DocumentKitMediaPickerModule(reactContext: ReactApplicationContext) :
  NativeDocumentKitMediaPickerSpec(reactContext), ActivityEventListener {

  private sealed interface PendingRequest {
    val promise: Promise
    val requestCode: Int
  }

  private class CameraRequest(
    override val promise: Promise,
    val outputFile: File,
    val mimeType: String,
  ) : PendingRequest {
    override val requestCode = REQUEST_CODE_CAMERA
  }

  /** Photo library or file picker: both return existing content:// URIs to copy. */
  private class SelectionRequest(
    override val promise: Promise,
    override val requestCode: Int,
    /** 0 means no limit. */
    val selectionLimit: Int,
  ) : PendingRequest

  // Copying and metadata reads must stay off the UI thread.
  private val fileWorker: ExecutorService = Executors.newSingleThreadExecutor()
  private var pendingRequest: PendingRequest? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    fileWorker.shutdown()
    pendingRequest = null
    super.invalidate()
  }

  override fun captureWithSystemCamera(
    mediaType: String,
    videoQuality: String,
    maxDurationSeconds: Double,
    promise: Promise,
  ) {
    val activity = startableActivity(promise) ?: return
    val context = reactApplicationContext
    if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
      promise.reject(E_UNAVAILABLE, "This device has no camera")
      return
    }

    val isVideo = mediaType == MEDIA_TYPE_VIDEO
    val outputFile = try {
      if (isVideo) {
        DocumentKitFiles.createCaptureFile(context, "Video", "mp4")
      } else {
        DocumentKitFiles.createCaptureFile(context, "Image", "jpg")
      }
    } catch (error: Exception) {
      promise.reject(E_CAPTURE_FAILED, "Could not create the capture file", error)
      return
    }
    val outputUri = FileProvider.getUriForFile(context, "${context.packageName}.documentkit.fileprovider", outputFile)

    val intent = Intent(if (isVideo) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE).apply {
      putExtra(MediaStore.EXTRA_OUTPUT, outputUri)
      // ClipData carries the URI grant reliably to every camera app.
      clipData = ClipData.newRawUri("", outputUri)
      addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      if (isVideo) {
        // The intent only knows low (0) and high (1).
        putExtra(MediaStore.EXTRA_VIDEO_QUALITY, if (videoQuality == VIDEO_QUALITY_LOW) 0 else 1)
        if (maxDurationSeconds > 0) {
          putExtra(MediaStore.EXTRA_DURATION_LIMIT, maxDurationSeconds.toInt())
        }
      }
    }

    pendingRequest = CameraRequest(promise, outputFile, if (isVideo) "video/mp4" else "image/jpeg")
    try {
      activity.startActivityForResult(intent, REQUEST_CODE_CAMERA)
    } catch (error: ActivityNotFoundException) {
      pendingRequest = null
      outputFile.delete()
      promise.reject(E_UNAVAILABLE, "No camera app is available", error)
    } catch (error: Exception) {
      // E.g. SecurityException: camera permission revoked after JS checked it.
      // Clearing the request keeps later calls from failing with E_BUSY.
      pendingRequest = null
      outputFile.delete()
      promise.reject(E_CAPTURE_FAILED, "Could not open the camera app", error)
    }
  }

  override fun pickFromLibrary(mediaType: String, selectionLimit: Double, promise: Promise) {
    val activity = startableActivity(promise) ?: return
    val limit = selectionLimit.toInt().coerceAtLeast(0)
    val mimeFilter = when (mediaType) {
      MEDIA_TYPE_PHOTO -> "image/*"
      MEDIA_TYPE_VIDEO -> "video/*"
      else -> null
    }

    val intent = if (isSystemPhotoPickerAvailable()) {
      Intent(MediaStore.ACTION_PICK_IMAGES).apply {
        mimeFilter?.let { type = it }
        // The extra must be > 1 and within the platform maximum, otherwise the picker throws.
        val maxLimit = MediaStore.getPickImagesMaxLimit()
        val effectiveLimit = if (limit == 0) maxLimit else limit.coerceAtMost(maxLimit)
        if (effectiveLimit > 1) {
          putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, effectiveLimit)
        }
      }
    } else {
      Intent(Intent.ACTION_GET_CONTENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mimeFilter ?: "*/*"
        if (mimeFilter == null) {
          putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
        }
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, limit != 1)
      }
    }

    pendingRequest = SelectionRequest(promise, REQUEST_CODE_LIBRARY, limit)
    try {
      activity.startActivityForResult(intent, REQUEST_CODE_LIBRARY)
    } catch (error: ActivityNotFoundException) {
      pendingRequest = null
      promise.reject(E_PICK_FAILED, "No photo picker is available", error)
    } catch (error: Exception) {
      pendingRequest = null
      promise.reject(E_PICK_FAILED, "Could not open the photo picker", error)
    }
  }

  override fun pickDocuments(mimeTypes: ReadableArray, allowMultiple: Boolean, promise: Promise) {
    val activity = startableActivity(promise) ?: return
    val types = (0 until mimeTypes.size()).mapNotNull { mimeTypes.getString(it) }.filter { it.isNotBlank() }

    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = types.singleOrNull() ?: "*/*"
      if (types.size > 1) {
        putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
      }
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
    }

    pendingRequest = SelectionRequest(promise, REQUEST_CODE_DOCUMENTS, if (allowMultiple) 0 else 1)
    try {
      activity.startActivityForResult(intent, REQUEST_CODE_DOCUMENTS)
    } catch (error: ActivityNotFoundException) {
      pendingRequest = null
      promise.reject(E_PICK_FAILED, "No file picker is available", error)
    } catch (error: Exception) {
      pendingRequest = null
      promise.reject(E_PICK_FAILED, "Could not open the file picker", error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    val request = pendingRequest ?: return
    if (requestCode != request.requestCode) {
      return
    }
    pendingRequest = null

    when (request) {
      is CameraRequest -> handleCameraResult(request, resultCode, data)
      is SelectionRequest -> handleSelectionResult(request, resultCode, data)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun handleCameraResult(request: CameraRequest, resultCode: Int, data: Intent?) {
    if (resultCode != Activity.RESULT_OK) {
      request.outputFile.delete()
      request.promise.resolve(cancelledResponse())
      return
    }
    fileWorker.execute {
      try {
        // Some camera apps ignore EXTRA_OUTPUT and return their own URI instead.
        val returnedUri = data?.data
        if (request.outputFile.length() == 0L && returnedUri != null) {
          DocumentKitFiles.copyContent(reactApplicationContext, returnedUri, request.outputFile)
        }
        if (request.outputFile.length() == 0L) {
          request.outputFile.delete()
          request.promise.reject(E_CAPTURE_FAILED, "The camera app returned no file")
          return@execute
        }
        val file = DocumentKitFiles.describe(request.outputFile, request.mimeType)
        request.promise.resolve(pickedResponse(listOf(file)))
      } catch (error: Exception) {
        request.promise.reject(E_CAPTURE_FAILED, "Could not read the captured file", error)
      }
    }
  }

  private fun handleSelectionResult(request: SelectionRequest, resultCode: Int, data: Intent?) {
    val uris = if (resultCode == Activity.RESULT_OK) collectUris(data) else emptyList()
    if (uris.isEmpty()) {
      request.promise.resolve(cancelledResponse())
      return
    }
    // ACTION_GET_CONTENT cannot enforce a limit, so trim here.
    val selected = if (request.selectionLimit > 0) uris.take(request.selectionLimit) else uris
    fileWorker.execute {
      try {
        val context = reactApplicationContext
        val files = selected.map { uri ->
          val cached = DocumentKitFiles.copyToCache(context, uri)
          DocumentKitFiles.describe(cached.file, cached.mimeType)
        }
        request.promise.resolve(pickedResponse(files))
      } catch (error: Exception) {
        request.promise.reject(E_PICK_FAILED, "Could not copy the selected file", error)
      }
    }
  }

  private fun collectUris(data: Intent?): List<Uri> {
    val clipData = data?.clipData
    if (clipData != null) {
      return (0 until clipData.itemCount).mapNotNull { clipData.getItemAt(it).uri }
    }
    return listOfNotNull(data?.data)
  }

  /** Returns the activity to launch from, or rejects and returns null. */
  private fun startableActivity(promise: Promise): Activity? {
    if (pendingRequest != null) {
      promise.reject(E_BUSY, "Another DocumentKit picker is already open")
      return null
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "No activity to launch the picker from")
    }
    return activity
  }

  private fun isSystemPhotoPickerAvailable(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
        SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2)

  private fun cancelledResponse(): WritableMap = Arguments.createMap().apply {
    putBoolean("cancelled", true)
    putArray("files", Arguments.createArray())
  }

  private fun pickedResponse(files: List<WritableMap>): WritableMap = Arguments.createMap().apply {
    putBoolean("cancelled", false)
    putArray("files", Arguments.createArray().apply { files.forEach { pushMap(it) } })
  }

  companion object {
    const val NAME = NativeDocumentKitMediaPickerSpec.NAME

    private const val REQUEST_CODE_CAMERA = 7302
    private const val REQUEST_CODE_LIBRARY = 7303
    private const val REQUEST_CODE_DOCUMENTS = 7304

    private const val MEDIA_TYPE_PHOTO = "photo"
    private const val MEDIA_TYPE_VIDEO = "video"
    private const val VIDEO_QUALITY_LOW = "low"

    private const val E_BUSY = "E_BUSY"
    private const val E_UNAVAILABLE = "E_UNAVAILABLE"
    private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
    private const val E_CAPTURE_FAILED = "E_CAPTURE_FAILED"
    private const val E_PICK_FAILED = "E_PICK_FAILED"
  }
}
