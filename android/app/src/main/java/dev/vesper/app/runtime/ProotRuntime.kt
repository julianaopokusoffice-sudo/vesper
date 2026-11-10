package dev.vesper.app.runtime

import android.content.Context
import java.io.File

/**
 * Where the Linux runtime lives and how it is launched.
 *
 * PRoot runs unprivileged: it uses ptrace to translate paths and fake uid 0, so
 * a normal app can own a Debian/Ubuntu userland without a rooted device. The
 * guest sees the app's private storage as `/root`, and `server.mjs` binds to the
 * LAN so paired devices can reach it.
 */
object ProotRuntime {
    const val PORT = 8787
    const val LOOPBACK = "http://127.0.0.1:$PORT"

    fun runtimeDir(context: Context) = File(context.filesDir, "runtime")
    fun rootfs(context: Context) = File(runtimeDir(context), "rootfs")
    fun prootBin(context: Context) = File(runtimeDir(context), "bin/proot")
    fun tmpDir(context: Context) = File(runtimeDir(context), "tmp")

    /** The guest mounts this at /root/.vesper, so a reinstall keeps your state. */
    fun homeDir(context: Context) = File(context.filesDir, "vesper")

    /** The guest mounts this at /root/workspace: the files tools and agents edit. */
    fun workspaceDir(context: Context) = File(context.filesDir, "workspace")

    fun isInstalled(context: Context): Boolean {
        val root = rootfs(context)
        return File(root, "bin/sh").exists() &&
            File(root, "opt/node/bin/node").exists() &&
            File(root, "opt/vesper/server/server.mjs").exists() &&
            prootBin(context).canExecute()
    }

    fun prepareDirs(context: Context) {
        for (dir in listOf(
            runtimeDir(context),
            tmpDir(context),
            homeDir(context),
            workspaceDir(context),
            File(runtimeDir(context), "bin"),
        )) {
            if (!dir.exists()) dir.mkdirs()
        }
    }

    /**
     * PRoot needs a writable temp directory and, on a handful of devices, must
     * skip seccomp acceleration to start at all. Both are set explicitly so the
     * behaviour does not depend on the shell that happens to launch us.
     */
    fun environment(context: Context): Map<String, String> = mapOf(
        "PROOT_TMP_DIR" to tmpDir(context).absolutePath,
        "PROOT_NO_SECCOMP" to "1",
        "PROOT_VERBOSE" to "0",
    )

    fun nodeCommand(context: Context): List<String> {
        prepareDirs(context)
        val root = rootfs(context).absolutePath
        return buildList {
            add(prootBin(context).absolutePath)
            // Hard links inside the guest become symlinks: Android's storage
            // supports them and apt/npm both create hard links.
            add("--link2symlink")
            add("-0")
            add("-r"); add(root)
            add("-b"); add("/dev")
            add("-b"); add("/proc")
            add("-b"); add("/sys")
            add("-b"); add("${tmpDir(context).absolutePath}:/tmp")
            add("-b"); add("${homeDir(context).absolutePath}:/root/.vesper")
            add("-b"); add("${workspaceDir(context).absolutePath}:/root/workspace")
            add("-w"); add("/opt/vesper")
            add("/usr/bin/env")
            add("HOME=/root")
            add("PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
            add("LANG=C.UTF-8")
            add("LC_ALL=C.UTF-8")
            add("TERM=dumb")
            add("NODE_ENV=production")
            add("VESPER_HOST=0.0.0.0")
            add("VESPER_PORT=$PORT")
            add("VESPER_NODE_KIND=phone")
            add("VESPER_HOME=/root/.vesper")
            add("VESPER_WORKSPACE=/root/workspace")                add("/opt/node/bin/node")
                // Bundled two directories below the app root: paths.ts derives
                // the data/ directory from `import.meta.url` at ../../.
                add("/opt/vesper/server/server.mjs")
        }
    }
}
