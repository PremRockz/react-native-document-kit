package com.documentkit

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.net.toUri
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * In-app viewer for HTML files, locked down because the file comes from a user:
 * no JavaScript, no network loads, no file or content access, and links never
 * navigate inside the viewer (http/https links open the browser when tapped).
 * Pages that rely on scripts or online images show their static content only.
 */
class DocumentKitHtmlActivity : Activity() {

  private val readThread: ExecutorService = Executors.newSingleThreadExecutor()
  private var webView: WebView? = null
  private lateinit var content: FrameLayout
  private lateinit var notice: TextView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val uri = intent.getStringExtra(EXTRA_URI)?.toUri()
    if (uri == null) {
      setResult(RESULT_VIEWER_ERROR)
      finish()
      return
    }
    val save = DocumentKitViewerSave.from(intent)

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.WHITE)
    }
    val topBar = DocumentKitViewerChrome.createTopBar(
      this,
      intent.getStringExtra(EXTRA_TITLE).orEmpty(),
      intent.getStringExtra(EXTRA_CLOSE_LABEL).orEmpty(),
      saveLabel = save?.saveLabel.orEmpty(),
      onSave = save?.let { action -> { button -> action.run(this, uri, HTML_MIME_TYPE, button) } },
    )
    root.addView(topBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    notice = TextView(this).apply {
      text = intent.getStringExtra(EXTRA_TRUNCATED_LABEL).orEmpty()
      setTextColor(NOTICE_TEXT_COLOR)
      setBackgroundColor(NOTICE_BACKGROUND_COLOR)
      val padding = DocumentKitViewerChrome.dp(this@DocumentKitHtmlActivity, 10)
      setPadding(padding * 2, padding, padding * 2, padding)
      visibility = View.GONE
    }
    root.addView(notice, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    content = FrameLayout(this)
    content.addView(ProgressBar(this), FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER,
    ))
    root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

    DocumentKitViewerChrome.applySystemBarInsets(topBar, bottomView = null, content = content)
    setContentView(root)
    load(uri)
  }

  override fun onResume() {
    super.onResume()
    webView?.onResume()
  }

  override fun onPause() {
    webView?.onPause()
    super.onPause()
  }

  override fun onDestroy() {
    readThread.shutdownNow()
    webView?.destroy()
    webView = null
    super.onDestroy()
  }

  private fun load(uri: Uri) {
    readThread.execute {
      val html = try {
        DocumentKitTextFiles.read(this, uri)
      } catch (_: IOException) {
        null
      }
      runOnUiThread {
        if (isFinishing) return@runOnUiThread
        if (html == null) {
          setResult(RESULT_VIEWER_ERROR)
          finish()
          return@runOnUiThread
        }
        notice.visibility = if (html.isTruncated) View.VISIBLE else View.GONE
        content.removeAllViews()
        val view = createLockedDownWebView()
        content.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // No base URL: relative links and resources resolve to nothing.
        view.loadDataWithBaseURL(null, html.text, HTML_MIME_TYPE, Charsets.UTF_8.name(), null)
        webView = view
      }
    }
  }

  private fun createLockedDownWebView(): WebView = WebView(this).apply {
    settings.apply {
      javaScriptEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      blockNetworkLoads = true
      builtInZoomControls = true
      displayZoomControls = false
      loadWithOverviewMode = true
      useWideViewPort = true
    }
    webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        openInBrowser(request.url)
        // Never navigate inside the viewer.
        return true
      }
    }
  }

  private fun openInBrowser(url: Uri) {
    if (url.scheme != "http" && url.scheme != "https") {
      return
    }
    try {
      startActivity(Intent(Intent.ACTION_VIEW, url))
    } catch (_: ActivityNotFoundException) {
      // No browser installed: the tap simply does nothing.
      return
    }
  }

  companion object {
    const val EXTRA_URI = "documentkit.uri"
    const val EXTRA_TITLE = "documentkit.title"
    const val EXTRA_CLOSE_LABEL = "documentkit.closeLabel"
    const val EXTRA_TRUNCATED_LABEL = "documentkit.truncatedLabel"
    const val RESULT_VIEWER_ERROR = RESULT_FIRST_USER

    const val HTML_MIME_TYPE = "text/html"
    private const val NOTICE_TEXT_COLOR = 0xFF7A4B00.toInt()
    private const val NOTICE_BACKGROUND_COLOR = 0xFFFFF4D6.toInt()
  }
}
