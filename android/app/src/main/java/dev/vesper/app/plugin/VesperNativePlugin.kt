package dev.vesper.app.plugin

import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import dev.vesper.app.ConsoleActivity
import dev.vesper.app.runtime.NodeSupervisor
import dev.vesper.app.service.NodeService

/**
 * The only bridge between the boot screen and the device.
 *
 * Deliberately narrow: read status, install, start, stop, read logs, and open a
 * console URL. Nothing here can read your files or run an arbitrary command —
 * those live behind the agent's approval flow in the server.
 */
@CapacitorPlugin(name = "VesperNative")
class VesperNativePlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())

    private val statusListener: (NodeSupervisor.Status) -> Unit = { status ->
        main.post {
            if (bridge != null) notifyListeners("runtime", toJson(status))
        }
    }

    override fun load() {
        NodeSupervisor.attach(context)
        NodeSupervisor.addListener(statusListener)
    }

    override fun handleOnDestroy() {
        NodeSupervisor.removeListener(statusListener)
        super.handleOnDestroy()
    }

    @PluginMethod
    fun status(call: PluginCall) {
        NodeSupervisor.attach(context)
        call.resolve(toJson(NodeSupervisor.status()))
    }

    @PluginMethod
    fun deviceInfo(call: PluginCall) {
        val info = JSObject()
        info.put("arch", System.getProperty("os.arch") ?: "unknown")
        info.put("abi", android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
        info.put("sdk", android.os.Build.VERSION.SDK_INT)
        info.put("model", android.os.Build.MODEL ?: "android")
        info.put("package", context.packageName)
        call.resolve(info)
    }

    @PluginMethod
    fun install(call: PluginCall) {
        NodeSupervisor.install()
        call.resolve()
    }

    @PluginMethod
    fun start(call: PluginCall) {
        NodeSupervisor.start()
        runCatching {
            ContextCompat.startForegroundService(context, Intent(context, NodeService::class.java))
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        NodeSupervisor.stop()
        runCatching { context.stopService(Intent(context, NodeService::class.java)) }
        call.resolve()
    }

    @PluginMethod
    fun logs(call: PluginCall) {
        val limit = call.getInt("lines") ?: 200
        val payload = JSObject()
        payload.put("lines", JSArray(NodeSupervisor.logTail(limit)))
        call.resolve(payload)
    }

    @PluginMethod
    fun openConsole(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url is required")
        val intent = Intent(context, ConsoleActivity::class.java)
            .putExtra(ConsoleActivity.EXTRA_URL, url)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
            .onFailure { return call.reject("Could not open the console: ${it.message}") }
        call.resolve()
    }

    private fun toJson(status: NodeSupervisor.Status): JSObject = JSObject().apply {
        put("phase", status.phase.name.lowercase())
        put("detail", status.detail)
        put("progress", status.progress)
        put("nodeUrl", status.nodeUrl)
        put("installed", status.installed)
        put("running", status.phase == NodeSupervisor.Phase.RUNNING)
    }
}
