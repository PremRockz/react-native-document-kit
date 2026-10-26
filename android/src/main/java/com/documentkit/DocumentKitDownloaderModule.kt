package com.documentkit

import android.net.Uri
import android.os.SystemClock
import androidx.core.net.toUri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class DocumentKitDownloaderModule(reactContext: ReactApplicationContext) :
  NativeDocumentKitDownloaderSpec(reactContext) {

  private class ActiveDownload(val notification: DocumentKitNotifications.Content?) {
    @Volatile var isCancelled = false
    @Volatile var connection: HttpURLConnection? = null
    var lastNotifiedAt = 0L
  }

  private class CancelledException : IOException("Download cancelled")

  private class HttpStatusException(val status: Int) : IOException("HTTP $status") {
    val isRetryable = status == 408 || status == 429 || status >= 500
  }

  private val downloadWorkers: ExecutorService = Executors.newFixedThreadPool(MAX_PARALLEL_DOWNLOADS)
  // Saves and cache clears are short; on their own thread they never wait behind
  // slow downloads (or their retry back-off).
  private val fileWorker: ExecutorService = Executors.newSingleThreadExecutor()
  private val activeDownloads = ConcurrentHashMap<String, ActiveDownload>()

  override fun invalidate() {
    activeDownloads.values.forEach { cancel(it) }
    downloadWorkers.shutdownNow()
    fileWorker.shutdown()
    super.invalidate()
  }

  override fun download(
    downloadId: String,
    url: String,
    headers: ReadableMap,
    cacheKey: String,
    fileName: String,
    notification: ReadableMap?,
    forceRefresh: Boolean,
    promise: Promise,
  ) {
    val active = ActiveDownload(DocumentKitNotifications.Content.from(notification))
    activeDownloads[downloadId] = active
    val requestHeaders = headers.toHashMap().mapNotNull { (key, value) -> (value as? String)?.let { key to it } }

    downloadWorkers.execute {
      try {
        promise.resolve(downloadToCache(downloadId, active, url, requestHeaders, cacheKey, fileName, forceRefresh))
      } catch (_: CancelledException) {
        promise.reject(E_CANCELLED, "Download cancelled")
      } catch (error: HttpStatusException) {
        promise.reject(E_HTTP, "The server answered ${error.status}", Arguments.createMap().apply {
          putInt("status", error.status)
        })
      } catch (error: IOException) {
        if (active.isCancelled) {
          promise.reject(E_CANCELLED, "Download cancelled")
        } else {
          promise.reject(E_NETWORK, "The download could not complete", error)
        }
      } catch (error: Exception) {
        // A bad URL or header value from JS: an uncaught exception here would kill the app.
        promise.reject(E_NETWORK, "The download could not start", error)
      } finally {
        activeDownloads.remove(downloadId)
        // The progress notification ends with the download: an ongoing one left
        // behind (no saveToDevice after it) could not be dismissed. saveToDevice
        // posts "Downloaded" under the same tag.
        active.notification?.let { DocumentKitNotifications.cancel(reactApplicationContext, it) }
      }
    }
  }

  override fun cancelDownload(downloadId: String) {
    activeDownloads[downloadId]?.let { cancel(it) }
  }

  override fun saveToDevice(
    fileUri: String,
    fileName: String,
    mimeType: String,
    subdirectory: String,
    notification: ReadableMap?,
    promise: Promise,
  ) {
    val notificationContent = DocumentKitNotifications.Content.from(notification)
    fileWorker.execute {
      val context = reactApplicationContext
      try {
        val sourceUri = fileUri.toUri()
        val saved = DocumentKitSaver.saveToDownloads(context, sourceUri, fileName, mimeType, subdirectory)
        notificationContent?.let {
          DocumentKitNotifications.showCompleted(context, it, saved.uri, saved.mimeType, DocumentKitSaver.localFileOf(sourceUri))
        }
        promise.resolve(Arguments.createMap().apply {
          putBoolean("saved", true)
          putString("location", saved.uri.toString())
        })
      } catch (error: Exception) {
        // MediaStore also throws IllegalStateException / SecurityException, not only IOException.
        notificationContent?.let { DocumentKitNotifications.cancel(context, it) }
        promise.reject(E_STORAGE, "Could not save the file to Downloads", error)
      }
    }
  }

  override fun clearDownloadCache(promise: Promise) {
    fileWorker.execute {
      try {
        DocumentKitDownloadCache.clear(reactApplicationContext)
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject(E_STORAGE, "Could not clear the download cache", error)
      }
    }
  }

  private fun downloadToCache(
    downloadId: String,
    active: ActiveDownload,
    url: String,
    headers: List<Pair<String, String>>,
    cacheKey: String,
    fileName: String,
    forceRefresh: Boolean,
  ): WritableMap {
    val context = reactApplicationContext
    val entry = DocumentKitDownloadCache.entryFor(context, cacheKey, fileName)
    if (forceRefresh) {
      // Fresh from the server: the old copy (and a partial of it) must not be reused or resumed.
      entry.directory.listFiles()?.forEach { it.delete() }
    } else {
      entry.completedFile()?.let { cached ->
        entry.markUsed()
        return describe(cached, fromCache = true)
      }
    }

    var attempt = 1
    while (true) {
      try {
        transfer(downloadId, active, url, headers, entry)
        break
      } catch (error: IOException) {
        val canRetry = !active.isCancelled &&
          error !is CancelledException &&
          (error !is HttpStatusException || error.isRetryable) &&
          attempt < MAX_ATTEMPTS
        if (!canRetry) {
          throw if (active.isCancelled) CancelledException() else error
        }
        // Back off 1s, 2s, ... so a flaky connection has time to recover.
        SystemClock.sleep(RETRY_BASE_DELAY_MS shl (attempt - 1))
        attempt++
      }
    }

    if (!entry.partFile.renameTo(entry.finalFile)) {
      throw IOException("Could not finish the cached file")
    }
    entry.markUsed()
    DocumentKitDownloadCache.trim(context, keep = entry.directory)
    return describe(entry.finalFile, fromCache = false)
  }

  /** One HTTP attempt. Resumes from the partial file when the server supports ranges. */
  private fun transfer(
    downloadId: String,
    active: ActiveDownload,
    url: String,
    headers: List<Pair<String, String>>,
    entry: DocumentKitDownloadCache.Entry,
  ) {
    if (active.isCancelled) {
      throw CancelledException()
    }
    val resumeFrom = entry.partFile.length()
    // Not retried: an ftp:// or file:// URL will never work.
    val connection = (URL(url).openConnection() as? HttpURLConnection
      ?: throw IllegalArgumentException("Only http and https URLs can be downloaded")).apply {
      connectTimeout = CONNECT_TIMEOUT_MS
      // Per read, so a slow but moving download never times out.
      readTimeout = IDLE_TIMEOUT_MS
      headers.forEach { (name, value) -> setRequestProperty(name, value) }
      if (resumeFrom > 0) {
        setRequestProperty("Range", "bytes=$resumeFrom-")
      }
    }
    active.connection = connection
    try {
      val status = connection.responseCode
      val isResuming = when {
        status == HttpURLConnection.HTTP_PARTIAL && resumeFrom > 0 -> true
        status in 200..299 -> false
        status == HTTP_RANGE_NOT_SATISFIABLE && resumeFrom > 0 -> {
          // The partial file no longer matches the server's file: start over.
          entry.partFile.delete()
          throw IOException("Stale partial download")
        }
        else -> throw HttpStatusException(status)
      }
      val contentLength = connection.contentLengthLong
      val startAt = if (isResuming) resumeFrom else 0L
      val totalBytes = if (contentLength >= 0) startAt + contentLength else -1L

      connection.inputStream.use { input ->
        FileOutputStream(entry.partFile, isResuming).use { output ->
          copyWithProgress(downloadId, active, input, output, startAt, totalBytes)
        }
      }
    } finally {
      active.connection = null
      connection.disconnect()
    }
  }

  private fun copyWithProgress(
    downloadId: String,
    active: ActiveDownload,
    input: InputStream,
    output: FileOutputStream,
    startAt: Long,
    totalBytes: Long,
  ) {
    val buffer = ByteArray(BUFFER_SIZE)
    var bytesWritten = startAt
    var lastEmitAt = 0L
    emitProgress(downloadId, bytesWritten, totalBytes)
    notifyProgress(active, bytesWritten, totalBytes, SystemClock.elapsedRealtime())
    while (true) {
      val read = input.read(buffer)
      if (read < 0) {
        break
      }
      if (active.isCancelled) {
        throw CancelledException()
      }
      output.write(buffer, 0, read)
      bytesWritten += read
      val now = SystemClock.elapsedRealtime()
      if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
        lastEmitAt = now
        emitProgress(downloadId, bytesWritten, totalBytes)
        notifyProgress(active, bytesWritten, totalBytes, now)
      }
    }
    emitProgress(downloadId, bytesWritten, totalBytes)
  }

  /** Android rate-limits notification updates, so these are sparser than JS progress events. */
  private fun notifyProgress(active: ActiveDownload, bytesWritten: Long, totalBytes: Long, now: Long) {
    val notification = active.notification ?: return
    if (now - active.lastNotifiedAt < NOTIFICATION_INTERVAL_MS) {
      return
    }
    active.lastNotifiedAt = now
    DocumentKitNotifications.showProgress(reactApplicationContext, notification, bytesWritten, totalBytes)
  }

  private fun emitProgress(downloadId: String, bytesWritten: Long, totalBytes: Long) {
    emitOnDownloadProgress(Arguments.createMap().apply {
      putString("downloadId", downloadId)
      putDouble("bytesWritten", bytesWritten.toDouble())
      putDouble("totalBytes", totalBytes.toDouble())
    })
  }

  private fun cancel(active: ActiveDownload) {
    active.isCancelled = true
    // Unblocks a read that is waiting on the network.
    active.connection?.disconnect()
  }

  private fun describe(file: File, fromCache: Boolean): WritableMap = Arguments.createMap().apply {
    putString("uri", Uri.fromFile(file).toString())
    putString("name", file.name)
    putString("mimeType", DocumentKitFiles.mimeTypeOf(file))
    putDouble("size", file.length().toDouble())
    putBoolean("fromCache", fromCache)
  }

  companion object {
    const val NAME = NativeDocumentKitDownloaderSpec.NAME

    private const val MAX_PARALLEL_DOWNLOADS = 3
    private const val MAX_ATTEMPTS = 4
    private const val RETRY_BASE_DELAY_MS = 1000L
    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val IDLE_TIMEOUT_MS = 60_000
    private const val PROGRESS_INTERVAL_MS = 250L
    private const val NOTIFICATION_INTERVAL_MS = 1000L
    private const val BUFFER_SIZE = 64 * 1024
    private const val HTTP_RANGE_NOT_SATISFIABLE = 416

    private const val E_CANCELLED = "E_CANCELLED"
    private const val E_HTTP = "E_HTTP"
    private const val E_NETWORK = "E_NETWORK"
    private const val E_STORAGE = "E_STORAGE"
  }
}
