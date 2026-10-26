package com.documentkit

import android.app.Activity
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.core.net.toUri
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * In-app image viewer. Decodes with ImageDecoder at roughly twice the screen
 * size (so a 48 MP photo never needs a full-size bitmap), applies EXIF
 * orientation, reads HEIC/WebP, and plays animated GIF/WebP. Pinch, double-tap
 * zoom and pan come from DocumentKitZoomImageView.
 */
class DocumentKitImageActivity : Activity() {

  private val decodeThread: ExecutorService = Executors.newSingleThreadExecutor()
  private lateinit var imageView: DocumentKitZoomImageView
  private lateinit var progress: ProgressBar

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val uri = intent.getStringExtra(EXTRA_URI)?.toUri()
    if (uri == null) {
      setResult(RESULT_VIEWER_ERROR)
      finish()
      return
    }
    val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
    val mimeType = intent.getStringExtra(EXTRA_MIME_TYPE).orEmpty()
    val save = DocumentKitViewerSave.from(intent)

    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    imageView = DocumentKitZoomImageView(this)
    root.addView(imageView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    progress = ProgressBar(this)
    root.addView(progress, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER,
    ))

    val topBar = DocumentKitViewerChrome.createTopBar(
      this,
      title,
      intent.getStringExtra(EXTRA_CLOSE_LABEL).orEmpty(),
      saveLabel = save?.saveLabel.orEmpty(),
      onSave = save?.let { action -> { button -> action.run(this, uri, mimeType, button) } },
    )
    root.addView(topBar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
    DocumentKitViewerChrome.applySystemBarInsets(topBar, bottomView = null)
    setContentView(root)

    decode(uri)
  }

  override fun onDestroy() {
    decodeThread.shutdownNow()
    (imageView.drawable as? AnimatedImageDrawable)?.stop()
    super.onDestroy()
  }

  private fun decode(uri: Uri) {
    val maxSide = 2 * maxOf(resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
    decodeThread.execute {
      val drawable: Drawable? = try {
        ImageDecoder.decodeDrawable(ImageDecoder.createSource(contentResolver, uri)) { decoder, info, _ ->
          val largestSide = maxOf(info.size.width, info.size.height)
          if (largestSide > maxSide) {
            val scale = maxSide.toFloat() / largestSide
            decoder.setTargetSize(
              (info.size.width * scale).toInt().coerceAtLeast(1),
              (info.size.height * scale).toInt().coerceAtLeast(1),
            )
          }
        }
      } catch (_: IOException) {
        null
      }
      runOnUiThread {
        if (isFinishing) return@runOnUiThread
        progress.visibility = ProgressBar.GONE
        if (drawable == null) {
          setResult(RESULT_VIEWER_ERROR)
          finish()
          return@runOnUiThread
        }
        imageView.setImageDrawable(drawable)
        (drawable as? AnimatedImageDrawable)?.start()
      }
    }
  }

  companion object {
    const val EXTRA_URI = "documentkit.uri"
    const val EXTRA_TITLE = "documentkit.title"
    const val EXTRA_MIME_TYPE = "documentkit.mimeType"
    const val EXTRA_CLOSE_LABEL = "documentkit.closeLabel"
    const val RESULT_VIEWER_ERROR = RESULT_FIRST_USER
  }
}
