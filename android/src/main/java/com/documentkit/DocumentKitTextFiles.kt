package com.documentkit

import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/** Reads text files for the in-app text viewer and parses CSV. */
internal object DocumentKitTextFiles {

  class TextContent(val text: String, val isTruncated: Boolean)

  // Anything bigger is shown in part, so a huge log cannot run the app out of memory.
  private const val MAX_TEXT_BYTES = 5 * 1024 * 1024
  private const val BUFFER_SIZE = 64 * 1024
  // A UTF-8 character is at most 4 bytes; a cut-off one at the end is dropped.
  private const val MAX_PARTIAL_CHARACTER_BYTES = 3

  private val UTF_8_BOM = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
  private val UTF_16_LE_BOM = byteArrayOf(0xFF.toByte(), 0xFE.toByte())
  private val UTF_16_BE_BOM = byteArrayOf(0xFE.toByte(), 0xFF.toByte())

  @Throws(IOException::class)
  fun read(context: Context, uri: Uri): TextContent {
    val input = context.contentResolver.openInputStream(uri) ?: throw IOException("Could not open $uri")
    val bytes = ByteArrayOutputStream()
    var isTruncated = false
    input.use { source ->
      val buffer = ByteArray(BUFFER_SIZE)
      while (true) {
        val read = source.read(buffer)
        if (read < 0) {
          break
        }
        val room = MAX_TEXT_BYTES - bytes.size()
        if (read > room) {
          bytes.write(buffer, 0, room)
          isTruncated = true
          break
        }
        bytes.write(buffer, 0, read)
      }
    }
    return TextContent(decode(bytes.toByteArray(), isTruncated), isTruncated)
  }

  /** Byte-order mark first; otherwise UTF-8 if it is valid, else Windows-1252 (older exports). */
  private fun decode(bytes: ByteArray, isTruncated: Boolean): String {
    when {
      bytes.startsWith(UTF_8_BOM) -> return String(bytes, UTF_8_BOM.size, bytes.size - UTF_8_BOM.size, Charsets.UTF_8)
      bytes.startsWith(UTF_16_LE_BOM) -> return String(bytes, UTF_16_LE_BOM.size, bytes.size - UTF_16_LE_BOM.size, Charsets.UTF_16LE)
      bytes.startsWith(UTF_16_BE_BOM) -> return String(bytes, UTF_16_BE_BOM.size, bytes.size - UTF_16_BE_BOM.size, Charsets.UTF_16BE)
    }
    val length = if (isTruncated) (bytes.size - MAX_PARTIAL_CHARACTER_BYTES).coerceAtLeast(0) else bytes.size
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes, 0, length))
        .toString()
    } catch (_: CharacterCodingException) {
      String(bytes, Charset.forName("windows-1252"))
    }
  }

  private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
    size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

  /** The separator that appears most in the first line, outside quotes: comma, semicolon or tab. */
  fun detectDelimiter(text: String): Char {
    val firstLine = text.lineSequence().firstOrNull().orEmpty()
    return CSV_DELIMITERS.maxByOrNull { delimiter -> countOutsideQuotes(firstLine, delimiter) } ?: ','
  }

  /**
   * RFC 4180 parsing: quoted fields may contain the delimiter, line breaks and
   * doubled quotes (""). Lines ending in \r\n or \n both work.
   */
  fun parseCsv(text: String, delimiter: Char): List<List<String>> {
    val rows = mutableListOf<List<String>>()
    var row = mutableListOf<String>()
    val field = StringBuilder()
    var isQuoted = false
    var index = 0
    while (index < text.length) {
      val character = text[index]
      when {
        isQuoted && character == '"' && text.getOrNull(index + 1) == '"' -> {
          field.append('"')
          index++
        }
        character == '"' -> isQuoted = !isQuoted
        isQuoted -> field.append(character)
        character == delimiter -> {
          row.add(field.toString())
          field.clear()
        }
        character == '\n' || character == '\r' -> {
          if (character == '\r' && text.getOrNull(index + 1) == '\n') {
            index++
          }
          row.add(field.toString())
          field.clear()
          rows.add(row)
          row = mutableListOf()
        }
        else -> field.append(character)
      }
      index++
    }
    if (field.isNotEmpty() || row.isNotEmpty()) {
      row.add(field.toString())
      rows.add(row)
    }
    return rows
  }

  private fun countOutsideQuotes(line: String, delimiter: Char): Int {
    var count = 0
    var isQuoted = false
    for (character in line) {
      if (character == '"') {
        isQuoted = !isQuoted
      } else if (character == delimiter && !isQuoted) {
        count++
      }
    }
    return count
  }

  private val CSV_DELIMITERS = listOf(',', ';', '\t')
}
