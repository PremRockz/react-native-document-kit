package com.documentkit

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.io.File
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * In-app video/audio player on Media3, with DocumentKit's own controls: title
 * with length and size, back 5 s / play / forward 15 s, seek bar, speed, sound,
 * full screen and an optional Download button. Streams over HTTP with the
 * caller's headers (e.g. the session cookie), so nothing is downloaded first;
 * seeking uses range requests. Local file:// and content:// URIs play too.
 */
@OptIn(UnstableApi::class)
class DocumentKitMediaActivity : Activity() {

  private var player: ExoPlayer? = null
  private lateinit var mediaUri: Uri
  private lateinit var headers: Map<String, String>
  private lateinit var labels: Bundle
  private var accentColor = DEFAULT_ACCENT_COLOR

  private lateinit var playerView: PlayerView
  private lateinit var controls: FrameLayout
  private lateinit var errorText: TextView
  private lateinit var subtitleText: TextView
  private lateinit var centerRow: LinearLayout
  private lateinit var playButton: ImageButton
  private lateinit var bufferingSpinner: ProgressBar
  private lateinit var seekBar: SeekBar
  private lateinit var positionText: TextView
  private lateinit var remainingText: TextView
  private lateinit var speedButton: TextView
  private lateinit var soundButton: ImageButton
  private lateinit var fullScreenButton: ImageButton

  // These survive rotation: the activity handles configuration changes itself.
  private var isMuted = false
  private var skipBackMs = DEFAULT_SKIP_BACK_SECONDS * 1000L
  private var skipForwardMs = DEFAULT_SKIP_FORWARD_SECONDS * 1000L
  private var isSeeking = false
  private var isFullScreen = false
  private var orientationBeforeFullScreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
  private var speedIndex = SPEEDS.indexOfFirst { it == 1f }
  private var areControlsVisible = true
  private var sizeLabel: String? = null

  private val handler = Handler(Looper.getMainLooper())
  private val hideControlsLater = Runnable { setControlsVisible(false) }
  private val progressTick = object : Runnable {
    override fun run() {
      updateProgress()
      handler.postDelayed(this, PROGRESS_INTERVAL_MS)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val url = intent.getStringExtra(EXTRA_URL)
    if (url.isNullOrEmpty()) {
      setResult(RESULT_VIEWER_ERROR)
      finish()
      return
    }
    mediaUri = url.toUri()
    headers = readHeaders()
    labels = intent.getBundleExtra(EXTRA_LABELS) ?: Bundle()
    isMuted = intent.getBooleanExtra(EXTRA_MUTED, false)
    skipBackMs = intent.getIntExtra(EXTRA_SKIP_BACK_SECONDS, DEFAULT_SKIP_BACK_SECONDS) * 1000L
    skipForwardMs = intent.getIntExtra(EXTRA_SKIP_FORWARD_SECONDS, DEFAULT_SKIP_FORWARD_SECONDS) * 1000L
    intent.getIntExtra(EXTRA_ACCENT_COLOR, 0).takeIf { it != 0 }?.let { accentColor = it }
    sizeLabel = readLocalSize()?.let(::formatSize)

    // Video under the system bars; the controls keep clear of them with insets.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    buildLayout(title = intent.getStringExtra(EXTRA_TITLE).orEmpty())
    startPlayer(url)
  }

  override fun onStop() {
    super.onStop()
    // Stop playing when the app leaves the screen; the user resumes with play.
    player?.pause()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    player?.release()
    player = null
    super.onDestroy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ViewCompat.requestApplyInsets(controls)
  }

  private fun readHeaders(): Map<String, String> {
    val bundle = intent.getBundleExtra(EXTRA_HEADERS) ?: return emptyMap()
    return bundle.keySet().mapNotNull { key -> bundle.getString(key)?.let { key to it } }.toMap()
  }

  /** A label, with "{seconds}" (the skip buttons) filled in. */
  private fun label(key: String, seconds: Long = 0): String =
    labels.getString(key).orEmpty().replace("{seconds}", seconds.toString())

  // region Layout

  private fun buildLayout(title: String) {
    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.BLACK)
      // A tap on the video shows or hides the controls.
      setOnClickListener { setControlsVisible(!areControlsVisible) }
    }

    playerView = PlayerView(this).apply {
      useController = false
      resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
      isClickable = false
    }
    root.addView(playerView, matchParent())

    errorText = TextView(this).apply {
      text = label("playbackError")
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      visibility = View.GONE
      val padding = dp(24)
      setPadding(padding, padding, padding, padding)
    }
    root.addView(errorText, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.CENTER))

    controls = FrameLayout(this)
    controls.addView(buildTopBar(title), FrameLayout.LayoutParams(MATCH, WRAP, Gravity.TOP))
    controls.addView(buildCenterRow(), FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))
    controls.addView(buildBottomBar(), FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM))
    root.addView(controls, matchParent())
    applyInsets()

    setContentView(root)
    updateSoundButton()
    updateFullScreenButton()
    updateSpeedButton()
  }

  private fun buildTopBar(title: String): View {
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = scrim(GradientDrawable.Orientation.TOP_BOTTOM)
      setPadding(dp(4), dp(8), dp(8), dp(24))
    }
    bar.addView(iconButton(R.drawable.documentkit_ic_player_close, label("close")) { finish() }, square(48))

    val titles = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(4), 0, dp(8), 0)
    }
    titles.addView(TextView(this).apply {
      text = title
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      typeface = Typeface.DEFAULT_BOLD
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
    })
    subtitleText = TextView(this).apply {
      setTextColor(SECONDARY_TEXT_COLOR)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      maxLines = 1
      text = sizeLabel.orEmpty()
      visibility = if (sizeLabel == null) View.GONE else View.VISIBLE
    }
    titles.addView(subtitleText)
    bar.addView(titles, LinearLayout.LayoutParams(0, WRAP, 1f))

    DocumentKitViewerSave.from(intent)?.let { save ->
      bar.addView(iconButton(R.drawable.documentkit_ic_player_download, save.saveLabel) { button ->
        save.run(this, mediaUri, intent.getStringExtra(EXTRA_MIME_TYPE).orEmpty(), button, headers)
      }, square(48))
    }
    return bar
  }

  private fun buildCenterRow(): View {
    centerRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    if (skipBackMs > 0) {
      val seconds = skipBackMs / 1000
      centerRow.addView(
        seekButton(R.drawable.documentkit_ic_player_back, seconds.toString(), label("seekBack", seconds)) { seekBy(-skipBackMs) },
        square(52),
      )
    } else {
      // Keeps play centred.
      centerRow.addView(View(this), square(52))
    }

    val playSlot = FrameLayout(this)
    playButton = ImageButton(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.WHITE)
      }
      scaleType = android.widget.ImageView.ScaleType.CENTER
      setOnClickListener { togglePlay() }
    }
    playSlot.addView(playButton, matchParent())
    bufferingSpinner = ProgressBar(this).apply {
      indeterminateTintList = ColorStateList.valueOf(Color.WHITE)
      visibility = View.GONE
    }
    playSlot.addView(bufferingSpinner, FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER))
    centerRow.addView(playSlot, LinearLayout.LayoutParams(dp(64), dp(64)).apply {
      marginStart = dp(36)
      marginEnd = dp(36)
    })

    if (skipForwardMs > 0) {
      val seconds = skipForwardMs / 1000
      centerRow.addView(
        seekButton(R.drawable.documentkit_ic_player_forward, seconds.toString(), label("seekForward", seconds)) { seekBy(skipForwardMs) },
        square(52),
      )
    } else {
      centerRow.addView(View(this), square(52))
    }
    return centerRow
  }

  private fun buildBottomBar(): View {
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = scrim(GradientDrawable.Orientation.BOTTOM_TOP)
      setPadding(dp(16), dp(32), dp(16), dp(8))
    }

    val times = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    positionText = timeText()
    remainingText = timeText().apply { gravity = Gravity.END }
    times.addView(positionText, LinearLayout.LayoutParams(0, WRAP, 1f))
    times.addView(remainingText, LinearLayout.LayoutParams(0, WRAP, 1f))
    bar.addView(times)

    seekBar = SeekBar(this).apply {
      progressTintList = ColorStateList.valueOf(accentColor)
      progressBackgroundTintList = ColorStateList.valueOf(TRACK_COLOR)
      secondaryProgressTintList = ColorStateList.valueOf(BUFFERED_COLOR)
      thumbTintList = ColorStateList.valueOf(Color.WHITE)
      // The bar lines up with the time labels above it.
      setPadding(0, dp(12), 0, dp(12))
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
          if (fromUser) {
            showTimes(progress.toLong(), player?.duration ?: 0L)
          }
        }

        override fun onStartTrackingTouch(bar: SeekBar) {
          isSeeking = true
          handler.removeCallbacks(hideControlsLater)
        }

        override fun onStopTrackingTouch(bar: SeekBar) {
          isSeeking = false
          player?.seekTo(bar.progress.toLong())
          scheduleHide()
        }
      })
    }
    bar.addView(seekBar, LinearLayout.LayoutParams(MATCH, WRAP))

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    speedButton = TextView(this).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      gravity = Gravity.CENTER
      minWidth = dp(44)
      setPadding(dp(10), dp(5), dp(10), dp(5))
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setStroke(dp(1), PILL_BORDER_COLOR)
      }
      setOnClickListener { cycleSpeed() }
      visibility = if (intent.getBooleanExtra(EXTRA_ALLOW_SPEED, true)) View.VISIBLE else View.GONE
    }
    actions.addView(speedButton, LinearLayout.LayoutParams(WRAP, WRAP))
    actions.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
    soundButton = iconButton(R.drawable.documentkit_ic_volume, "") { setMuted(!isMuted) }
    actions.addView(soundButton, square(48))
    fullScreenButton = iconButton(R.drawable.documentkit_ic_player_fullscreen, "") { setFullScreen(!isFullScreen) }
    fullScreenButton.visibility = if (intent.getBooleanExtra(EXTRA_ALLOW_FULL_SCREEN, true)) View.VISIBLE else View.GONE
    actions.addView(fullScreenButton, square(48))
    bar.addView(actions, LinearLayout.LayoutParams(MATCH, WRAP))
    return bar
  }

  /** Keeps the bars clear of the status bar, navigation bar and cutouts, in both orientations. */
  private fun applyInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(controls) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
  }

  private fun iconButton(icon: Int, description: String, onClick: (View) -> Unit) = ImageButton(this).apply {
    setImageResource(icon)
    background = null
    contentDescription = description
    setOnClickListener { view ->
      onClick(view)
      scheduleHide()
    }
  }

  /** Round button with a circular arrow and the seconds it skips written inside. */
  private fun seekButton(icon: Int, seconds: String, description: String, onClick: () -> Unit): View =
    FrameLayout(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ROUND_BUTTON_COLOR)
      }
      contentDescription = description
      isClickable = true
      setOnClickListener {
        onClick()
        scheduleHide()
      }
      addView(android.widget.ImageView(context).apply { setImageResource(icon) }, FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER))
      addView(TextView(context).apply {
        text = seconds
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f)
        typeface = Typeface.DEFAULT_BOLD
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      }, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))
    }

  private fun timeText() = TextView(this).apply {
    setTextColor(Color.WHITE)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    fontFeatureSettings = "tnum"
  }

  private fun scrim(orientation: GradientDrawable.Orientation) =
    GradientDrawable(orientation, intArrayOf(SCRIM_COLOR, Color.TRANSPARENT))

  // endregion

  // region Playback

  private fun startPlayer(url: String) {
    val httpFactory = DefaultHttpDataSource.Factory()
      .setDefaultRequestProperties(headers)
      .setAllowCrossProtocolRedirects(true)
    // Wraps the HTTP factory so file:// and content:// sources work as well.
    val dataSourceFactory = DefaultDataSource.Factory(this, httpFactory)

    val exoPlayer = ExoPlayer.Builder(this)
      .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
      .build()
    exoPlayer.addListener(object : Player.Listener {
      override fun onPlayerError(error: PlaybackException) {
        unauthorizedStatusOf(error)?.let { status ->
          // Not an error to show: JS refreshes the session and reopens the player here.
          setResult(
            RESULT_UNAUTHORIZED,
            Intent()
              .putExtra(EXTRA_RESULT_HTTP_STATUS, status)
              .putExtra(EXTRA_RESULT_POSITION_MS, player?.currentPosition ?: 0L),
          )
          finish()
          return
        }
        errorText.visibility = View.VISIBLE
        centerRow.visibility = View.GONE
        setControlsVisible(true)
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        updatePlayButton()
        if (isPlaying) {
          handler.removeCallbacks(progressTick)
          handler.post(progressTick)
          scheduleHide()
        } else {
          handler.removeCallbacks(progressTick)
          updateProgress()
          // Paused or ended: the controls stay until playing again.
          setControlsVisible(true)
        }
      }

      override fun onPlaybackStateChanged(state: Int) {
        updatePlayButton()
        if (state == Player.STATE_READY) {
          updateSubtitle()
          updateProgress()
        }
      }

      override fun onVideoSizeChanged(videoSize: VideoSize) {
        if (isFullScreen) {
          applyFullScreen()
        }
      }
    })
    exoPlayer.volume = if (isMuted) 0f else 1f
    exoPlayer.setPlaybackSpeed(SPEEDS[speedIndex])
    // Reopened after a session refresh: carry on where it stopped.
    exoPlayer.setMediaItem(MediaItem.fromUri(url), intent.getLongExtra(EXTRA_START_POSITION_MS, 0L))
    // Paused at the start: the controls stay up (they only hide over a playing video).
    exoPlayer.playWhenReady = intent.getBooleanExtra(EXTRA_AUTO_PLAY, true)
    exoPlayer.prepare()

    playerView.player = exoPlayer
    player = exoPlayer
    updatePlayButton()
  }

  /** 401 or 403 from the server, anywhere in the error's causes; null for other failures. */
  private fun unauthorizedStatusOf(error: PlaybackException): Int? {
    var cause: Throwable? = error
    while (cause != null) {
      if (cause is HttpDataSource.InvalidResponseCodeException) {
        return cause.responseCode.takeIf { it == 401 || it == 403 }
      }
      cause = cause.cause
    }
    return null
  }

  private fun togglePlay() {
    val currentPlayer = player ?: return
    when {
      currentPlayer.playbackState == Player.STATE_ENDED -> {
        currentPlayer.seekTo(0)
        currentPlayer.play()
      }
      currentPlayer.isPlaying -> currentPlayer.pause()
      else -> currentPlayer.play()
    }
    scheduleHide()
  }

  private fun seekBy(offsetMs: Long) {
    val currentPlayer = player ?: return
    val duration = currentPlayer.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
    currentPlayer.seekTo(min(max(0L, currentPlayer.currentPosition + offsetMs), duration))
    updateProgress()
  }

  private fun cycleSpeed() {
    speedIndex = (speedIndex + 1) % SPEEDS.size
    player?.setPlaybackSpeed(SPEEDS[speedIndex])
    updateSpeedButton()
    scheduleHide()
  }

  private fun setMuted(muted: Boolean) {
    isMuted = muted
    player?.volume = if (muted) 0f else 1f
    updateSoundButton()
  }

  // endregion

  // region Full screen

  private fun setFullScreen(fullScreen: Boolean) {
    if (fullScreen == isFullScreen) {
      return
    }
    isFullScreen = fullScreen
    if (fullScreen) {
      orientationBeforeFullScreen = requestedOrientation
    }
    applyFullScreen()
    updateFullScreenButton()
  }

  /**
   * Hides the system bars. A landscape video turns the screen to landscape; a
   * portrait one fills the screen instead, since turning would only shrink it.
   */
  private fun applyFullScreen() {
    val insetsController = WindowCompat.getInsetsController(window, window.decorView)
    if (!isFullScreen) {
      insetsController.show(WindowInsetsCompat.Type.systemBars())
      requestedOrientation = orientationBeforeFullScreen
      playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
      return
    }
    insetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    insetsController.hide(WindowInsetsCompat.Type.systemBars())
    val videoSize = player?.videoSize ?: VideoSize.UNKNOWN
    val isLandscapeVideo = videoSize.width > 0 && videoSize.width * videoSize.pixelWidthHeightRatio > videoSize.height
    if (isLandscapeVideo) {
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    } else {
      playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
    }
  }

  // endregion

  // region State to views

  private fun setControlsVisible(visible: Boolean) {
    handler.removeCallbacks(hideControlsLater)
    if (!visible && (player?.isPlaying != true || isSeeking || errorText.visibility == View.VISIBLE)) {
      // Only hide over a playing video.
      return
    }
    areControlsVisible = visible
    controls.animate().cancel()
    if (visible) {
      controls.visibility = View.VISIBLE
      controls.animate().alpha(1f).setDuration(FADE_MS).start()
      scheduleHide()
    } else {
      controls.animate().alpha(0f).setDuration(FADE_MS).withEndAction { controls.visibility = View.GONE }.start()
    }
  }

  private fun scheduleHide() {
    handler.removeCallbacks(hideControlsLater)
    if (player?.isPlaying == true) {
      handler.postDelayed(hideControlsLater, HIDE_CONTROLS_MS)
    }
  }

  private fun updatePlayButton() {
    val currentPlayer = player ?: return
    val isBuffering = currentPlayer.playbackState == Player.STATE_BUFFERING && currentPlayer.playWhenReady
    bufferingSpinner.visibility = if (isBuffering) View.VISIBLE else View.GONE
    playButton.visibility = if (isBuffering) View.INVISIBLE else View.VISIBLE
    val isPlaying = currentPlayer.isPlaying
    playButton.setImageResource(if (isPlaying) R.drawable.documentkit_ic_player_pause else R.drawable.documentkit_ic_player_play)
    playButton.contentDescription = label(if (isPlaying) "pause" else "play")
  }

  private fun updateProgress() {
    val currentPlayer = player ?: return
    val duration = currentPlayer.duration.takeIf { it > 0 } ?: 0L
    seekBar.max = min(duration, Int.MAX_VALUE.toLong()).toInt()
    seekBar.secondaryProgress = min(currentPlayer.bufferedPosition, duration).toInt()
    if (!isSeeking) {
      seekBar.progress = min(currentPlayer.currentPosition, duration).toInt()
      showTimes(currentPlayer.currentPosition, duration)
    }
  }

  private fun showTimes(positionMs: Long, durationMs: Long) {
    positionText.text = formatTime(positionMs)
    remainingText.text = if (durationMs > 0) "-${formatTime(max(0L, durationMs - positionMs))}" else ""
  }

  /** "00:18 · 4.2 MB": the length once known, and the size for local files. */
  private fun updateSubtitle() {
    val duration = player?.duration?.takeIf { it > 0 }
    val parts = listOfNotNull(duration?.let(::formatTime), sizeLabel)
    subtitleText.text = parts.joinToString(" · ")
    subtitleText.visibility = if (parts.isEmpty()) View.GONE else View.VISIBLE
  }

  private fun updateSoundButton() {
    soundButton.setImageResource(if (isMuted) R.drawable.documentkit_ic_volume_off else R.drawable.documentkit_ic_volume)
    // Names the action the button takes.
    soundButton.contentDescription = label(if (isMuted) "unmute" else "mute")
  }

  private fun updateFullScreenButton() {
    fullScreenButton.setImageResource(
      if (isFullScreen) R.drawable.documentkit_ic_player_exit_fullscreen else R.drawable.documentkit_ic_player_fullscreen,
    )
    fullScreenButton.contentDescription = label(if (isFullScreen) "exitFullScreen" else "fullScreen")
  }

  private fun updateSpeedButton() {
    val speed = formatSpeed(SPEEDS[speedIndex])
    speedButton.text = speed
    speedButton.contentDescription = "${label("playbackSpeed")}, $speed"
  }

  // endregion

  // region Helpers

  /** Size of a local file:// or content:// source; null for streams. */
  private fun readLocalSize(): Long? = try {
    when (mediaUri.scheme) {
      "file" -> mediaUri.path?.let(::File)?.length()?.takeIf { it > 0 }
      "content" -> contentResolver.query(mediaUri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0).takeIf { it > 0 } else null
      }
      else -> null
    }
  } catch (_: Exception) {
    // The size is a nicety; the video plays without it.
    null
  }

  private fun dp(value: Int): Int = DocumentKitViewerChrome.dp(this, value)

  private fun square(size: Int) = LinearLayout.LayoutParams(dp(size), dp(size))

  private fun matchParent() = FrameLayout.LayoutParams(MATCH, MATCH)

  // endregion

  companion object {
    const val EXTRA_URL = "documentkit.url"
    const val EXTRA_HEADERS = "documentkit.headers"
    const val EXTRA_TITLE = "documentkit.title"
    const val EXTRA_LABELS = "documentkit.labels"
    const val EXTRA_MUTED = "documentkit.muted"
    const val EXTRA_ACCENT_COLOR = "documentkit.accentColor"
    const val EXTRA_MIME_TYPE = "documentkit.mimeType"
    const val EXTRA_START_POSITION_MS = "documentkit.startPositionMs"
    const val EXTRA_AUTO_PLAY = "documentkit.autoPlay"
    const val EXTRA_SKIP_BACK_SECONDS = "documentkit.skipBackSeconds"
    const val EXTRA_SKIP_FORWARD_SECONDS = "documentkit.skipForwardSeconds"
    const val EXTRA_ALLOW_SPEED = "documentkit.allowSpeed"
    const val EXTRA_ALLOW_FULL_SCREEN = "documentkit.allowFullScreen"
    const val EXTRA_RESULT_HTTP_STATUS = "documentkit.httpStatus"
    const val EXTRA_RESULT_POSITION_MS = "documentkit.positionMs"
    const val RESULT_VIEWER_ERROR = RESULT_FIRST_USER
    /** The server answered 401/403; the result Intent carries the status and position. */
    const val RESULT_UNAUTHORIZED = RESULT_FIRST_USER + 1

    private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    private const val DEFAULT_SKIP_BACK_SECONDS = 5
    private const val DEFAULT_SKIP_FORWARD_SECONDS = 15
    private const val HIDE_CONTROLS_MS = 3_000L
    private const val PROGRESS_INTERVAL_MS = 250L
    private const val FADE_MS = 200L
    private val SPEEDS = floatArrayOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)
    // DocumentKit's default primaryColor, when the caller passes no theme.
    private const val DEFAULT_ACCENT_COLOR = 0xFF1C6FE2.toInt()
    private const val SECONDARY_TEXT_COLOR = 0xB3FFFFFF.toInt()
    private const val TRACK_COLOR = 0x4DFFFFFF
    private const val BUFFERED_COLOR = 0x80FFFFFF.toInt()
    private const val PILL_BORDER_COLOR = 0x99FFFFFF.toInt()
    private const val ROUND_BUTTON_COLOR = 0x66000000
    private const val SCRIM_COLOR = 0x99000000.toInt()

    /** "00:18", or "1:02:03" past an hour. */
    fun formatTime(ms: Long): String {
      val totalSeconds = max(0L, ms / 1000)
      val hours = totalSeconds / 3600
      val minutes = (totalSeconds % 3600) / 60
      val seconds = totalSeconds % 60
      return if (hours > 0) {
        String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
      } else {
        String.format(Locale.US, "%02d:%02d", minutes, seconds)
      }
    }

    /** "4.2 MB", "740 KB", like the camera's review screen. */
    fun formatSize(bytes: Long): String =
      if (bytes >= 1024 * 1024) {
        val megabytes = bytes / (1024.0 * 1024.0)
        if (megabytes >= 10) "${Math.round(megabytes)} MB" else String.format(Locale.US, "%.1f MB", megabytes)
      } else {
        "${max(1L, bytes / 1024)} KB"
      }

    /** "1x", "1.25x", "0.5x". */
    fun formatSpeed(speed: Float): String =
      "${if (speed % 1f == 0f) speed.toInt().toString() else speed.toString().trimEnd('0')}x"
  }
}
