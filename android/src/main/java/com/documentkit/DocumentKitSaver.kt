package com.documentkit

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** Saves files into the public Downloads collection (no permission needed on Android 10+). */
internal object DocumentKitSaver {

  class SavedFile(val uri: Uri, val mimeType: String)

  /**
   * Copies [sourceUri] (file://, content://, or http(s):// streamed with [headers])
   * to Download/<subdirectory>/<fileName>. MediaStore renames on conflicts ("name (1).pdf").
   */
  @Throws(IOException::class)
  fun saveToDownloads(
    context: Context,
    sourceUri: Uri,
    fileName: String,
    mimeType: String,
    subdirectory: String,
    headers: Map<String, String> = emptyMap(),
  ): SavedFile {
    val resolver = context.contentResolver
    val resolvedMimeType = mimeType.ifEmpty { DocumentKitFiles.mimeTypeOf(File(fileName)) }
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
      put(MediaStore.MediaColumns.MIME_TYPE, resolvedMimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDownloadPath(subdirectory))
      // Hidden from other apps until the copy is complete.
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IOException("Could not create the file in Downloads")
    try {
      val output = resolver.openOutputStream(target) ?: throw IOException("Could not open $target")
      openSource(context, sourceUri, headers).use { input -> output.use { input.copyTo(it) } }
      resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      return SavedFile(target, resolvedMimeType)
    } catch (error: IOException) {
      resolver.delete(target, null, null)
      throw error
    }
  }

  /** The local file behind a file:// URI, for previews in notifications; null otherwise. */
  fun localFileOf(uri: Uri): File? = if (uri.scheme == "file") uri.path?.let(::File) else null

  private fun openSource(context: Context, uri: Uri, headers: Map<String, String>): InputStream =
    when (uri.scheme) {
      "content" -> context.contentResolver.openInputStream(uri) ?: throw IOException("Could not open $uri")
      // A streamed video: saved straight from the server, no cached copy in between.
      "http", "https" -> {
        val connection = URL(uri.toString()).openConnection() as HttpURLConnection
        connection.connectTimeout = HTTP_TIMEOUT_MS
        connection.readTimeout = HTTP_TIMEOUT_MS
        headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
        val status = connection.responseCode
        if (status !in 200..299) {
          connection.disconnect()
          throw IOException("HTTP $status")
        }
        connection.inputStream
      }
      else -> FileInputStream(uri.path ?: throw IOException("Invalid file URI"))
    }

  private const val HTTP_TIMEOUT_MS = 60_000

  /** Download/<subdirectory>, with path segments that could escape it removed. */
  private fun relativeDownloadPath(subdirectory: String): String {
    val safeSegments = subdirectory.split('/', '\\')
      .map { it.trim() }
      .filter { it.isNotEmpty() && it != "." && it != ".." }
    return (listOf(Environment.DIRECTORY_DOWNLOADS) + safeSegments).joinToString("/")
  }
}
