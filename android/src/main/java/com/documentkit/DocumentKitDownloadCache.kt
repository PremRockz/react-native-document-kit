package com.documentkit

import android.content.Context
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * cacheDir/document-kit/downloads/<hash of cacheKey>/<file name>
 *
 * One folder per cache key keeps the original file name, so a cached file can be
 * saved or shared under its real name. A ".part" file holds an unfinished
 * download so the next attempt can resume it.
 */
internal object DocumentKitDownloadCache {
  private const val ROOT_DIRECTORY = "document-kit/downloads"
  private const val PART_SUFFIX = ".part"
  // Least recently used entries are removed once the cache grows past this.
  private const val MAX_CACHE_BYTES = 200L * 1024 * 1024

  class Entry(val directory: File, val fileName: String) {
    val finalFile = File(directory, fileName)
    val partFile = File(directory, "$fileName$PART_SUFFIX")

    /** Any finished file in the folder; a different name only means an earlier caller named it differently. */
    fun completedFile(): File? =
      finalFile.takeIf { it.isFile } ?: directory.listFiles()?.firstOrNull {
        it.isFile && !it.name.endsWith(PART_SUFFIX)
      }

    fun markUsed() {
      val now = System.currentTimeMillis()
      directory.setLastModified(now)
    }
  }

  @Throws(IOException::class)
  fun entryFor(context: Context, cacheKey: String, fileName: String): Entry {
    val directory = File(root(context), hash(cacheKey))
    if (!directory.isDirectory && !directory.mkdirs()) {
      throw IOException("Could not create the download cache folder")
    }
    return Entry(directory, sanitizeFileName(fileName))
  }

  /** Removes the oldest entries until the cache fits, never touching [keep]. */
  fun trim(context: Context, keep: File) {
    val entries = root(context).listFiles()?.filter { it.isDirectory } ?: return
    var totalBytes = entries.sumOf { directorySize(it) }
    for (entry in entries.sortedBy { it.lastModified() }) {
      if (totalBytes <= MAX_CACHE_BYTES) {
        return
      }
      if (entry == keep) {
        continue
      }
      totalBytes -= directorySize(entry)
      entry.deleteRecursively()
    }
  }

  fun clear(context: Context) {
    root(context).deleteRecursively()
  }

  private fun root(context: Context) = File(context.cacheDir, ROOT_DIRECTORY)

  private fun directorySize(directory: File): Long =
    directory.listFiles()?.sumOf { it.length() } ?: 0L

  private fun hash(value: String): String =
    MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray())
      .joinToString("") { "%02x".format(it) }
      .take(32)

  /** Cache names are internal; viewers use the path directly, so no spaces or path characters. */
  private fun sanitizeFileName(fileName: String): String {
    val cleaned = fileName.trim().replace(Regex("[\\s/\\\\:*?\"<>|]+"), "_")
    return cleaned.ifEmpty { "File_${System.currentTimeMillis()}" }
  }
}
