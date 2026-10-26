package com.documentkit.camera

import android.graphics.RectF
import android.net.Uri
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.documentkit.NativeDocumentKitCameraSpec
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max

/** DocumentKit's own camera: pre-warming, and capture with a mounted DocumentKitCameraView. */
class DocumentKitCameraModule(reactContext: ReactApplicationContext) :
  NativeDocumentKitCameraSpec(reactContext) {

  // CameraX is one per process. Its first getInstance starts it and reads every
  // camera, which is slow; DocumentKitCameraView's own getInstance then returns at
  // once. That covers both cameras, so `position` is not needed here.
  override fun prewarm(position: String, promise: Promise) {
    val future = ProcessCameraProvider.getInstance(reactApplicationContext)
    future.addListener({
      try {
        future.get()
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject(E_PREWARM, error.message, error)
      }
    }, ContextCompat.getMainExecutor(reactApplicationContext))
  }

  override fun takePhoto(cameraId: String, flash: String, promise: Promise) {
    withView(cameraId, promise) { it.takePhoto(flash, settle(promise)) }
  }

  override fun resumePreview(cameraId: String) {
    withView(cameraId) { it.resumePreview() }
  }

  override fun startRecording(cameraId: String, options: ReadableMap, promise: Promise) {
    val isAudioEnabled = options.hasKey("isAudioEnabled") && options.getBoolean("isAudioEnabled")
    val maxDurationSeconds = if (options.hasKey("maxDurationSeconds")) options.getInt("maxDurationSeconds") else 0
    withView(cameraId, promise) { it.startRecording(isAudioEnabled, maxDurationSeconds, settle(promise)) }
  }

  override fun stopRecording(cameraId: String) {
    withView(cameraId) { it.stopRecording() }
  }

  override fun pauseRecording(cameraId: String) {
    withView(cameraId) { it.pauseRecording() }
  }

  override fun resumeRecording(cameraId: String) {
    withView(cameraId) { it.resumeRecording() }
  }

  override fun cancelRecording(cameraId: String) {
    withView(cameraId) { it.cancelRecording() }
  }

  override fun setZoom(cameraId: String, zoom: Double) {
    withView(cameraId) { it.setZoom(zoom.toFloat()) }
  }

  override fun editPhoto(uri: String, edits: ReadableMap, promise: Promise) {
    val path = Uri.parse(uri).path
    if (path == null) {
      promise.reject(DocumentKitCameraException.E_STORAGE, "Not a file URI: $uri")
      return
    }
    val crop = edits.getMap("crop")
    val cropRect = if (crop == null) {
      RectF(0f, 0f, 1f, 1f)
    } else {
      val x = crop.getDouble("x").toFloat()
      val y = crop.getDouble("y").toFloat()
      RectF(x, y, x + crop.getDouble("width").toFloat(), y + crop.getDouble("height").toFloat())
    }
    val photoEdits = DocumentKitPhotoEditor.Edits(
      rotationDegrees = edits.getDouble("rotationDegrees").toInt(),
      isFlipped = edits.getBoolean("isFlipped"),
      straightenDegrees = edits.getDouble("straightenDegrees").toFloat(),
      crop = cropRect,
    )
    val metrics = reactApplicationContext.resources.displayMetrics
    val displayEdge = max(metrics.widthPixels, metrics.heightPixels)
    editWorker.execute {
      try {
        promise.resolve(DocumentKitPhotoEditor.edit(reactApplicationContext, File(path), photoEdits, displayEdge))
      } catch (error: Exception) {
        promise.reject(DocumentKitCameraException.E_STORAGE, error.message ?: "Cannot edit the photo", error)
      }
    }
  }

  /** Runs on the main thread with the mounted view; a missing view rejects E_NOT_READY, or is ignored without a promise. */
  private fun withView(cameraId: String, promise: Promise? = null, action: (DocumentKitCameraView) -> Unit) {
    UiThreadUtil.runOnUiThread {
      val view = DocumentKitCameraRegistry.find(cameraId)
      if (view == null) {
        promise?.reject(DocumentKitCameraException.E_NOT_READY, "No camera view with id $cameraId")
      } else {
        action(view)
      }
    }
  }

  private fun settle(promise: Promise): (Result<WritableMap>) -> Unit = { result ->
    result.fold(
      onSuccess = { promise.resolve(it) },
      onFailure = { error ->
        val code = (error as? DocumentKitCameraException)?.code ?: DocumentKitCameraException.E_CAPTURE
        promise.reject(code, error.message, error)
      },
    )
  }

  companion object {
    const val NAME = NativeDocumentKitCameraSpec.NAME
    // Edits are rare and one at a time; decoding a photo never runs on the UI thread.
    private val editWorker: ExecutorService = Executors.newSingleThreadExecutor()
    private const val E_PREWARM = "E_PREWARM"
  }
}
