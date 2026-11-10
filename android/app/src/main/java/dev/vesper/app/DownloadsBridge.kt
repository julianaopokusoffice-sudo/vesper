package dev.vesper.app

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream

/**
 * Blob URLs cannot be downloaded by Android's DownloadManager, and a WebView
 * cannot write to shared storage on its own. This bridge is deliberately tiny:
 * it accepts a file name, a base64 payload and a MIME type, then writes one file
 * into Downloads/Vesper through MediaStore. It cannot read anything.
 */
class DownloadsBridge(private val context: Context) {

    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun saveBase64(name: String?, base64: String?, mime: String?): String {
        val payload = base64?.trim().orEmpty()
        if (payload.isEmpty()) return "empty"
        val filename = sanitize(name ?: "vesper-download")
        val type = mime?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        return try {
            val bytes = Base64.decode(payload, Base64.DEFAULT)
            val location =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveModern(filename, type, bytes)
                else saveLegacy(filename, bytes)
            toast("Saved to Downloads/Vesper")
            location
        } catch (err: Exception) {
            toast("Could not save: ${err.message ?: "unknown error"}")
            ""
        }
    }

    @JavascriptInterface
    fun shareText(text: String?) {
        val value = text.orEmpty()
        if (value.isEmpty()) return
        main.post {
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                this.type = "text/plain"
                putExtra(android.content.Intent.EXTRA_TEXT, value)
            }
            context.startActivity(android.content.Intent.createChooser(intent, "Share").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun saveModern(filename: String, mime: String, bytes: ByteArray): String {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Vesper")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Downloads is unavailable")
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("Could not open the download")
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
        } catch (err: Exception) {
            resolver.delete(uri, null, null)
            throw err
        }
        return "Downloads/Vesper/$filename"
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(filename: String, bytes: ByteArray): String {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Vesper")
        if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("Could not create Downloads/Vesper")
        val file = uniqueFile(dir, filename)
        FileOutputStream(file).use { it.write(bytes) }
        return file.absolutePath
    }

    private fun uniqueFile(dir: File, filename: String): File {
        val dot = filename.lastIndexOf('.')
        val stem = if (dot > 0) filename.substring(0, dot) else filename
        val ext = if (dot > 0) filename.substring(dot) else ""
        var candidate = File(dir, filename)
        var index = 1
        while (candidate.exists() && index < 999) {
            candidate = File(dir, "$stem ($index)$ext")
            index += 1
        }
        return candidate
    }

    private fun sanitize(value: String): String {
        val cleaned = value.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().take(120)
        return cleaned.ifEmpty { "vesper-download" }
    }

    private fun toast(message: String) {
        main.post { Toast.makeText(context, message, Toast.LENGTH_SHORT).show() }
    }
}
