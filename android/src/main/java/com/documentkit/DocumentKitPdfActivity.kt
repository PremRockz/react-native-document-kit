package com.documentkit

import android.app.Activity
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.util.LruCache
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.graphics.createBitmap
import androidx.core.net.toUri
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

/**
 * In-app PDF viewer on Android's built-in PdfRenderer: continuous vertical
 * scroll, pinch and double-tap zoom, sideways scroll when zoomed, page indicator.
 * Only visible pages are rendered; zooming re-renders at the new size so text stays sharp.
 */
class DocumentKitPdfActivity : Activity() {

  private var fileDescriptor: ParcelFileDescriptor? = null
  private var renderer: PdfRenderer? = null
  // PdfRenderer allows one open page at a time, so every render runs on this thread.
  private val renderThread: ExecutorService = Executors.newSingleThreadExecutor()
  private val pageCache = object : LruCache<String, Bitmap>(cacheSizeBytes()) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
  }
  @Volatile private var isClosing = false

  /** Height / width of each page; filled once on the render thread before the list shows. */
  private var pageAspectRatios = FloatArray(0)
  private var zoom = 1f

  private lateinit var root: FrameLayout
  private lateinit var horizontalScroll: HorizontalScrollView
  private lateinit var pages: RecyclerView
  private lateinit var pageIndicator: TextView
  private lateinit var adapter: PageAdapter

  private lateinit var scaleDetector: ScaleGestureDetector
  private lateinit var doubleTapDetector: GestureDetector
  private var pendingZoom = 1f
  private var isChildTouchCancelled = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val uri = intent.getStringExtra(EXTRA_URI)?.toUri()
    if (uri == null || !openRenderer(uri)) {
      setResult(RESULT_VIEWER_ERROR)
      finish()
      return
    }
    buildLayout(
      uri = uri,
      title = intent.getStringExtra(EXTRA_TITLE).orEmpty(),
      closeLabel = intent.getStringExtra(EXTRA_CLOSE_LABEL).orEmpty(),
      save = DocumentKitViewerSave.from(intent),
    )
    setUpGestures()
    loadPageSizes()
  }

  override fun onDestroy() {
    isClosing = true
    // Close on the render thread so it never races a page that is being drawn.
    renderThread.execute {
      renderer?.close()
      fileDescriptor?.close()
    }
    renderThread.shutdown()
    pageCache.evictAll()
    super.onDestroy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    root.post { applyZoom(zoom, focusX = 0f, focusY = 0f, previousZoom = zoom) }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!::scaleDetector.isInitialized) {
      return super.dispatchTouchEvent(event)
    }
    scaleDetector.onTouchEvent(event)
    doubleTapDetector.onTouchEvent(event)

    val isPinching = scaleDetector.isInProgress || event.pointerCount > 1
    if (isPinching) {
      // Stop the list from scrolling while two fingers are zooming.
      if (!isChildTouchCancelled) {
        isChildTouchCancelled = true
        val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
        super.dispatchTouchEvent(cancel)
        cancel.recycle()
      }
      return true
    }
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      isChildTouchCancelled = false
    }
    return if (isChildTouchCancelled) true else super.dispatchTouchEvent(event)
  }

  private fun openRenderer(uri: Uri): Boolean =
    try {
      val descriptor = contentResolver.openFileDescriptor(uri, "r")
      if (descriptor == null) {
        false
      } else {
        fileDescriptor = descriptor
        renderer = PdfRenderer(descriptor)
        true
      }
    } catch (_: IOException) {
      false
    } catch (_: SecurityException) {
      // Password-protected PDFs cannot be opened by PdfRenderer.
      false
    } catch (_: RuntimeException) {
      // Malformed files can throw IllegalStateException / IllegalArgumentException.
      false
    }

  private fun buildLayout(uri: Uri, title: String, closeLabel: String, save: DocumentKitViewerSave?) {
    root = FrameLayout(this).apply { setBackgroundColor(VIEWER_BACKGROUND) }

    adapter = PageAdapter()
    pages = RecyclerView(this).apply {
      layoutManager = LinearLayoutManager(this@DocumentKitPdfActivity)
      adapter = this@DocumentKitPdfActivity.adapter
      clipToPadding = false
      addOnScrollListener(object : RecyclerView.OnScrollListener() {
        override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) = updatePageIndicator()
      })
    }
    horizontalScroll = HorizontalScrollView(this).apply {
      isFillViewport = true
      isHorizontalScrollBarEnabled = false
      addView(pages, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    root.addView(horizontalScroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

    root.addView(ProgressBar(this).apply { id = R.id.documentkit_pdf_progress }, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER,
    ))

    val topBar = DocumentKitViewerChrome.createTopBar(
      this,
      title,
      closeLabel,
      saveLabel = save?.saveLabel.orEmpty(),
      onSave = save?.let { action -> { button -> action.run(this, uri, PDF_MIME_TYPE, button) } },
    )
    root.addView(topBar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

    val pillPadding = DocumentKitViewerChrome.dp(this, 6)
    pageIndicator = TextView(this).apply {
      setTextColor(Color.WHITE)
      setPadding(pillPadding * 2, pillPadding, pillPadding * 2, pillPadding)
      background = GradientDrawable().apply {
        cornerRadius = pillPadding * 3f
        setColor(INDICATOR_BACKGROUND)
      }
    }
    root.addView(pageIndicator, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
    ).apply { bottomMargin = DocumentKitViewerChrome.dp(this@DocumentKitPdfActivity, 24) })

    // The last page scrolls clear of the navigation bar.
    DocumentKitViewerChrome.applySystemBarInsets(topBar, pageIndicator, content = pages)
    setContentView(root)
    // Keep the first page below the bar and the last page above the indicator.
    topBar.post {
      pages.setPadding(0, topBar.height, 0, DocumentKitViewerChrome.dp(this, 72))
    }
  }

  private fun setUpGestures() {
    scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
        pendingZoom = zoom
        return true
      }

      override fun onScale(detector: ScaleGestureDetector): Boolean {
        pendingZoom = (pendingZoom * detector.scaleFactor).coerceIn(MIN_ZOOM, MAX_ZOOM)
        // Live feedback only; the real re-layout happens when the fingers lift.
        horizontalScroll.pivotX = detector.focusX
        horizontalScroll.pivotY = detector.focusY
        horizontalScroll.scaleX = pendingZoom / zoom
        horizontalScroll.scaleY = pendingZoom / zoom
        return true
      }

      override fun onScaleEnd(detector: ScaleGestureDetector) {
        applyZoom(pendingZoom, detector.focusX, detector.focusY, previousZoom = zoom)
      }
    })

    doubleTapDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
      override fun onDoubleTap(event: MotionEvent): Boolean {
        val target = if (zoom > MIN_ZOOM) MIN_ZOOM else DOUBLE_TAP_ZOOM
        applyZoom(target, event.x, event.y, previousZoom = zoom)
        return true
      }
    })
  }

  private fun loadPageSizes() {
    renderThread.execute {
      val currentRenderer = renderer ?: return@execute
      val ratios = try {
        FloatArray(currentRenderer.pageCount) { index ->
          val page = currentRenderer.openPage(index)
          try {
            val ratio = page.height.toFloat() / page.width.toFloat()
            if (ratio.isFinite() && ratio > 0f) ratio else DEFAULT_PAGE_ASPECT_RATIO
          } finally {
            page.close()
          }
        }
      } catch (_: RuntimeException) {
        // A damaged file: report it like one that could not be opened.
        runOnUiThread {
          if (!isClosing) {
            setResult(RESULT_VIEWER_ERROR)
            finish()
          }
        }
        return@execute
      }
      runOnUiThread {
        if (isClosing) return@runOnUiThread
        pageAspectRatios = ratios
        adapter.notifyItemRangeInserted(0, ratios.size)
        root.findViewById<ProgressBar>(R.id.documentkit_pdf_progress)?.visibility = ProgressBar.GONE
        applyZoom(zoom, focusX = 0f, focusY = 0f, previousZoom = zoom)
        updatePageIndicator()
      }
    }
  }

  /** Lays the pages out at [targetZoom], keeping the point under the fingers in place. */
  private fun applyZoom(targetZoom: Float, focusX: Float, focusY: Float, previousZoom: Float) {
    horizontalScroll.scaleX = 1f
    horizontalScroll.scaleY = 1f
    val viewportWidth = root.width.takeIf { it > 0 } ?: return
    val newZoom = targetZoom.coerceIn(MIN_ZOOM, MAX_ZOOM)
    val ratio = newZoom / previousZoom

    val targetScrollY = ((pages.computeVerticalScrollOffset() + focusY) * ratio - focusY).toInt()
    val targetScrollX = ((horizontalScroll.scrollX + focusX) * ratio - focusX).toInt()

    zoom = newZoom
    val contentWidth = (viewportWidth * zoom).toInt()
    pages.layoutParams = pages.layoutParams.apply { width = contentWidth }
    adapter.pageWidth = contentWidth - 2 * DocumentKitViewerChrome.dp(this, PAGE_MARGIN_DP)
    // Every page changes size, so every item is re-bound and re-rendered at the new width.
    adapter.notifyItemRangeChanged(0, adapter.itemCount)

    if (abs(ratio - 1f) > 0.001f) {
      pages.post {
        pages.scrollBy(0, targetScrollY - pages.computeVerticalScrollOffset())
        horizontalScroll.scrollTo(targetScrollX.coerceAtLeast(0), 0)
      }
    }
  }

  private fun updatePageIndicator() {
    val total = pageAspectRatios.size
    if (total == 0) return
    val layoutManager = pages.layoutManager as? LinearLayoutManager ?: return
    val first = layoutManager.findFirstVisibleItemPosition().coerceAtLeast(0)
    pageIndicator.text = getString(R.string.documentkit_pdf_page_indicator, first + 1, total)
  }

  private inner class PageHolder(val image: ImageView) : RecyclerView.ViewHolder(image) {
    @Volatile var boundKey: String? = null
  }

  private inner class PageAdapter : RecyclerView.Adapter<PageHolder>() {
    var pageWidth = 0

    override fun getItemCount() = pageAspectRatios.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageHolder {
      val image = ImageView(parent.context).apply {
        setBackgroundColor(Color.WHITE)
        scaleType = ImageView.ScaleType.FIT_XY
      }
      return PageHolder(image)
    }

    override fun onBindViewHolder(holder: PageHolder, position: Int) {
      val margin = DocumentKitViewerChrome.dp(this@DocumentKitPdfActivity, PAGE_MARGIN_DP)
      val height = (pageWidth * pageAspectRatios[position]).toInt()
      holder.image.layoutParams = RecyclerView.LayoutParams(pageWidth, height).apply {
        setMargins(margin, margin, margin, margin)
      }

      val key = "$position@$pageWidth"
      holder.boundKey = key
      val cached = pageCache.get(key)
      holder.image.setImageBitmap(cached)
      if (cached == null) {
        renderPage(holder, position, key, height)
      }
    }

    override fun onViewRecycled(holder: PageHolder) {
      holder.boundKey = null
      holder.image.setImageBitmap(null)
    }
  }

  private fun renderPage(holder: PageHolder, position: Int, key: String, viewHeight: Int) {
    val pageWidth = adapter.pageWidth
    renderThread.execute {
      // Skip pages that scrolled away before their turn came.
      if (isClosing || holder.boundKey != key || pageWidth <= 0 || viewHeight <= 0) return@execute
      val currentRenderer = renderer ?: return@execute
      var renderWidth = min(pageWidth, MAX_RENDER_WIDTH_PX)
      var renderHeight = (renderWidth.toFloat() * viewHeight / pageWidth).toInt().coerceAtLeast(1)
      // Tall pages (receipts, long scans) are capped by area too; the image view scales them up.
      val pixels = renderWidth.toLong() * renderHeight
      if (pixels > MAX_RENDER_PIXELS) {
        val scale = sqrt(MAX_RENDER_PIXELS.toDouble() / pixels)
        renderWidth = (renderWidth * scale).toInt().coerceAtLeast(1)
        renderHeight = (renderHeight * scale).toInt().coerceAtLeast(1)
      }
      val bitmap = try {
        createBitmap(renderWidth, renderHeight).also { bitmap ->
          bitmap.eraseColor(Color.WHITE)
          val page = currentRenderer.openPage(position)
          try {
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          } finally {
            page.close()
          }
        }
      } catch (_: RuntimeException) {
        // A damaged page stays blank; the rest of the document still shows.
        return@execute
      } catch (_: OutOfMemoryError) {
        pageCache.evictAll()
        return@execute
      }
      pageCache.put(key, bitmap)
      runOnUiThread {
        if (holder.boundKey == key) {
          holder.image.setImageBitmap(bitmap)
        }
      }
    }
  }

  companion object {
    const val EXTRA_URI = "documentkit.uri"
    const val EXTRA_TITLE = "documentkit.title"
    const val EXTRA_CLOSE_LABEL = "documentkit.closeLabel"
    const val RESULT_VIEWER_ERROR = RESULT_FIRST_USER

    private const val PDF_MIME_TYPE = "application/pdf"
    private const val MIN_ZOOM = 1f
    private const val DOUBLE_TAP_ZOOM = 2f
    private const val MAX_ZOOM = 3f
    // Caps the bitmap size: a 2048 px wide page is about 23 MB at most.
    private const val MAX_RENDER_WIDTH_PX = 2048
    // About 24 MB per page, for pages much taller than A4.
    private const val MAX_RENDER_PIXELS = 6_000_000L
    // A4, for pages that report no size.
    private const val DEFAULT_PAGE_ASPECT_RATIO = 1.414f
    private const val PAGE_MARGIN_DP = 6
    private const val VIEWER_BACKGROUND = 0xFF2B2B2B.toInt()
    private const val INDICATOR_BACKGROUND = 0x99000000.toInt()

    private fun cacheSizeBytes(): Int = (Runtime.getRuntime().maxMemory() / 6).toInt()
  }
}
