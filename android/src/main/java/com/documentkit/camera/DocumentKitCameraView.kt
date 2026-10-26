package com.documentkit.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.OrientationEventListener
import android.view.ScaleGestureDetector
import android.view.Surface
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.PendingRecording
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ThemedReactContext
import com.documentkit.DocumentKitFiles
import java.io.File
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

/**
 * Live camera on CameraX: preview, photo, video, pinch zoom and tap to focus.
 * The camera runs only while the view is attached, `isActive` is true and the
 * app is in the foreground (docs/CAMERA_PLAN.md §6).
 */
@SuppressLint("ViewConstructor")
class DocumentKitCameraView(private val reactContext: ThemedReactContext) :
  FrameLayout(reactContext), LifecycleOwner, LifecycleEventListener {

  interface Listener {
    fun onPreviewStarted(hasFlash: Boolean)
    fun onCameraError(code: String, message: String)
    fun onZoomChanged(zoom: Float, minZoom: Float, maxZoom: Float)
    fun onRecordingProgress(seconds: Double, bytes: Double)
    fun onOrientationChanged(degrees: Int)
    fun onSafeAreaInsets(top: Double, right: Double, bottom: Double, left: Double)
    fun onSwipe(direction: String)
    fun onInterruption(isInterrupted: Boolean, reason: String)
  }

  var listener: Listener? = null
  /** False ignores pinches; JS hides the lens buttons too. */
  var isZoomEnabled = true

  private val lifecycleRegistry = LifecycleRegistry(this)
  override val lifecycle: Lifecycle
    get() = lifecycleRegistry

  private val previewView = PreviewView(reactContext).apply {
    // SurfaceView, as react-native-vision-camera uses by default: frames go
    // straight to the display, so it is cheaper than TextureView. The freeze on
    // capture still works: PreviewView reads a SurfaceView's frame with PixelCopy.
    implementationMode = PreviewView.ImplementationMode.PERFORMANCE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  // Shows the last preview frame from the shutter until the photo is handed over.
  private val frozenFrame = ImageView(reactContext).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    visibility = GONE
  }
  private val preview = Preview.Builder().build()
  // Latency first: the photo is still full resolution, only the processing is quicker.
  private val imageCapture = ImageCapture.Builder()
    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
    .build()
  private var videoCapture = buildVideoCapture(QUALITY_MEDIUM, 0)
  // Not View.post: its actions never run once the view is detached, and results
  // must still settle the JS promise after the camera screen closes.
  private val mainHandler = Handler(Looper.getMainLooper())
  private var isReleased = false

  private var cameraProvider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var isLoadingProvider = false
  private var cameraId: String? = null
  private var position = POSITION_BACK
  private var mode = MODE_PHOTO
  private var videoQuality = QUALITY_MEDIUM
  private var videoBitRateKbps = 0
  private var isTorchOn = false
  private var isActive = true
  private var isHostResumed = reactContext.lifecycleState == LifecycleState.RESUMED
  private var boundUseCases: List<UseCase> = emptyList()
  private var boundKey: String? = null
  private var isCapturing = false
  private var isLayoutPending = false
  private var orientationDegrees = 0
  // What JS last got: the phone's turn relative to the screen.
  private var reportedDegrees = 0
  private var lastZoom = Float.NaN
  private var isInterrupted = false

  private var recording: Recording? = null
  private var recordingFile: File? = null
  private var recordingCallback: ((Result<WritableMap>) -> Unit)? = null
  private var isRecordingCancelled = false
  private var lastProgressSecond = -1L

  // Captures are saved upright for how the phone is held, whatever the screen does.
  private val orientationListener = object : OrientationEventListener(reactContext) {
    override fun onOrientationChanged(degrees: Int) {
      if (degrees == ORIENTATION_UNKNOWN) {
        return
      }
      val bucket = when (degrees) {
        in 45 until 135 -> 90
        in 135 until 225 -> 180
        in 225 until 315 -> 270
        else -> 0
      }
      if (bucket != orientationDegrees) {
        orientationDegrees = bucket
        val rotation = when (bucket) {
          90 -> Surface.ROTATION_270
          180 -> Surface.ROTATION_180
          270 -> Surface.ROTATION_90
          else -> Surface.ROTATION_0
        }
        imageCapture.targetRotation = rotation
        // A recording keeps the rotation it started with.
        if (recording == null) {
          videoCapture.targetRotation = rotation
        }
      }
      // Every event, not only on a new bucket: the screen may have turned since.
      reportOrientation()
    }
  }

  private val scaleDetector = ScaleGestureDetector(
    reactContext,
    object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val zoom = camera?.cameraInfo?.zoomState?.value ?: return false
        setZoom(zoom.zoomRatio * detector.scaleFactor)
        return true
      }
    },
  )

  private val tapDetector = GestureDetector(
    reactContext,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onSingleTapUp(event: MotionEvent): Boolean {
        performClick()
        focusAt(event.x, event.y)
        return true
      }

      override fun onFling(start: MotionEvent?, end: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
        val minVelocity = SWIPE_MIN_VELOCITY_DP * resources.displayMetrics.density
        if (abs(velocityX) < minVelocity || abs(velocityX) < abs(velocityY) * 2) {
          return false
        }
        listener?.onSwipe(if (velocityX < 0) SWIPE_LEFT else SWIPE_RIGHT)
        return true
      }
    },
  )

  // CameraX can fail to configure a session without reporting an error state
  // (it only logs a timeout), which would leave the screen waiting forever.
  private val previewWatchdog = Runnable {
    listener?.onCameraError(ERROR_SESSION_FAILED, "The camera preview did not start")
  }

  init {
    // PreviewView adds its TextureView only when CameraX asks for a surface. React
    // Native does not lay out views added later, and the layout request can stop
    // at this view (requestLayout below), so the TextureView would stay unsized,
    // never produce a surface, and CameraX would time out configuring the session.
    // Lay PreviewView out the moment a child is added (as react-native-vision-camera does).
    previewView.setOnHierarchyChangeListener(object : OnHierarchyChangeListener {
      override fun onChildViewAdded(parent: View, child: View) {
        parent.measure(
          MeasureSpec.makeMeasureSpec(parent.measuredWidth, MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(parent.measuredHeight, MeasureSpec.EXACTLY),
        )
        parent.layout(0, 0, parent.measuredWidth, parent.measuredHeight)
      }

      override fun onChildViewRemoved(parent: View, child: View) = Unit
    })
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(frozenFrame, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    lifecycleRegistry.currentState = Lifecycle.State.CREATED
    reactContext.addLifecycleEventListener(this)
    previewView.previewStreamState.observe(this) { state ->
      if (state == PreviewView.StreamState.STREAMING) {
        removeCallbacks(previewWatchdog)
        listener?.onPreviewStarted(camera?.cameraInfo?.hasFlashUnit() == true)
      }
    }
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      reportSafeArea(insets)
      insets
    }
  }

  // region Props

  fun setCameraId(value: String) {
    cameraId?.let { DocumentKitCameraRegistry.unregister(it, this) }
    cameraId = value
    DocumentKitCameraRegistry.register(value, this)
  }

  fun setPosition(value: String) {
    if (value != position) {
      position = value
      updateCamera()
    }
  }

  fun setMode(value: String) {
    if (value != mode) {
      mode = value
      updateCamera()
    }
  }

  fun setVideoQuality(value: String) = setVideoOutput(value, videoBitRateKbps)

  fun setVideoBitRateKbps(value: Int) = setVideoOutput(videoQuality, value)

  private fun setVideoOutput(quality: String, bitRateKbps: Int) {
    if (quality == videoQuality && bitRateKbps == videoBitRateKbps) {
      return
    }
    videoQuality = quality
    videoBitRateKbps = bitRateKbps
    // Props arrive before recording starts; a running recording keeps its settings.
    if (recording == null) {
      cameraProvider?.unbind(videoCapture)
      boundUseCases = boundUseCases - videoCapture
      videoCapture = buildVideoCapture(quality, bitRateKbps)
      boundKey = null
      updateCamera()
    }
  }

  fun setTorch(value: Boolean) {
    isTorchOn = value
    camera?.cameraControl?.enableTorch(value)
  }

  fun setActive(value: Boolean) {
    if (value != isActive) {
      isActive = value
      updateCamera()
    }
  }

  // endregion

  /** Called when React Native drops the view; the view is not used again. */
  fun release() {
    isReleased = true
    cameraId?.let { DocumentKitCameraRegistry.unregister(it, this) }
    reactContext.removeLifecycleEventListener(this)
    orientationListener.disable()
    removeCallbacks(previewWatchdog)
    if (recording != null) {
      isRecordingCancelled = true
      recording?.stop()
    }
    camera?.cameraInfo?.zoomState?.removeObservers(this)
    cameraProvider?.unbind(*boundUseCases.toTypedArray())
    boundUseCases = emptyList()
    camera = null
    lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
  }

  // region Photo

  /**
   * Takes a full-resolution JPEG into the DocumentKit cache plus a screen-sized,
   * upright copy for display. `flash` is "off", "on" or "auto". Main thread.
   */
  fun takePhoto(flash: String, callback: (Result<WritableMap>) -> Unit) {
    if (isCapturing || recording != null) {
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_BUSY, "The camera is already capturing")))
      return
    }
    if (!isRunning() || imageCapture !in boundUseCases) {
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_NOT_READY, "The photo camera is not running")))
      return
    }
    val file = try {
      DocumentKitFiles.createCaptureFile(context, PHOTO_PREFIX, PHOTO_EXTENSION)
    } catch (error: IOException) {
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_STORAGE, "Cannot create the photo file", error)))
      return
    }

    isCapturing = true
    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    freezeFrame()
    imageCapture.flashMode = when (flash) {
      FLASH_ON -> ImageCapture.FLASH_MODE_ON
      FLASH_AUTO -> ImageCapture.FLASH_MODE_AUTO
      else -> ImageCapture.FLASH_MODE_OFF
    }
    // Metadata left at its default: the front camera's photo is not mirrored,
    // so text in documents reads correctly (the preview itself is mirrored).
    val options = ImageCapture.OutputFileOptions.Builder(file).build()
    imageCapture.takePicture(options, fileExecutor, object : ImageCapture.OnImageSavedCallback {
      override fun onImageSaved(output: ImageCapture.OutputFileResults) {
        // Still on fileExecutor: the screen-sized copy is decoded and written here, off the main thread.
        var displayCopy: File? = null
        val result = try {
          val photo = DocumentKitFiles.describe(file, PHOTO_MIME_TYPE)
          displayCopy = DocumentKitPhotoEditor.writeDisplayCopy(context, file, screenEdge())
          photo.putString("previewUri", Uri.fromFile(displayCopy).toString())
          Result.success(photo)
        } catch (error: Exception) {
          Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_STORAGE, "Cannot read the saved photo", error))
        }
        mainHandler.post {
          isCapturing = false
          if (isReleased) {
            // The camera closed while the photo was being written; nobody will use it.
            file.delete()
            displayCopy?.delete()
            callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_CANCELLED, "The camera closed")))
            return@post
          }
          // On success the frame stays frozen until the review shows or resumePreview.
          result.onFailure { unfreezeFrame() }
          callback(result)
        }
      }

      override fun onError(error: ImageCaptureException) {
        file.delete()
        mainHandler.post {
          isCapturing = false
          unfreezeFrame()
          callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_CAPTURE, error.message ?: "Capture failed", error)))
        }
      }
    })
  }

  /** Unfreezes the preview after a photo, to take another. */
  fun resumePreview() {
    unfreezeFrame()
  }

  // endregion

  // region Video

  /**
   * Records MP4 (H.264) into the DocumentKit cache. `callback` runs once, when the
   * recording ends: stopRecording, the duration limit or an interruption keep
   * the file; cancelRecording deletes it. Main thread.
   */
  fun startRecording(isAudioEnabled: Boolean, maxDurationSeconds: Int, callback: (Result<WritableMap>) -> Unit) {
    if (isCapturing || recording != null) {
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_BUSY, "The camera is already capturing")))
      return
    }
    if (!isRunning() || videoCapture !in boundUseCases) {
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_NOT_READY, "The video camera is not running")))
      return
    }
    val file = try {
      // The file must exist: this CameraX checks free space with StatFs on the
      // output path itself, which fails for a missing file and silently stalls
      // the recording (frames pile up in the encoder, nothing is written).
      DocumentKitFiles.createCaptureFile(context, VIDEO_PREFIX, VIDEO_EXTENSION).apply { createNewFile() }
    } catch (error: IOException) {
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_STORAGE, "Cannot create the video file", error)))
      return
    }

    val output = FileOutputOptions.Builder(file).apply {
      if (maxDurationSeconds > 0) {
        setDurationLimitMillis(maxDurationSeconds * 1000L)
      }
    }.build()
    var pending = videoCapture.output.prepareRecording(context, output)
    if (isAudioEnabled && hasMicrophonePermission()) {
      pending = withAudio(pending)
    }
    recordingFile = file
    recordingCallback = callback
    isRecordingCancelled = false
    lastProgressSecond = -1L
    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    recording = pending.start(ContextCompat.getMainExecutor(context), ::onRecordEvent)
  }

  fun stopRecording() {
    recording?.stop()
  }

  fun pauseRecording() {
    recording?.pause()
  }

  fun resumeRecording() {
    recording?.resume()
  }

  fun cancelRecording() {
    if (recording != null) {
      isRecordingCancelled = true
      recording?.stop()
    }
  }

  // Checked by the caller right before.
  @SuppressLint("MissingPermission")
  private fun withAudio(pending: PendingRecording) = pending.withAudioEnabled()

  private fun hasMicrophonePermission(): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  private fun onRecordEvent(event: VideoRecordEvent) {
    when (event) {
      is VideoRecordEvent.Status -> {
        val stats = event.recordingStats
        val second = TimeUnit.NANOSECONDS.toSeconds(stats.recordedDurationNanos)
        if (second != lastProgressSecond) {
          lastProgressSecond = second
          listener?.onRecordingProgress(stats.recordedDurationNanos / 1e9, stats.numBytesRecorded.toDouble())
        }
      }
      is VideoRecordEvent.Finalize -> finishRecording(event)
    }
  }

  private fun finishRecording(event: VideoRecordEvent.Finalize) {
    val file = recordingFile
    val callback = recordingCallback
    recording = null
    recordingFile = null
    recordingCallback = null
    videoCapture.targetRotation = imageCapture.targetRotation
    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    if (file == null || callback == null) {
      return
    }
    if (isRecordingCancelled) {
      file.delete()
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_CANCELLED, "Recording cancelled")))
      return
    }
    // These end the recording early but keep a playable file up to that point.
    val isKept = !event.hasError() || event.error in KEPT_RECORDING_ERRORS
    if (!isKept || file.length() == 0L) {
      file.delete()
      callback(Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_CAPTURE, "Recording failed (${event.error})", event.cause)))
      return
    }
    fileExecutor.execute {
      val result = try {
        val video = DocumentKitFiles.describe(file, VIDEO_MIME_TYPE)
        video.putString("posterUri", Uri.fromFile(writeVideoPoster(file)).toString())
        Result.success(video)
      } catch (error: Exception) {
        Result.failure(DocumentKitCameraException(DocumentKitCameraException.E_STORAGE, "Cannot read the recording", error))
      }
      mainHandler.post { callback(result) }
    }
  }

  // endregion

  fun setZoom(ratio: Float) {
    val currentCamera = camera ?: return
    val zoom = currentCamera.cameraInfo.zoomState.value ?: return
    currentCamera.cameraControl.setZoomRatio(ratio.coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    unfreezeFrame()
    ViewCompat.requestApplyInsets(this)
    updateCamera()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    updateCamera()
  }

  override fun onHostResume() {
    isHostResumed = true
    updateCamera()
  }

  override fun onHostPause() {
    isHostResumed = false
    updateCamera()
  }

  override fun onHostDestroy() {
    release()
  }

  // Overlaid React Native views (buttons, bars) take their own touches first.
  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (isZoomEnabled) {
      scaleDetector.onTouchEvent(event)
    }
    if (!scaleDetector.isInProgress) {
      tapDetector.onTouchEvent(event)
    }
    return true
  }

  override fun performClick(): Boolean = super.performClick()

  // React Native only lays out views it created. PreviewView adds its
  // TextureView after the stream starts, so lay out native children here.
  override fun requestLayout() {
    super.requestLayout()
    if (!isLayoutPending) {
      isLayoutPending = true
      post {
        isLayoutPending = false
        measure(
          MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
        )
        layout(left, top, right, bottom)
      }
    }
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    ViewCompat.getRootWindowInsets(this)?.let(::reportSafeArea)
    reportOrientation()
  }

  /**
   * Tells JS how far to turn its icons: the phone's turn relative to the screen,
   * so 0 whenever the screen turned with it (tablets, apps that allow landscape).
   * PreviewView already follows the screen on its own.
   */
  private fun reportOrientation() {
    val screenDegrees = when (display?.rotation) {
      Surface.ROTATION_90 -> 270
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 90
      else -> 0
    }
    val degrees = (orientationDegrees - screenDegrees + 360) % 360
    val currentListener = listener ?: return
    if (degrees != reportedDegrees) {
      reportedDegrees = degrees
      currentListener.onOrientationChanged(degrees)
    }
  }

  private fun isRunning(): Boolean =
    camera != null && lifecycleRegistry.currentState == Lifecycle.State.RESUMED

  private fun updateCamera() {
    if (lifecycleRegistry.currentState == Lifecycle.State.DESTROYED) {
      return
    }
    val shouldRun = isAttachedToWindow && isActive && isHostResumed
    // CameraX opens the camera when this owner resumes and closes it when it drops back.
    lifecycleRegistry.currentState = if (shouldRun) Lifecycle.State.RESUMED else Lifecycle.State.CREATED
    if (shouldRun) {
      orientationListener.enable()
      bindCamera()
    } else {
      removeCallbacks(previewWatchdog)
      orientationListener.disable()
    }
  }

  private fun bindCamera() {
    val provider = cameraProvider
    if (provider == null) {
      loadCameraProvider()
      return
    }
    val key = "$position/$mode"
    if (boundKey == key) {
      return
    }
    val selector = if (position == POSITION_FRONT) {
      CameraSelector.DEFAULT_FRONT_CAMERA
    } else {
      CameraSelector.DEFAULT_BACK_CAMERA
    }
    // Only the current mode's output. Binding photo and video together made
    // switching instant but failed on some cameras (the session timed out
    // waiting for the video encoder), and slowed every photo-only open.
    val useCases = if (mode == MODE_VIDEO) listOf(preview, videoCapture) else listOf(preview, imageCapture)
    try {
      if (!provider.hasCamera(selector)) {
        listener?.onCameraError(ERROR_NO_DEVICE, "No $position camera on this device")
        return
      }
      camera?.cameraInfo?.let {
        it.zoomState.removeObservers(this)
        it.cameraState.removeObservers(this)
      }
      provider.unbind(*boundUseCases.toTypedArray())
      boundUseCases = emptyList()
      unfreezeFrame()
      preview.setSurfaceProvider(previewView.surfaceProvider)
      val boundCamera = provider.bindToLifecycle(this, selector, *useCases.toTypedArray())
      camera = boundCamera
      boundUseCases = useCases
      boundKey = key
      lastZoom = Float.NaN
      removeCallbacks(previewWatchdog)
      postDelayed(previewWatchdog, PREVIEW_START_TIMEOUT_MS)
      boundCamera.cameraControl.enableTorch(isTorchOn)
      boundCamera.cameraInfo.zoomState.observe(this) { zoom ->
        // Every pinch frame changes the zoom; the label only needs a tenth.
        if (lastZoom.isNaN() || abs(zoom.zoomRatio - lastZoom) >= ZOOM_REPORT_STEP) {
          lastZoom = zoom.zoomRatio
          listener?.onZoomChanged(zoom.zoomRatio, zoom.minZoomRatio, zoom.maxZoomRatio)
        }
      }
      boundCamera.cameraInfo.cameraState.observe(this) { state ->
        // Recoverable errors (camera briefly in use elsewhere) CameraX retries on its own;
        // JS shows that the camera is paused meanwhile.
        val error = state.error
        val nowInterrupted = error?.type == CameraState.ErrorType.RECOVERABLE
        if (nowInterrupted != isInterrupted) {
          isInterrupted = nowInterrupted
          val reason = when (error?.code) {
            null -> ""
            CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE -> INTERRUPTION_IN_USE
            else -> INTERRUPTION_OTHER
          }
          listener?.onInterruption(nowInterrupted, reason)
        }
        if (error != null && error.type == CameraState.ErrorType.CRITICAL) {
          removeCallbacks(previewWatchdog)
          listener?.onCameraError(ERROR_SESSION_FAILED, "Camera error ${error.code}")
        }
      }
    } catch (error: Exception) {
      listener?.onCameraError(ERROR_SESSION_FAILED, error.message ?: error.javaClass.simpleName)
    }
  }

  // Usually instant: DocumentKitCameraModule.prewarm has already started CameraX.
  private fun loadCameraProvider() {
    if (isLoadingProvider) {
      return
    }
    isLoadingProvider = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      isLoadingProvider = false
      try {
        cameraProvider = future.get()
        updateCamera()
      } catch (error: Exception) {
        listener?.onCameraError(ERROR_SESSION_FAILED, error.message ?: error.javaClass.simpleName)
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun focusAt(x: Float, y: Float) {
    val currentCamera = camera ?: return
    val point = previewView.meteringPointFactory.createPoint(x, y)
    val action = FocusMeteringAction.Builder(point)
      .setAutoCancelDuration(FOCUS_RESET_SECONDS, TimeUnit.SECONDS)
      .build()
    currentCamera.cameraControl.startFocusAndMetering(action)
  }

  /** Reports how much of this view the system bars and cutouts cover, in dp. */
  private fun reportSafeArea(insets: WindowInsetsCompat) {
    if (!isAttachedToWindow) {
      return
    }
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    // The Modal may or may not draw under the bars, so count only the part that overlaps this view.
    val location = IntArray(2)
    getLocationOnScreen(location)
    val screen = resources.displayMetrics
    val density = screen.density
    val top = max(0, bars.top - location[1])
    val left = max(0, bars.left - location[0])
    val bottom = max(0, location[1] + height - (screen.heightPixels - bars.bottom))
    val right = max(0, location[0] + width - (screen.widthPixels - bars.right))
    listener?.onSafeAreaInsets(
      (top / density).toDouble(),
      (right / density).toDouble(),
      (bottom / density).toDouble(),
      (left / density).toDouble(),
    )
  }

  /** Cosmetic: when there is no frame to show, the shot simply goes ahead without the freeze. */
  private fun freezeFrame() {
    if (previewView.width <= 0 || previewView.height <= 0) {
      return
    }
    val frame = try {
      previewView.bitmap
    } catch (error: RuntimeException) {
      null
    }
    if (frame != null) {
      frozenFrame.setImageBitmap(frame)
      frozenFrame.visibility = VISIBLE
    }
  }

  private fun unfreezeFrame() {
    frozenFrame.visibility = GONE
    frozenFrame.setImageDrawable(null)
  }

  private fun screenEdge(): Int {
    val metrics = resources.displayMetrics
    return max(metrics.widthPixels, metrics.heightPixels)
  }

  /** First frame at about screen size, already upright. File executor only. */
  @Throws(IOException::class)
  private fun writeVideoPoster(video: File): File {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(video.path)
      val edge = screenEdge()
      val frame = retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)
        ?: throw IOException("No frame in ${video.name}")
      try {
        return DocumentKitPhotoEditor.writeJpeg(context, frame, VIDEO_POSTER_PREFIX)
      } finally {
        frame.recycle()
      }
    } finally {
      retriever.release()
    }
  }

  companion object {
    const val POSITION_BACK = "back"
    const val POSITION_FRONT = "front"
    const val MODE_PHOTO = "photo"
    const val MODE_VIDEO = "video"
    const val QUALITY_MEDIUM = "medium"
    const val ERROR_NO_DEVICE = "no_device"
    const val ERROR_SESSION_FAILED = "session_failed"
    private const val INTERRUPTION_IN_USE = "in_use"
    private const val INTERRUPTION_OTHER = "other"

    private const val QUALITY_HIGH = "high"
    private const val QUALITY_LOW = "low"
    private const val FLASH_ON = "on"
    private const val FLASH_AUTO = "auto"
    private const val PHOTO_PREFIX = "Image"
    private const val VIDEO_PREFIX = "Video"
    private const val VIDEO_POSTER_PREFIX = "VideoPoster"
    private const val PHOTO_EXTENSION = "jpg"
    private const val VIDEO_EXTENSION = "mp4"
    private const val PHOTO_MIME_TYPE = "image/jpeg"
    private const val VIDEO_MIME_TYPE = "video/mp4"
    private const val FOCUS_RESET_SECONDS = 3L
    private const val ZOOM_REPORT_STEP = 0.05f
    // Well above a slow device's start-up (2–3 s), below the user giving up.
    private const val PREVIEW_START_TIMEOUT_MS = 10_000L
    private const val SWIPE_MIN_VELOCITY_DP = 600
    private const val SWIPE_LEFT = "left"
    private const val SWIPE_RIGHT = "right"

    // Shared by every camera view and never shut down: CameraX hands a finished
    // photo to it even after the view is released, and a shut-down executor
    // would throw on CameraX's main-thread callback.
    private val fileExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private val KEPT_RECORDING_ERRORS = setOf(
      VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED,
      VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED,
      VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE,
      VideoRecordEvent.Finalize.ERROR_INSUFFICIENT_STORAGE,
    )

    /** 1080p / 720p / 480p tiers (src/camera/types.ts VIDEO_SETTINGS); MP4 output is H.264. */
    private fun buildVideoCapture(quality: String, bitRateKbps: Int): VideoCapture<Recorder> {
      val target = when (quality) {
        QUALITY_HIGH -> Quality.FHD
        QUALITY_LOW -> Quality.SD
        else -> Quality.HD
      }
      val recorder = Recorder.Builder()
        .setQualitySelector(QualitySelector.from(target, FallbackStrategy.lowerQualityOrHigherThan(target)))
        .apply {
          if (bitRateKbps > 0) {
            setTargetVideoEncodingBitRate(bitRateKbps * 1000)
          }
        }
        .build()
      return VideoCapture.withOutput(recorder)
    }
  }
}
