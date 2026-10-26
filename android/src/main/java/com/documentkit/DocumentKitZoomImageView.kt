package com.documentkit

import android.content.Context
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import androidx.appcompat.widget.AppCompatImageView

/**
 * Image that starts fitted to the screen and supports pinch zoom (up to 4×),
 * double-tap zoom and panning, always kept within the image's edges.
 */
internal class DocumentKitZoomImageView(context: Context) : AppCompatImageView(context) {

  private val drawMatrix = Matrix()
  /** Zoom relative to the fitted size; 1 = whole image visible. */
  private var zoom = 1f

  private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      zoomBy(detector.scaleFactor, detector.focusX, detector.focusY)
      return true
    }
  })

  private val gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onScroll(start: MotionEvent?, current: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
      if (zoom <= 1f) {
        return false
      }
      drawMatrix.postTranslate(-distanceX, -distanceY)
      applyMatrix()
      return true
    }

    override fun onDoubleTap(event: MotionEvent): Boolean {
      if (zoom > 1.01f) {
        fitToView()
      } else {
        zoomBy(DOUBLE_TAP_ZOOM, event.x, event.y)
      }
      return true
    }
  })

  init {
    scaleType = ScaleType.MATRIX
  }

  override fun setImageDrawable(drawable: Drawable?) {
    super.setImageDrawable(drawable)
    fitToView()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    fitToView()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    scaleDetector.onTouchEvent(event)
    gestureDetector.onTouchEvent(event)
    if (event.actionMasked == MotionEvent.ACTION_UP) {
      performClick()
    }
    return true
  }

  override fun performClick(): Boolean = super.performClick()

  private fun fitToView() {
    val image = drawable ?: return
    val imageWidth = image.intrinsicWidth.toFloat()
    val imageHeight = image.intrinsicHeight.toFloat()
    if (width == 0 || height == 0 || imageWidth <= 0f || imageHeight <= 0f) {
      return
    }
    val fitScale = minOf(width / imageWidth, height / imageHeight)
    drawMatrix.reset()
    drawMatrix.postScale(fitScale, fitScale)
    drawMatrix.postTranslate((width - imageWidth * fitScale) / 2f, (height - imageHeight * fitScale) / 2f)
    zoom = 1f
    imageMatrix = drawMatrix
  }

  private fun zoomBy(factor: Float, focusX: Float, focusY: Float) {
    val targetZoom = (zoom * factor).coerceIn(1f, MAX_ZOOM)
    val applied = targetZoom / zoom
    zoom = targetZoom
    drawMatrix.postScale(applied, applied, focusX, focusY)
    applyMatrix()
  }

  /** Centres the image when it is smaller than the view, otherwise stops gaps at the edges. */
  private fun applyMatrix() {
    val image = drawable ?: return
    val bounds = RectF(0f, 0f, image.intrinsicWidth.toFloat(), image.intrinsicHeight.toFloat())
    drawMatrix.mapRect(bounds)
    val shiftX = edgeCorrection(bounds.left, bounds.right, width.toFloat())
    val shiftY = edgeCorrection(bounds.top, bounds.bottom, height.toFloat())
    drawMatrix.postTranslate(shiftX, shiftY)
    imageMatrix = drawMatrix
  }

  private fun edgeCorrection(start: Float, end: Float, viewSize: Float): Float {
    val size = end - start
    return when {
      size <= viewSize -> (viewSize - size) / 2f - start
      start > 0f -> -start
      end < viewSize -> viewSize - end
      else -> 0f
    }
  }

  private companion object {
    const val MAX_ZOOM = 4f
    const val DOUBLE_TAP_ZOOM = 2.5f
  }
}
