package com.documentkit

import android.app.Activity
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.net.toUri
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * In-app viewer for plain text and CSV.
 * - Text: wrapped lines, rendered line by line so large files stay smooth; long-press selects.
 * - CSV: a table with the header row fixed at the top, columns sized from the data,
 *   sideways scroll for wide sheets.
 */
class DocumentKitTextActivity : Activity() {

  private val readThread: ExecutorService = Executors.newSingleThreadExecutor()
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
    val mimeType = intent.getStringExtra(EXTRA_MIME_TYPE).orEmpty()
    val save = DocumentKitViewerSave.from(intent)

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(SURFACE_COLOR)
    }
    val topBar = DocumentKitViewerChrome.createTopBar(
      this,
      intent.getStringExtra(EXTRA_TITLE).orEmpty(),
      intent.getStringExtra(EXTRA_CLOSE_LABEL).orEmpty(),
      saveLabel = save?.saveLabel.orEmpty(),
      onSave = save?.let { action -> { button -> action.run(this, uri, mimeType, button) } },
    )
    root.addView(topBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    notice = TextView(this).apply {
      text = intent.getStringExtra(EXTRA_TRUNCATED_LABEL).orEmpty()
      setTextColor(NOTICE_TEXT_COLOR)
      setBackgroundColor(NOTICE_BACKGROUND_COLOR)
      val padding = dp(10)
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
    load(uri, isCsv = mimeType in CSV_MIME_TYPES)
  }

  override fun onDestroy() {
    readThread.shutdownNow()
    super.onDestroy()
  }

  private fun load(uri: Uri, isCsv: Boolean) {
    readThread.execute {
      val text = try {
        DocumentKitTextFiles.read(this, uri)
      } catch (_: IOException) {
        null
      }
      val rows = if (text != null && isCsv) {
        DocumentKitTextFiles.parseCsv(text.text, DocumentKitTextFiles.detectDelimiter(text.text))
      } else {
        null
      }
      // Split here too: a 5 MB file has hundreds of thousands of lines.
      val lines = if (text != null && rows == null) text.text.lines() else null
      runOnUiThread {
        if (isFinishing) return@runOnUiThread
        if (text == null) {
          setResult(RESULT_VIEWER_ERROR)
          finish()
          return@runOnUiThread
        }
        content.removeAllViews()
        notice.visibility = if (text.isTruncated) View.VISIBLE else View.GONE
        if (rows != null) {
          showTable(rows)
        } else {
          showLines(lines.orEmpty())
        }
      }
    }
  }

  private fun showLines(lines: List<String>) {
    val padding = dp(16)
    content.addView(RecyclerView(this).apply {
      layoutManager = LinearLayoutManager(this@DocumentKitTextActivity)
      clipToPadding = false
      setPadding(0, dp(8), 0, dp(24))
      adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = lines.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
          val line = TextView(parent.context).apply {
            setTextColor(TEXT_COLOR)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(padding, 0, padding, 0)
            setTextIsSelectable(true)
            layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
          }
          return object : RecyclerView.ViewHolder(line) {}
        }

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
          // An empty line still needs height, or blank lines would disappear.
          (holder.itemView as TextView).text = lines[position].ifEmpty { " " }
        }
      }
    }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun showTable(rows: List<List<String>>) {
    if (rows.isEmpty()) {
      showLines(emptyList())
      return
    }
    val columnWidths = measureColumns(rows)
    val tableWidth = columnWidths.sum()
    val header = rows.first()
    val bodyRows = rows.drop(1)

    val table = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    table.addView(
      buildRow(columnWidths, isHeader = true).also { bindRow(it, header) },
      LinearLayout.LayoutParams(tableWidth, ViewGroup.LayoutParams.WRAP_CONTENT),
    )
    table.addView(RecyclerView(this).apply {
      layoutManager = LinearLayoutManager(this@DocumentKitTextActivity)
      adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = bodyRows.size

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
          object : RecyclerView.ViewHolder(buildRow(columnWidths, isHeader = false)) {}

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
          val row = holder.itemView as LinearLayout
          bindRow(row, bodyRows[position])
          row.setBackgroundColor(if (position % 2 == 0) SURFACE_COLOR else STRIPE_COLOR)
        }
      }
    }, LinearLayout.LayoutParams(tableWidth, 0, 1f))

    content.addView(HorizontalScrollView(this).apply {
      isFillViewport = true
      addView(table, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  /** Widths from the first rows' text, between a minimum and a maximum so one long cell cannot dominate. */
  private fun measureColumns(rows: List<List<String>>): List<Int> {
    val columnCount = rows.maxOf { it.size }
    val paint = Paint().apply { textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 14f, resources.displayMetrics) }
    val sample = rows.take(COLUMN_SAMPLE_ROWS)
    val cellPadding = dp(CELL_PADDING_DP) * 2
    return (0 until columnCount).map { column ->
      val widest = sample.maxOf { row -> paint.measureText(row.getOrNull(column).orEmpty()) }
      (widest.toInt() + cellPadding).coerceIn(dp(MIN_COLUMN_DP), dp(MAX_COLUMN_DP))
    }
  }

  private fun buildRow(columnWidths: List<Int>, isHeader: Boolean): LinearLayout {
    val padding = dp(CELL_PADDING_DP)
    return LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      if (isHeader) {
        setBackgroundColor(HEADER_COLOR)
      }
      columnWidths.forEach { width ->
        addView(TextView(this@DocumentKitTextActivity).apply {
          setTextColor(TEXT_COLOR)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
          setPadding(padding, padding, padding, padding)
          maxLines = CELL_MAX_LINES
          ellipsize = TextUtils.TruncateAt.END
          if (isHeader) {
            setTypeface(typeface, Typeface.BOLD)
          }
        }, LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT))
      }
    }
  }

  private fun bindRow(row: LinearLayout, cells: List<String>) {
    for (column in 0 until row.childCount) {
      (row.getChildAt(column) as TextView).text = cells.getOrNull(column).orEmpty()
    }
  }

  private fun dp(value: Int): Int = DocumentKitViewerChrome.dp(this, value)

  companion object {
    const val EXTRA_URI = "documentkit.uri"
    const val EXTRA_TITLE = "documentkit.title"
    const val EXTRA_MIME_TYPE = "documentkit.mimeType"
    const val EXTRA_CLOSE_LABEL = "documentkit.closeLabel"
    const val EXTRA_TRUNCATED_LABEL = "documentkit.truncatedLabel"
    const val RESULT_VIEWER_ERROR = RESULT_FIRST_USER

    val CSV_MIME_TYPES = setOf("text/csv", "text/comma-separated-values", "application/csv", "text/tab-separated-values")

    private const val COLUMN_SAMPLE_ROWS = 200
    private const val CELL_PADDING_DP = 8
    private const val MIN_COLUMN_DP = 64
    private const val MAX_COLUMN_DP = 280
    private const val CELL_MAX_LINES = 3
    private const val SURFACE_COLOR = Color.WHITE
    private const val STRIPE_COLOR = 0xFFF5F6F8.toInt()
    private const val HEADER_COLOR = 0xFFE6E9EF.toInt()
    private const val TEXT_COLOR = 0xFF1F2937.toInt()
    private const val NOTICE_TEXT_COLOR = 0xFF7A4B00.toInt()
    private const val NOTICE_BACKGROUND_COLOR = 0xFFFFF4D6.toInt()
  }
}
