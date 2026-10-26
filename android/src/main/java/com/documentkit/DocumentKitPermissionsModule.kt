package com.documentkit

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

class DocumentKitPermissionsModule(reactContext: ReactApplicationContext) :
  NativeDocumentKitPermissionsSpec(reactContext) {

  /** A runtime permission DocumentKit asks for, with the hardware it needs (if any). */
  private enum class DocumentKitPermission(
    val manifestName: String,
    val hardwareFeature: String?,
    val requestedKey: String,
    val requestCode: Int,
  ) {
    CAMERA(Manifest.permission.CAMERA, PackageManager.FEATURE_CAMERA_ANY, "camera_requested", 7301),
    MICROPHONE(Manifest.permission.RECORD_AUDIO, PackageManager.FEATURE_MICROPHONE, "microphone_requested", 7302),
    // The API 33 constant's value; it is only requested on Android 13+ (see resolveStatus).
    NOTIFICATIONS(POST_NOTIFICATIONS_PERMISSION, null, "notifications_requested", 7303),
  }

  private val preferences by lazy {
    reactApplicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
  }

  override fun getCameraPermissionStatus(promise: Promise) {
    promise.resolve(resolveStatus(DocumentKitPermission.CAMERA))
  }

  override fun requestCameraPermission(promise: Promise) {
    request(DocumentKitPermission.CAMERA, promise)
  }

  override fun getMicrophonePermissionStatus(promise: Promise) {
    promise.resolve(resolveStatus(DocumentKitPermission.MICROPHONE))
  }

  override fun requestMicrophonePermission(promise: Promise) {
    request(DocumentKitPermission.MICROPHONE, promise)
  }

  override fun getNotificationPermissionStatus(promise: Promise) {
    promise.resolve(resolveStatus(DocumentKitPermission.NOTIFICATIONS))
  }

  override fun requestNotificationPermission(promise: Promise) {
    request(DocumentKitPermission.NOTIFICATIONS, promise)
  }

  override fun openSettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", reactApplicationContext.packageName, null),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(E_OPEN_SETTINGS, "Could not open app settings", error)
    }
  }

  /** Shows the OS prompt only when it still can; resolves the resulting status. */
  private fun request(permission: DocumentKitPermission, promise: Promise) {
    val currentStatus = resolveStatus(permission)
    if (currentStatus != STATUS_PROMPTABLE) {
      promise.resolve(currentStatus)
      return
    }

    val activity = reactApplicationContext.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "No permission-aware activity to show the permission prompt")
      return
    }

    preferences.edit { putBoolean(permission.requestedKey, true) }
    activity.requestPermissions(
      arrayOf(permission.manifestName),
      permission.requestCode,
      PermissionListener { requestCode, _, _ ->
        if (requestCode != permission.requestCode) {
          return@PermissionListener false
        }
        promise.resolve(resolveStatus(permission))
        true
      },
    )
  }

  /**
   * Android has no "blocked" status of its own. It is blocked when we have asked
   * before and the OS no longer wants a rationale shown, which is the state after
   * "Don't ask again" or a second denial.
   */
  private fun resolveStatus(permission: DocumentKitPermission): String {
    val context = reactApplicationContext
    val hardwareFeature = permission.hardwareFeature
    if (hardwareFeature != null && !context.packageManager.hasSystemFeature(hardwareFeature)) {
      return STATUS_UNAVAILABLE
    }
    // Before Android 13 notifications need no runtime permission, only the app's setting.
    if (permission == DocumentKitPermission.NOTIFICATIONS && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return if (NotificationManagerCompat.from(context).areNotificationsEnabled()) STATUS_GRANTED else STATUS_BLOCKED
    }
    if (context.checkSelfPermission(permission.manifestName) == PackageManager.PERMISSION_GRANTED) {
      return STATUS_GRANTED
    }
    if (!preferences.getBoolean(permission.requestedKey, false)) {
      return STATUS_PROMPTABLE
    }
    val activity = context.currentActivity ?: return STATUS_PROMPTABLE
    return if (activity.shouldShowRequestPermissionRationale(permission.manifestName)) {
      STATUS_PROMPTABLE
    } else {
      STATUS_BLOCKED
    }
  }

  companion object {
    const val NAME = NativeDocumentKitPermissionsSpec.NAME

    private const val PREFERENCES_NAME = "documentkit_permissions"
    private const val POST_NOTIFICATIONS_PERMISSION = "android.permission.POST_NOTIFICATIONS"

    private const val STATUS_GRANTED = "granted"
    private const val STATUS_PROMPTABLE = "promptable"
    private const val STATUS_BLOCKED = "blocked"
    private const val STATUS_UNAVAILABLE = "unavailable"

    private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
    private const val E_OPEN_SETTINGS = "E_OPEN_SETTINGS"
  }
}
