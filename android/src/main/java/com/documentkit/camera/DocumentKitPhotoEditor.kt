package com.documentkit.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import com.documentkit.DocumentKitFiles
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Photo files for DocumentKit's camera: the screen-sized display copy, and the
 * review screen's rotate and crop, applied to the full-resolution photo.
 * Background threads only.
 */
internal object DocumentKitPhotoEditor {

  private const val PHOTO_PREFIX = "Image"
  private const val PHOTO_DISPLAY_PREFIX = "ImagePreview"
  private const val PHOTO_EXTENSION = "jpg"
  private const val PHOTO_MIME_TYPE = "image/jpeg"
  private const val DISPLAY_COPY_QUALITY = 85
  private const val EDITED_PHOTO_QUALITY = 92
  private const val DECODE_ATTEMPTS = 3
  // About 64 MB as a bitmap: a crop (or a photo to straighten) larger than this is decoded at half size or less.
  private const val MAX_DECODED_PIXELS = 16_000_000L
  // Smaller turns are treated as none.
  private const val MIN_STRAIGHTEN_DEGREES = 0.05f

  /** The review editor's changes (NativePhotoEdits), applied in this order. */
  class Edits(
    /** 0, 90, 180 or 270, clockwise. */
    val rotationDegrees: Int,
    /** Mirrored left to right, after the rotation. */
    val isFlipped: Boolean,
    /** Fine turn, clockwise, after the flip; zoomed in so no corner is empty. */
    val straightenDegrees: Float,
    /** Fractions (0–1) of the photo after the steps above. */
    val crop: RectF,
  )

  /**
   * Writes an edited copy of [source]. Rotation and flip alone only rewrite the
   * EXIF orientation, so they lose nothing; a crop decodes just its region and
   * keeps the turn as EXIF orientation too. Straightening redraws the pixels.
   * The original stays as it is. Returns the new photo, with its own previewUri.
   */
  @Throws(IOException::class)
  fun edit(context: Context, source: File, edits: Edits, displayEdge: Int): WritableMap {
    val originalRotation = ExifInterface(source.path).rotationDegrees
    val totalRotation = Math.floorMod(originalRotation + edits.rotationDegrees, 360)
    val output = DocumentKitFiles.createCaptureFile(context, PHOTO_PREFIX, PHOTO_EXTENSION)
    try {
      // Only a JPEG can keep its pixels and take a new EXIF orientation; other
      // formats (library PNG, WebP, HEIC) are redrawn into a JPEG.
      val needsRedraw = abs(edits.straightenDegrees) >= MIN_STRAIGHTEN_DEGREES || !isJpeg(source)
      val orientation = if (needsRedraw) {
        writeStraightened(source, totalRotation, edits, output)
        // The pixels are drawn upright.
        ExifInterface.ORIENTATION_NORMAL
      } else {
        if (isWhole(edits.crop)) {
          source.copyTo(output, overwrite = true)
        } else {
          // The crop is of the mirrored photo; mirror it back before mapping it onto the stored pixels.
          val crop = if (edits.isFlipped) mirrored(edits.crop) else edits.crop
          writeCrop(source, toRawCrop(crop, totalRotation), output)
        }
        exifOrientation(totalRotation, edits.isFlipped)
      }
      ExifInterface(output.path).apply {
        setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
        saveAttributes()
      }
      val photo = DocumentKitFiles.describe(output, PHOTO_MIME_TYPE)
      photo.putString("previewUri", Uri.fromFile(writeDisplayCopy(context, output, displayEdge)).toString())
      return photo
    } catch (error: Exception) {
      output.delete()
      throw error as? IOException ?: IOException("Cannot edit ${source.name}", error)
    }
  }

  /**
   * Writes a copy no larger than about [edge], rotated upright, so the review
   * never decodes a 12–50 MP photo.
   */
  @Throws(IOException::class)
  fun writeDisplayCopy(context: Context, photo: File, edge: Int): File {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(photo.path, bounds)
    var sampleSize = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sampleSize * 2) >= edge) {
      sampleSize *= 2
    }
    val exif = ExifInterface(photo.path)
    // A 50 MP photo on a tablet-sized screen can still be too much for a small
    // heap (decoded plus rotated copy); a smaller review copy beats a crash.
    repeat(DECODE_ATTEMPTS) { attempt ->
      try {
        return writeUprightCopy(context, photo, sampleSize shl attempt, exif.rotationDegrees, exif.isFlipped)
      } catch (error: OutOfMemoryError) {
        if (attempt == DECODE_ATTEMPTS - 1) {
          throw IOException("Not enough memory to show ${photo.name}", error)
        }
      }
    }
    throw IOException("Cannot decode ${photo.name}")
  }

  @Throws(IOException::class)
  fun writeJpeg(context: Context, bitmap: Bitmap, prefix: String, quality: Int = DISPLAY_COPY_QUALITY): File {
    val file = DocumentKitFiles.createCaptureFile(context, prefix, PHOTO_EXTENSION)
    writeJpegTo(bitmap, file, quality)
    return file
  }

  @Throws(IOException::class)
  private fun writeJpegTo(bitmap: Bitmap, file: File, quality: Int) {
    FileOutputStream(file).use {
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it)) {
        throw IOException("Cannot encode ${file.name}")
      }
    }
  }

  @Throws(IOException::class)
  private fun writeUprightCopy(context: Context, photo: File, sampleSize: Int, rotation: Int, isFlipped: Boolean): File {
    val decoded = BitmapFactory.decodeFile(photo.path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
      ?: throw IOException("Cannot decode ${photo.name}")
    var upright = decoded
    try {
      if (rotation != 0 || isFlipped) {
        // EXIF's mirrored orientations (from the editor's Flip) mirror after turning.
        val matrix = Matrix().apply {
          postRotate(rotation.toFloat())
          if (isFlipped) {
            postScale(-1f, 1f)
          }
        }
        upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
      }
      return writeJpeg(context, upright, PHOTO_DISPLAY_PREFIX)
    } finally {
      if (upright !== decoded) {
        upright.recycle()
      }
      decoded.recycle()
    }
  }

  /** Decodes only [rawCrop] (fractions of the stored, unturned pixels) and writes it as JPEG. */
  @Throws(IOException::class)
  private fun writeCrop(source: File, rawCrop: RectF, output: File) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    val width = bounds.outWidth
    val height = bounds.outHeight
    if (width <= 0 || height <= 0) {
      throw IOException("Cannot read ${source.name}")
    }
    val region = Rect(
      (rawCrop.left * width).roundToInt().coerceIn(0, width - 1),
      (rawCrop.top * height).roundToInt().coerceIn(0, height - 1),
      (rawCrop.right * width).roundToInt().coerceIn(1, width),
      (rawCrop.bottom * height).roundToInt().coerceIn(1, height),
    )
    if (region.width() <= 0 || region.height() <= 0) {
      throw IOException("The crop is empty")
    }
    var sampleSize = 1
    while (region.width().toLong() * region.height() / (sampleSize.toLong() * sampleSize) > MAX_DECODED_PIXELS) {
      sampleSize *= 2
    }
    val decoder = newRegionDecoder(source)
    try {
      repeat(DECODE_ATTEMPTS) { attempt ->
        try {
          val options = BitmapFactory.Options().apply { inSampleSize = sampleSize shl attempt }
          val bitmap = decoder.decodeRegion(region, options) ?: throw IOException("Cannot decode ${source.name}")
          try {
            writeJpegTo(bitmap, output, EDITED_PHOTO_QUALITY)
          } finally {
            bitmap.recycle()
          }
          return
        } catch (error: OutOfMemoryError) {
          if (attempt == DECODE_ATTEMPTS - 1) {
            throw IOException("Not enough memory to crop ${source.name}", error)
          }
        }
      }
    } finally {
      decoder.recycle()
    }
  }

  /**
   * Draws the photo turned [totalRotation] (the stored EXIF turn plus the
   * editor's), mirrored, straightened and cropped in one pass, so only the
   * decoded photo and the cropped result are in memory.
   */
  @Throws(IOException::class)
  private fun writeStraightened(source: File, totalRotation: Int, edits: Edits, output: File) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    var sampleSize = 1
    while (bounds.outWidth.toLong() * bounds.outHeight / (sampleSize.toLong() * sampleSize) > MAX_DECODED_PIXELS) {
      sampleSize *= 2
    }
    repeat(DECODE_ATTEMPTS) { attempt ->
      try {
        drawStraightened(source, sampleSize shl attempt, totalRotation, edits, output)
        return
      } catch (error: OutOfMemoryError) {
        if (attempt == DECODE_ATTEMPTS - 1) {
          throw IOException("Not enough memory to straighten ${source.name}", error)
        }
      }
    }
  }

  @Throws(IOException::class)
  private fun drawStraightened(source: File, sampleSize: Int, totalRotation: Int, edits: Edits, output: File) {
    val photo = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
      ?: throw IOException("Cannot decode ${source.name}")
    try {
      // Stored pixels → turned upright, as the editor showed it.
      val matrix = Matrix().apply { postRotate(totalRotation.toFloat()) }
      val turned = RectF(0f, 0f, photo.width.toFloat(), photo.height.toFloat())
      matrix.mapRect(turned)
      matrix.postTranslate(-turned.left, -turned.top)
      val width = turned.width()
      val height = turned.height()
      if (edits.isFlipped) {
        matrix.postScale(-1f, 1f)
        matrix.postTranslate(width, 0f)
      }
      // Straightened around the centre, zoomed just enough to leave no empty corner.
      val zoom = straightenZoom(width, height, edits.straightenDegrees)
      matrix.postRotate(edits.straightenDegrees, width / 2, height / 2)
      matrix.postScale(zoom, zoom, width / 2, height / 2)
      matrix.postTranslate(-edits.crop.left * width, -edits.crop.top * height)

      val result = Bitmap.createBitmap(
        (edits.crop.width() * width).roundToInt().coerceAtLeast(1),
        (edits.crop.height() * height).roundToInt().coerceAtLeast(1),
        Bitmap.Config.ARGB_8888,
      )
      try {
        Canvas(result).apply {
          // JPEG has no transparency: a transparent PNG gets white, not black.
          drawColor(android.graphics.Color.WHITE)
          drawBitmap(photo, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        }
        writeJpegTo(result, output, EDITED_PHOTO_QUALITY)
      } finally {
        result.recycle()
      }
    } finally {
      photo.recycle()
    }
  }

  /** How much a [width]×[height] picture turned [degrees] must grow to still cover its own frame. */
  private fun straightenZoom(width: Float, height: Float, degrees: Float): Float {
    val angle = Math.toRadians(abs(degrees).toDouble())
    val cosine = cos(angle).toFloat()
    val sine = sin(angle).toFloat()
    return max((width * cosine + height * sine) / width, (width * sine + height * cosine) / height)
  }

  private fun isJpeg(file: File): Boolean {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    return bounds.outMimeType == PHOTO_MIME_TYPE
  }

  private fun mirrored(crop: RectF): RectF = RectF(1f - crop.right, crop.top, 1f - crop.left, crop.bottom)

  @Throws(IOException::class)
  private fun newRegionDecoder(source: File): BitmapRegionDecoder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      BitmapRegionDecoder.newInstance(source.path)
    } else {
      @Suppress("DEPRECATION")
      BitmapRegionDecoder.newInstance(source.path, false)
    } ?: throw IOException("Cannot read ${source.name}")

  private fun isWhole(crop: RectF): Boolean =
    crop.left <= 0.001f && crop.top <= 0.001f && crop.right >= 0.999f && crop.bottom >= 0.999f

  /**
   * [crop] is in fractions of the photo as shown, which is the stored pixels
   * turned [rotation] clockwise; this maps it back onto the stored pixels.
   */
  private fun toRawCrop(crop: RectF, rotation: Int): RectF {
    val x = crop.left.coerceIn(0f, 1f)
    val y = crop.top.coerceIn(0f, 1f)
    val w = min(crop.width(), 1f - x)
    val h = min(crop.height(), 1f - y)
    return when (rotation) {
      90 -> RectF(y, 1f - x - w, y + h, 1f - x)
      180 -> RectF(1f - x - w, 1f - y - h, 1f - x, 1f - y)
      270 -> RectF(1f - y - h, x, 1f - y, x + w)
      else -> RectF(x, y, x + w, y + h)
    }
  }

  /** EXIF orientation for turning [rotation] clockwise, then mirroring left to right when [isFlipped]. */
  private fun exifOrientation(rotation: Int, isFlipped: Boolean): Int = when (rotation) {
    90 -> if (isFlipped) ExifInterface.ORIENTATION_TRANSPOSE else ExifInterface.ORIENTATION_ROTATE_90
    180 -> if (isFlipped) ExifInterface.ORIENTATION_FLIP_VERTICAL else ExifInterface.ORIENTATION_ROTATE_180
    270 -> if (isFlipped) ExifInterface.ORIENTATION_TRANSVERSE else ExifInterface.ORIENTATION_ROTATE_270
    else -> if (isFlipped) ExifInterface.ORIENTATION_FLIP_HORIZONTAL else ExifInterface.ORIENTATION_NORMAL
  }
}
