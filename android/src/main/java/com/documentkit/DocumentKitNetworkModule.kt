package com.documentkit

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/** Reads the current connection so recording quality can match the network. */
class DocumentKitNetworkModule(reactContext: ReactApplicationContext) :
  NativeDocumentKitNetworkSpec(reactContext) {

  override fun getNetworkSnapshot(promise: Promise) {
    val context = reactApplicationContext
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val capabilities = connectivity?.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }

    val transport = when {
      capabilities == null -> TRANSPORT_NONE
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> TRANSPORT_WIFI
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> TRANSPORT_ETHERNET
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> TRANSPORT_CELLULAR
      else -> TRANSPORT_OTHER
    }

    promise.resolve(Arguments.createMap().apply {
      putString("transport", transport)
      // Reading the radio generation needs READ_PHONE_STATE, which DocumentKit does not
      // ask for; the upload-speed estimate below is the better signal anyway.
      putString("cellularGeneration", GENERATION_UNKNOWN)
      // The OS estimate for the active link; uploads are what recordings wait on.
      putDouble("upstreamKbps", capabilities?.linkUpstreamBandwidthKbps?.takeIf { it > 0 }?.toDouble() ?: -1.0)
      putBoolean("isMetered", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false)
      putBoolean("isDataSaverOn", connectivity?.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED)
    })
  }

  companion object {
    const val NAME = NativeDocumentKitNetworkSpec.NAME

    private const val TRANSPORT_WIFI = "wifi"
    private const val TRANSPORT_CELLULAR = "cellular"
    private const val TRANSPORT_ETHERNET = "ethernet"
    private const val TRANSPORT_OTHER = "other"
    private const val TRANSPORT_NONE = "none"
    private const val GENERATION_UNKNOWN = "unknown"
  }
}
