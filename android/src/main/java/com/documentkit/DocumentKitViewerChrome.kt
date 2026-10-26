package com.documentkit

import android.app.Activity
import android.graphics.Color
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Top bar shared by DocumentKit's preview screens: close button and file name. */
internal object DocumentKitViewerChrome {
  private const val BAR_COLOR = 0xCC000000.toInt()

  /** [onSave] adds a Save button at the end; it receives the button so it can disable it while saving. */
  fun createTopBar(
    activity: Activity,
    title: String,
    closeLabel: String,
    saveLabel: String = "",
    onSave: ((View) -> Unit)? = null,
  ): LinearLayout {
    val padding = dp(activity, 8)
    return LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(BAR_COLOR)
      setPadding(padding, padding, padding * 2, padding)

      addView(ImageButton(activity).apply {
        setImageResource(R.drawable.documentkit_ic_close)
        background = null
        contentDescription = closeLabel
        setOnClickListener { activity.finish() }
      }, LinearLayout.LayoutParams(dp(activity, 48), dp(activity, 48)))

      addView(TextView(activity).apply {
        text = title
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.MIDDLE
      }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

      if (onSave != null) {
        addView(ImageButton(activity).apply {
          setImageResource(R.drawable.documentkit_ic_download)
          background = null
          contentDescription = saveLabel
          setOnClickListener { button -> onSave(button) }
        }, LinearLayout.LayoutParams(dp(activity, 48), dp(activity, 48)))
      }
    }
  }

  /**
   * Android 15+ draws apps edge-to-edge: keeps the bar below the status bar
   * and clear of side cutouts / navigation bars (landscape), [bottomView]
   * above the navigation bar, and [content] (the scrolling part) clear of the
   * navigation bar and side insets, so its last lines can be reached.
   */
  fun applySystemBarInsets(topBar: View, bottomView: View?, content: View? = null) {
    val barPadding = intArrayOf(topBar.paddingLeft, topBar.paddingTop, topBar.paddingRight)
    val contentPadding = content?.let { intArrayOf(it.paddingLeft, it.paddingRight, it.paddingBottom) }
    ViewCompat.setOnApplyWindowInsetsListener(topBar) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(barPadding[0] + bars.left, barPadding[1] + bars.top, barPadding[2] + bars.right, view.paddingBottom)
      bottomView?.translationY = -bars.bottom.toFloat()
      if (content != null && contentPadding != null) {
        content.setPadding(
          contentPadding[0] + bars.left,
          content.paddingTop,
          contentPadding[1] + bars.right,
          contentPadding[2] + bars.bottom,
        )
      }
      insets
    }
  }

  fun dp(activity: Activity, value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), activity.resources.displayMetrics).toInt()
}
