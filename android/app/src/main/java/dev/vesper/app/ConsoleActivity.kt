package dev.vesper.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import dev.vesper.app.BuildConfig

/**
 * The full Vesper console, loaded from wherever the node is: this phone, a
 * laptop on the LAN, or a server. It is a plain WebView on purpose — the
 * interface is the same one the desktop app ships, so there is a single UI to
 * maintain. The activity adds the four things a WebView does not do by itself:
 * file uploads, microphone permission, downloads, and safe-area insets.
 */
class ConsoleActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val trustedHosts = mutableSetOf("127.0.0.1", "localhost", "::1")
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudio: PermissionRequest? = null

    private val fileChooser: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingFileCallback
            pendingFileCallback = null
            if (callback == null) return@registerForActivityResult
            callback.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
            )
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.parseColor("#0E0E11")
        window.navigationBarColor = Color.parseColor("#0E0E11")
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        val url = intent.getStringExtra(EXTRA_URL) ?: "http://127.0.0.1:8787"
        runCatching { Uri.parse(url).host }.getOrNull()?.let { trustedHosts.add(it) }

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0E0E11"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.userAgentString = "${settings.userAgentString} VesperAndroid/1.0"
            addJavascriptInterface(DownloadsBridge(this@ConsoleActivity), "VesperAndroid")
        }

        ViewCompat.setOnApplyWindowInsetsListener(web) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.updatePadding(top = bars.top, bottom = maxOf(bars.bottom, keyboard.bottom))
            insets
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isTrusted(uri)) return false
                // Anything off the node (a source link, a docs page) belongs in
                // the real browser, not in the console's WebView.
                return runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                }.getOrDefault(true)
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = filePathCallback
                return try {
                    val intent = fileChooserParams.createIntent().apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }
                    fileChooser.launch(Intent.createChooser(intent, "Attach a file"))
                    true
                } catch (_: Exception) {
                    pendingFileCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!wantsAudio) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(this@ConsoleActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingAudio = request
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
                }
            }
        }

        web.setDownloadListener { downloadUrl, userAgent, contentDisposition, mimeType, _ ->
            when {
                downloadUrl.startsWith("blob:") -> {
                    Toast.makeText(this, "Use the app's save button for this file.", Toast.LENGTH_SHORT).show()
                }
                downloadUrl.startsWith("data:") -> {
                    Toast.makeText(this, "Use the app's save button for this file.", Toast.LENGTH_SHORT).show()
                }
                else -> enqueueDownload(downloadUrl, userAgent, contentDisposition, mimeType)
            }
        }

        setContentView(web)
        web.loadUrl(url)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_MIC) return
        val request = pendingAudio ?: return
        pendingAudio = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
            Toast.makeText(this, "Microphone permission is needed for voice mode.", Toast.LENGTH_LONG).show()
        }
    }

    private fun isTrusted(uri: Uri): Boolean {
        val host = uri.host ?: return uri.scheme == "about"
        return trustedHosts.any { it.equals(host, ignoreCase = true) }
    }

    @Suppress("DEPRECATION")
    private fun enqueueDownload(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
        runCatching {
            val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(filename)
                setDescription("Downloaded from Vesper")
                setMimeType(mimeType)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Vesper/$filename")
                addRequestHeader("User-Agent", userAgent)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(false)
            }
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, "Downloading $filename", Toast.LENGTH_SHORT).show()
        }.onFailure {
            Toast.makeText(this, "Could not download: ${it.message}", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        pendingAudio?.deny()
        pendingAudio = null
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "dev.vesper.app.CONSOLE_URL"
        private const val REQUEST_MIC = 0x5647
    }
}
