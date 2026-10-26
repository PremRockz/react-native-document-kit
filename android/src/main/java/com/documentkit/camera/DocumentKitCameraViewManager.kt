package com.documentkit.camera

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.DocumentKitCameraViewManagerDelegate
import com.facebook.react.viewmanagers.DocumentKitCameraViewManagerInterface

/** Fabric view manager for `DocumentKitCameraView` (src/specs/DocumentKitCameraViewNativeComponent.ts). */
@ReactModule(name = DocumentKitCameraViewManager.NAME)
class DocumentKitCameraViewManager :
  SimpleViewManager<DocumentKitCameraView>(), DocumentKitCameraViewManagerInterface<DocumentKitCameraView> {

  private val delegate = DocumentKitCameraViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<DocumentKitCameraView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): DocumentKitCameraView =
    DocumentKitCameraView(context)

  override fun setCameraId(view: DocumentKitCameraView, value: String?) {
    view.setCameraId(value.orEmpty())
  }

  override fun setCameraPosition(view: DocumentKitCameraView, value: String?) {
    view.setPosition(value ?: DocumentKitCameraView.POSITION_BACK)
  }

  override fun setMode(view: DocumentKitCameraView, value: String?) {
    view.setMode(value ?: DocumentKitCameraView.MODE_PHOTO)
  }

  override fun setVideoQuality(view: DocumentKitCameraView, value: String?) {
    view.setVideoQuality(value ?: DocumentKitCameraView.QUALITY_MEDIUM)
  }

  override fun setVideoBitRateKbps(view: DocumentKitCameraView, value: Int) {
    view.setVideoBitRateKbps(value)
  }

  override fun setTorch(view: DocumentKitCameraView, value: Boolean) {
    view.setTorch(value)
  }

  override fun setIsActive(view: DocumentKitCameraView, value: Boolean) {
    view.setActive(value)
  }

  override fun setIsZoomEnabled(view: DocumentKitCameraView, value: Boolean) {
    view.isZoomEnabled = value
  }

  override fun addEventEmitters(reactContext: ThemedReactContext, view: DocumentKitCameraView) {
    super.addEventEmitters(reactContext, view)
    view.listener = object : DocumentKitCameraView.Listener {
      override fun onPreviewStarted(hasFlash: Boolean) {
        dispatch(view, EVENT_PREVIEW_STARTED) { putBoolean("hasFlash", hasFlash) }
      }

      override fun onCameraError(code: String, message: String) {
        dispatch(view, EVENT_CAMERA_ERROR) {
          putString("code", code)
          putString("message", message)
        }
      }

      override fun onZoomChanged(zoom: Float, minZoom: Float, maxZoom: Float) {
        dispatch(view, EVENT_ZOOM_CHANGED) {
          putDouble("zoom", zoom.toDouble())
          putDouble("minZoom", minZoom.toDouble())
          putDouble("maxZoom", maxZoom.toDouble())
        }
      }

      override fun onRecordingProgress(seconds: Double, bytes: Double) {
        dispatch(view, EVENT_RECORDING_PROGRESS) {
          putDouble("seconds", seconds)
          putDouble("bytes", bytes)
        }
      }

      override fun onOrientationChanged(degrees: Int) {
        dispatch(view, EVENT_ORIENTATION_CHANGED) { putInt("degrees", degrees) }
      }

      override fun onSafeAreaInsets(top: Double, right: Double, bottom: Double, left: Double) {
        dispatch(view, EVENT_SAFE_AREA_INSETS) {
          putDouble("top", top)
          putDouble("right", right)
          putDouble("bottom", bottom)
          putDouble("left", left)
        }
      }

      override fun onSwipe(direction: String) {
        dispatch(view, EVENT_SWIPE) { putString("direction", direction) }
      }

      override fun onInterruption(isInterrupted: Boolean, reason: String) {
        dispatch(view, EVENT_INTERRUPTION) {
          putBoolean("isInterrupted", isInterrupted)
          putString("reason", reason)
        }
      }
    }
  }

  override fun onDropViewInstance(view: DocumentKitCameraView) {
    super.onDropViewInstance(view)
    view.release()
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      EVENT_PREVIEW_STARTED to mapOf("registrationName" to "onPreviewStarted"),
      EVENT_CAMERA_ERROR to mapOf("registrationName" to "onCameraError"),
      EVENT_ZOOM_CHANGED to mapOf("registrationName" to "onZoomChanged"),
      EVENT_RECORDING_PROGRESS to mapOf("registrationName" to "onRecordingProgress"),
      EVENT_ORIENTATION_CHANGED to mapOf("registrationName" to "onOrientationChanged"),
      EVENT_SAFE_AREA_INSETS to mapOf("registrationName" to "onSafeAreaInsets"),
      EVENT_SWIPE to mapOf("registrationName" to "onSwipe"),
      EVENT_INTERRUPTION to mapOf("registrationName" to "onInterruption"),
    )

  private fun dispatch(view: DocumentKitCameraView, name: String, fill: WritableMap.() -> Unit) {
    val data = Arguments.createMap().apply(fill)
    UIManagerHelper.getEventDispatcher(UIManagerHelper.getReactContext(view))
      ?.dispatchEvent(DocumentKitCameraViewEvent(UIManagerHelper.getSurfaceId(view), view.id, name, data))
  }

  companion object {
    const val NAME = "DocumentKitCameraView"
    private const val EVENT_PREVIEW_STARTED = "topPreviewStarted"
    private const val EVENT_CAMERA_ERROR = "topCameraError"
    private const val EVENT_ZOOM_CHANGED = "topZoomChanged"
    private const val EVENT_RECORDING_PROGRESS = "topRecordingProgress"
    private const val EVENT_ORIENTATION_CHANGED = "topOrientationChanged"
    private const val EVENT_SAFE_AREA_INSETS = "topSafeAreaInsets"
    private const val EVENT_SWIPE = "topSwipe"
    private const val EVENT_INTERRUPTION = "topInterruption"
  }
}

private class DocumentKitCameraViewEvent(
  surfaceId: Int,
  viewTag: Int,
  private val name: String,
  private val data: WritableMap,
) : Event<DocumentKitCameraViewEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun getEventData(): WritableMap = data
}
