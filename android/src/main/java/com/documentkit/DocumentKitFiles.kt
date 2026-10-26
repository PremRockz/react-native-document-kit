package com.documentkit

import android.content.Context
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/** Everything DocumentKit hands back lives under cacheDir/document-kit, so it survives until the OS clears cache. */
internal object DocumentKitFiles {
  private const val ROOT_DIRECTORY = "document-kit"
  private const val FALLBACK_MIME_TYPE = "application/octet-stream"

  private val ROTATED_EXIF_ORIENTATIONS = setOf(
    ExifInterface.ORIENTATION_ROTATE_90,
    ExifInterface.ORIENTATION_ROTATE_270,
    ExifInterface.ORIENTATION_TRANSPOSE,
    ExifInterface.ORIENTATION_TRANSVERSE,
  )

  @Throws(IOException::class)
  fun createCaptureFile(context: Context, prefix: String, extension: String): File {
    val directory = ensureDirectory(File(context.cacheDir, ROOT_DIRECTORY))
    return File(directory, "${prefix}_${System.currentTimeMillis()}.$extension")
  }

  class CachedFile(val file: File, val mimeType: String)

  /**
   * Copies a content:// URI into its own folder so the original display name can be kept.
   * Virtual files (e.g. Google Docs in Drive) have no bytes of their own, so they are
   * exported in the first format their provider offers, and named to match.
   */
  @Throws(IOException::class)
  fun copyToCache(context: Context, sourceUri: Uri): CachedFile {
    val resolver = context.contentResolver
    val exportMimeType = if (isVirtualFile(context, sourceUri)) {
      resolver.getStreamTypes(sourceUri, "*/*")?.firstOrNull()
        ?: throw IOException("The selected cloud file cannot be downloaded")
    } else {
      null
    }
    val mimeType = exportMimeType ?: resolver.getType(sourceUri)
    val directory = ensureDirectory(File(context.cacheDir, "$ROOT_DIRECTORY/${UUID.randomUUID()}"))
    val target = File(directory, buildFileName(queryDisplayName(context, sourceUri), mimeType))

    val input = if (exportMimeType != null) {
      resolver.openTypedAssetFileDescriptor(sourceUri, exportMimeType, null)?.createInputStream()
    } else {
      resolver.openInputStream(sourceUri)
    } ?: throw IOException("Could not open the selected file")
    input.use { source -> FileOutputStream(target).use { source.copyTo(it) } }

    return CachedFile(target, mimeType ?: mimeTypeOf(target))
  }

  @Throws(IOException::class)
  fun copyContent(context: Context, sourceUri: Uri, target: File) {
    val input = context.contentResolver.openInputStream(sourceUri)
      ?: throw IOException("Could not open $sourceUri")
    input.use { source -> FileOutputStream(target).use { source.copyTo(it) } }
  }

  private fun isVirtualFile(context: Context, uri: Uri): Boolean {
    if (!DocumentsContract.isDocumentUri(context, uri)) {
      return false
    }
    return context.contentResolver
      .query(uri, arrayOf(DocumentsContract.Document.COLUMN_FLAGS), null, null, null)
      ?.use { cursor ->
        cursor.moveToFirst() &&
          (cursor.getInt(0) and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT) != 0
      } ?: false
  }

  fun describe(file: File, mimeType: String): WritableMap {
    val map = Arguments.createMap()
    map.putString("uri", Uri.fromFile(file).toString())
    map.putString("name", file.name)
    map.putString("mimeType", mimeType)
    map.putDouble("size", file.length().toDouble())
    when {
      mimeType.startsWith("image/") -> putImageDetails(file, map)
      mimeType.startsWith("video/") -> putVideoDetails(file, map)
    }
    return map
  }

  fun mimeTypeOf(file: File): String =
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
      ?: FALLBACK_MIME_TYPE

  private fun putImageDetails(file: File, map: WritableMap) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      return
    }
    val orientation = try {
      ExifInterface(file.path).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )
    } catch (_: IOException) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val isRotated = orientation in ROTATED_EXIF_ORIENTATIONS
    map.putDouble("width", (if (isRotated) bounds.outHeight else bounds.outWidth).toDouble())
    map.putDouble("height", (if (isRotated) bounds.outWidth else bounds.outHeight).toDouble())
  }

  private fun putVideoDetails(file: File, map: WritableMap) {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull()
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull()
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()
      if (width != null && height != null) {
        val isRotated = rotation == 90 || rotation == 270
        map.putDouble("width", if (isRotated) height else width)
        map.putDouble("height", if (isRotated) width else height)
      }
      duration?.let { map.putDouble("durationMs", it) }
    } catch (_: RuntimeException) {
      // Unreadable metadata is not fatal: the file is still usable without dimensions.
    } finally {
      retriever.release()
    }
  }

  private fun queryDisplayName(context: Context, uri: Uri): String? =
    context.contentResolver
      .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }

  /** Keeps the display name, adding the extension for the mime type when the name has none. */
  private fun buildFileName(displayName: String?, mimeType: String?): String {
    val extension = mimeType?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
    val cleaned = displayName?.replace(Regex("[/\\\\:*?\"<>|]"), "_")?.trim().orEmpty()
    return when {
      cleaned.isEmpty() -> "File_${System.currentTimeMillis()}.${extension ?: "bin"}"
      extension != null && File(cleaned).extension.isEmpty() -> "$cleaned.$extension"
      else -> cleaned
    }
  }

  @Throws(IOException::class)
  private fun ensureDirectory(directory: File): File {
    if (!directory.isDirectory && !directory.mkdirs()) {
      throw IOException("Could not create ${directory.path}")
    }
    return directory
  }
}
