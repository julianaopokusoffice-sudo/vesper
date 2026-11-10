package dev.vesper.app.runtime

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Owns the lifetime of the Vesper node running inside PRoot: install it on
 * demand, start it, wait until it actually answers on the loopback API, and keep
 * the last lines of its output for the boot screen.
 *
 * State lives in a singleton because it must outlive the activity: the WebView
 * may be destroyed while the node keeps serving your laptop.
 */
object NodeSupervisor {
    enum class Phase { IDLE, INSTALLING, READY, STARTING, RUNNING, STOPPED, ERROR }

    data class Status(
        val phase: Phase = Phase.IDLE,
        val detail: String = "Checking this device…",
        val progress: Int = 0,
        val nodeUrl: String = ProotRuntime.LOOPBACK,
        val installed: Boolean = false,
    )

    private const val LOG_LIMIT = 400
    private const val BOOT_TIMEOUT_MS = 120_000L

    private val listeners = CopyOnWriteArrayList<(Status) -> Unit>()
    private val logs = ArrayDeque<String>()
    private val lock = Any()

    private var appContext: Context? = null
    private var worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "vesper-supervisor").apply { isDaemon = true }
    }
    private var process: Process? = null
    private var current = Status()

    fun attach(context: Context) {
        val app = context.applicationContext
        synchronized(lock) {
            if (appContext == null) {
                appContext = app
                current = current.copy(installed = ProotRuntime.isInstalled(app), phase = if (ProotRuntime.isInstalled(app)) Phase.READY else Phase.IDLE,
                    detail = if (ProotRuntime.isInstalled(app)) "Linux runtime installed." else "No Linux runtime yet.")
            }
        }
    }

    fun addListener(listener: (Status) -> Unit) {
        listeners += listener
    }

    fun removeListener(listener: (Status) -> Unit) {
        listeners -= listener
    }

    fun status(): Status {
        val context = appContext ?: return current
        return current.copy(installed = ProotRuntime.isInstalled(context))
    }

    fun logTail(limit: Int = 200): List<String> = synchronized(logs) {
        logs.toList().takeLast(limit.coerceIn(1, LOG_LIMIT))
    }

    fun install() {
        val context = appContext ?: return
        if (current.phase == Phase.INSTALLING) return
        update(Status(Phase.INSTALLING, "Preparing the installer…", 0, installed = current.installed))
        worker.execute {
            try {
                RuntimeInstaller(context).install { phase, percent ->
                    update(Status(Phase.INSTALLING, phase, percent, installed = true))
                }
                update(Status(Phase.READY, "Linux runtime installed. Start the console whenever you like.", 100, installed = true))
            } catch (err: Throwable) {
                appendLog("[install] ${err.message}")
                update(
                    Status(
                        Phase.ERROR,
                        err.message ?: "The runtime could not be installed.",
                        current.progress,
                        installed = ProotRuntime.isInstalled(context),
                    ),
                )
            }
        }
    }

    fun start() {
        val context = appContext ?: return
        if (current.phase == Phase.STARTING || current.phase == Phase.RUNNING) return
        worker.execute {
            if (!ProotRuntime.isInstalled(context)) {
                update(Status(Phase.ERROR, "Install the Linux runtime first.", 0, installed = false))
                return@execute
            }
            update(Status(Phase.STARTING, "Booting PRoot and the node runtime…", 100, installed = true))
            try {
                val command = ProotRuntime.nodeCommand(context)
                val builder = ProcessBuilder(command).directory(context.filesDir)
                builder.environment().putAll(ProotRuntime.environment(context))
                builder.redirectErrorStream(true)
                val started = builder.start()
                synchronized(lock) { process = started }
                pump(started)

                if (waitForHealth(started, BOOT_TIMEOUT_MS)) {
                    update(Status(Phase.RUNNING, "Node is live on this device.", 100, installed = true))
                } else {
                    val alive = started.isAlive
                    if (alive) started.destroy()
                    update(
                        Status(
                            Phase.ERROR,
                            if (alive) "The node did not answer within ${BOOT_TIMEOUT_MS / 1000}s. Open the log below."
                            else "The node exited during boot. Open the log below.",
                            100,
                            installed = true,
                        ),
                    )
                }
            } catch (err: Throwable) {
                appendLog("[start] ${err.message}")
                update(Status(Phase.ERROR, err.message ?: "Could not start the runtime.", 100, installed = true))
            }
        }
    }

    fun stop() {
        val running = synchronized(lock) { process }
        worker.execute {
            running?.let { proc ->
                proc.destroy()
                val deadline = System.currentTimeMillis() + 4000
                while (proc.isAlive && System.currentTimeMillis() < deadline) Thread.sleep(120)
                if (proc.isAlive) proc.destroyForcibly()
            }
            synchronized(lock) { process = null }
            update(Status(Phase.STOPPED, "Node stopped.", 100, installed = appContext?.let { ProotRuntime.isInstalled(it) } ?: false))
        }
    }

    // ---- internals -----------------------------------------------------------

    private fun update(next: Status) {
        current = next.copy(nodeUrl = ProotRuntime.LOOPBACK)
        for (listener in listeners) runCatching { listener(current) }
    }

    private fun appendLog(line: String) {
        synchronized(logs) {
            logs.addLast(line)
            while (logs.size > LOG_LIMIT) logs.removeFirst()
        }
    }

    private fun pump(proc: Process) {
        Thread {
            runCatching {
                proc.inputStream.bufferedReader().forEachLine { line ->
                    appendLog(line)
                    if (line.contains("Vesper") || line.contains("error", ignoreCase = true)) {
                        runCatching { listeners.forEach { it(current.copy(detail = line.take(160))) } }
                    }
                }
            }
        }.apply {
            name = "vesper-node-log"
            isDaemon = true
        }.start()
    }

    private fun waitForHealth(proc: Process, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (!proc.isAlive) return false
            if (healthy()) return true
            Thread.sleep(600)
        }
        return healthy()
    }

    private fun healthy(): Boolean = runCatching {
        val connection = URL("${ProotRuntime.LOOPBACK}/api/health").openConnection() as HttpURLConnection
        connection.connectTimeout = 800
        connection.readTimeout = 800
        try {
            connection.responseCode == 200
        } finally {
            connection.disconnect()
        }
    }.getOrDefault(false)

    /** Used by tests and by the service when the process outlives the UI. */
    fun isRunning(): Boolean = synchronized(lock) { process?.isAlive == true }

    fun stateFile(context: Context): File = File(ProotRuntime.runtimeDir(context), "installed")
}
