package chat.whisp.mls

import chat.whisp.mls.core.MediaKind
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.reactnativecompressor.Video.VideoCompressor.CompressionProgressListener
import com.reactnativecompressor.Video.VideoCompressor.compressor.Compressor
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

internal object SendCompression {
  private val compressor = Mutex()
  suspend fun compress(context: Context, kind: MediaKind, source: String, output: String) = compressor.withLock {
    val temporary = File("$output.partial")
    temporary.delete()
    try {
      when (kind) {
        MediaKind.PHOTO -> image(source, temporary)
        MediaKind.VIDEO -> video(context, source, temporary)
      }
      check(temporary.length() > 0) { "Compression produced an empty file. Capture the media again." }
      FileOutputStream(temporary, true).use { it.fd.sync() }
      check(temporary.renameTo(File(output))) { "Could not publish compressed media. Retry the queued whisp." }
    } finally { temporary.delete() }
  }
  private fun image(source: String, output: File) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source, bounds)
    check(bounds.outWidth > 0 && bounds.outHeight > 0) { "The captured image could not be decoded." }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > 2560) sample *= 2
    val original = checkNotNull(BitmapFactory.decodeFile(source, BitmapFactory.Options().apply { inSampleSize = sample }))
    try {
      val exif = ExifInterface(source)
      val matrix = Matrix()
      if (exif.isFlipped) matrix.postScale(-1f, 1f)
      matrix.postRotate(exif.rotationDegrees.toFloat())
      val scale = minOf(1f, 1280f / max(original.width, original.height))
      matrix.postScale(scale, scale)
      val normalized = Bitmap.createBitmap(original, 0, 0, original.width, original.height, matrix, true)
      try {
        FileOutputStream(output).use { check(normalized.compress(Bitmap.CompressFormat.JPEG, 82, it)) }
      } finally { if (normalized !== original) normalized.recycle() }
    } finally { original.recycle() }
  }
  private suspend fun video(context: Context, source: String, output: File) {
    val metadata = MediaMetadataRetriever()
    val width: Int
    val height: Int
    try {
      metadata.setDataSource(source)
      width = checkNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)).toInt()
      height = checkNotNull(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)).toInt()
    } finally { metadata.release() }
    val scale = minOf(1.0, 1280.0 / max(width, height))
    val result = Compressor.compressVideo(0, context, Uri.fromFile(File(source)), output.path, null,
      max(2, (width * scale).roundToInt() / 2 * 2), max(2, (height * scale).roundToInt() / 2 * 2), 2_000_000,
      object : CompressionProgressListener {
        override fun onProgressChanged(index: Int, percent: Float) = Unit
        override fun onProgressCancelled(index: Int) = Unit
      })
    check(result.success) { "Video compression failed. The original capture remains queued." }
  }
}
