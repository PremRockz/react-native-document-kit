package com.documentkit.camera

import java.lang.ref.WeakReference

/**
 * Mounted camera views by the `cameraId` JS gave them, so DocumentKitCameraModule
 * calls reach the right camera without view tags. Main thread only.
 */
internal object DocumentKitCameraRegistry {
  private val views = HashMap<String, WeakReference<DocumentKitCameraView>>()

  fun register(cameraId: String, view: DocumentKitCameraView) {
    views[cameraId] = WeakReference(view)
  }

  fun unregister(cameraId: String, view: DocumentKitCameraView) {
    if (views[cameraId]?.get() === view) {
      views.remove(cameraId)
    }
  }

  fun find(cameraId: String): DocumentKitCameraView? = views[cameraId]?.get()
}

/** A camera failure with the rejection code JS sees (NativeDocumentKitCamera.ts). */
internal class DocumentKitCameraException(
  val code: String,
  message: String,
  cause: Throwable? = null,
) : Exception(message, cause) {
  companion object {
    const val E_NOT_READY = "E_NOT_READY"
    const val E_BUSY = "E_BUSY"
    const val E_CAPTURE = "E_CAPTURE"
    const val E_STORAGE = "E_STORAGE"
    const val E_CANCELLED = "E_CANCELLED"
  }
}
