package dev.vesper.app.runtime

import android.content.Context
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Downloads and unpacks the Linux runtime. Every artifact is checked against the
 * SHA-256 in the manifest before it is extracted, so a mirror that serves
 * something else fails closed instead of producing a rootfs that later runs as
 * root inside PRoot.
 */
class RuntimeInstaller(private val context: Context) {

    fun interface Progress {
        fun report(phase: String, percent: Int)
    }

    fun install(progress: Progress) {
        val manifest = RuntimeManifest.load(context)
        val runtime = ProotRuntime.runtimeDir(context)
        val cache = File(context.cacheDir, "runtime-download")
        runtime.mkdirs()
        cache.mkdirs()

        val fetches = manifest.artifacts.size
        for ((index, artifact) in manifest.artifacts.withIndex()) {
            val file = File(cache, "vesper-${artifact.kind}.tar.gz")
            val base = (index.toDouble() / fetches * 70).toInt()
            val span = (70.0 / fetches).toInt().coerceAtLeast(4)
            if (file.exists() && sha256(file) == artifact.sha256) {
                progress.report("Using cached ${artifact.kind}.", base + span)
                continue
            }
            val asset = artifact.asset
            if (asset != null) {
                // Offline install: the runtime was packed into the APK at build
                // time, so there is nothing to download.
                progress.report("Unpacking ${label(artifact.kind)} from the app…", base)
                file.parentFile?.mkdirs()
                context.assets.open(asset).use { input ->
                    FileOutputStream(file).use { output -> input.copyTo(output) }
                }
                val actual = sha256(file)
                if (!actual.equals(artifact.sha256, ignoreCase = true)) {
                    file.delete()
                    throw IOException("The bundled ${artifact.kind} does not match its checksum. Rebuild the app.")
                }
            } else {
                progress.report("Downloading ${label(artifact.kind)}…", base)
                download(artifact, file) { fraction ->
                    progress.report(
                        "Downloading ${label(artifact.kind)} · ${(fraction * 100).toInt()}%",
                        base + (fraction * span).toInt(),
                    )
                }
            }
            progress.report("Verified ${artifact.kind} (sha256).", base + span)
        }

        progress.report("Unpacking the root filesystem…", 72)
        val rootfs = ProotRuntime.rootfs(context)
        unpackRootfs(manifest, cache, rootfs)

        progress.report("Installing the Node runtime…", 84)
        unpackNode(manifest, cache, rootfs)

        progress.report("Installing PRoot…", 89)
        installProot(manifest, cache)

        progress.report("Copying the Vesper payload…", 93)
        copyAssets("payload", File(rootfs, "opt/vesper"))

        progress.report("Configuring the guest…", 97)
        configureGuest(rootfs)

        File(runtime, "installed").writeText(manifest.stamp)
        File(context.filesDir, "runtime.json").writeText(
            runCatching { context.assets.open("runtime.json").bufferedReader().use { it.readText() } }
                .getOrElse { "{}" },
        )
        progress.report("Runtime ready.", 100)
    }

    // ---- download ------------------------------------------------------------

    private fun download(artifact: RuntimeArtifact, destination: File, onProgress: (Double) -> Unit) {
        destination.delete()
        val temp = File(destination.parentFile, "${destination.name}.part")
        temp.delete()

        val url = artifact.url ?: throw IOException("${artifact.kind} has no download URL")
        var connection = open(url)
        var redirects = 0
        while (connection.responseCode in 300..399 && redirects < 5) {
            val location = connection.getHeaderField("Location") ?: break
            connection.disconnect()
            connection = open(URL(URL(url), location).toString())
            redirects += 1
        }
        val response = connection.responseCode
        if (response !in 200..299) {
            connection.disconnect()
            throw IOException("HTTP $response while fetching $url")
        }

        val expected = connection.contentLengthLong
        var read = 0L
        connection.inputStream.use { input ->
            FileOutputStream(temp).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count <= 0) break
                    output.write(buffer, 0, count)
                    read += count
                    if (expected > 0) onProgress((read.toDouble() / expected).coerceIn(0.0, 1.0))
                }
            }
        }
        connection.disconnect()

        val actual = sha256(temp)
        if (!actual.equals(artifact.sha256, ignoreCase = true)) {
            temp.delete()
            throw IOException(
                "Checksum mismatch for ${artifact.kind}: expected ${artifact.sha256.take(12)}…, got ${actual.take(12)}…",
            )
        }
        if (!temp.renameTo(destination)) {
            temp.copyTo(destination, overwrite = true)
            temp.delete()
        }
        onProgress(1.0)
    }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 25_000
            readTimeout = 90_000
            setRequestProperty("User-Agent", "Vesper-Android/1.0")
        }

    // ---- extraction ----------------------------------------------------------

    private fun unpackRootfs(manifest: RuntimeManifest, cache: File, rootfs: File) {
        val artifact = manifest.of("rootfs") ?: throw IOException("No rootfs in the manifest")
        rootfs.mkdirs()
        val archive = File(cache, "vesper-${artifact.kind}.tar.gz")
        extract(archive, rootfs, strip = 0)
    }

    private fun unpackNode(manifest: RuntimeManifest, cache: File, rootfs: File) {
        val artifact = manifest.of("node") ?: throw IOException("No Node runtime in the manifest")
        val archive = File(cache, "vesper-${artifact.kind}.tar.gz")
        // Official Node tarballs wrap everything in node-vX.Y.Z-linux-arm64/.
        extract(archive, File(rootfs, "opt/node"), strip = 1)
    }

    private fun installProot(manifest: RuntimeManifest, cache: File) {
        val artifact = manifest.of("proot") ?: throw IOException("No PRoot binary in the manifest")
        val archive = File(cache, "vesper-${artifact.kind}.tar.gz")
        val binDir = File(ProotRuntime.runtimeDir(context), "bin")
        binDir.mkdirs()

        // A tar.gz is the most portable envelope: mirrors serve it and it keeps
        // the mode bits that tell us the binary should be executable.
        extract(archive, binDir, strip = 0)
        val proot = File(binDir, "proot")
        if (!proot.exists()) throw IOException("The PRoot archive did not contain a 'proot' binary")
        proot.setExecutable(true, false)
        File(binDir, "proot-loader").takeIf { it.exists() }?.setExecutable(true, false)
    }

    /**
     * Minimal tar.gz extractor. Symlinks and hard links are preserved because a
     * Debian/Ubuntu userland relies on them (`/bin/sh`, `node/bin/npm`), and
     * every entry is checked against the destination root so an archive cannot
     * write outside the app sandbox.
     */
    private fun extract(archive: File, destination: File, strip: Int) {
        if (!archive.exists()) throw IOException("Missing archive ${archive.name}")
        destination.mkdirs()
        val root = destination.canonicalFile

        TarArchiveInputStream(GzipCompressorInputStream(BufferedInputStream(FileInputStream(archive)))).use { tar ->
            var entry = tar.nextEntry
            while (entry != null) {
                val target = resolve(root, entry, strip)
                if (target != null) {
                    when {
                        entry.isSymbolicLink -> writeSymlink(target, entry.linkName)
                        entry.isLink -> copyLink(root, target, entry.linkName, strip)
                        entry.isDirectory -> target.mkdirs()
                        else -> writeFile(tar, target, entry)
                    }
                }
                entry = tar.nextEntry
            }
        }
    }

    private fun resolve(root: File, entry: TarArchiveEntry, strip: Int): File? {
        val parts = entry.name.trimStart('.', '/').split('/').filter { it.isNotEmpty() }
        if (parts.size <= strip) return null
        val relative = parts.drop(strip).joinToString("/")
        val target = File(root, relative).canonicalFile
        if (target != root && !target.path.startsWith(root.path + File.separator)) {
            throw IOException("Blocked archive entry outside the runtime: ${entry.name}")
        }
        return target
    }

    private fun writeFile(tar: TarArchiveInputStream, target: File, entry: TarArchiveEntry) {
        target.parentFile?.mkdirs()
        FileOutputStream(target).use { output -> tar.copyTo(output) }
        val mode = entry.mode
        if (mode and 0b001_001_001 != 0) target.setExecutable(true, false)
        if (mode and 0b110_000_000 != 0) target.setReadable(true, true)
    }

    private fun writeSymlink(target: File, linkName: String) {
        target.parentFile?.mkdirs()
        runCatching {
            if (target.exists()) target.delete()
            java.nio.file.Files.createSymbolicLink(target.toPath(), java.nio.file.Paths.get(linkName))
        }.onFailure {
            // Some Android volumes reject symlinks; a real copy is still correct.
            val from = File(target.parentFile, linkName)
            if (from.exists()) from.copyTo(target, overwrite = true)
        }
    }

    private fun copyLink(root: File, target: File, linkName: String, strip: Int) {
        val parts = linkName.trimStart('.', '/').split('/').filter { it.isNotEmpty() }
        val source = if (parts.size > strip) File(root, parts.drop(strip).joinToString("/")) else null
        if (source != null && source.exists()) {
            target.parentFile?.mkdirs()
            source.copyTo(target, overwrite = true)
        }
    }

    // ---- guest configuration -------------------------------------------------

    private fun configureGuest(rootfs: File) {
        // PRoot inherits the app's network but not Android's resolver, so the
        // guest gets explicit resolvers. Loopback stays first for local-only use.
        File(rootfs, "etc").mkdirs()
        File(rootfs, "etc/resolv.conf").writeText(
            """
            nameserver 1.1.1.1
            nameserver 9.9.9.9
            nameserver 8.8.8.8
            """.trimIndent() + "\n",
        )
        File(rootfs, "etc/hosts").writeText(
            """
            127.0.0.1 localhost vesper
            ::1 localhost
            """.trimIndent() + "\n",
        )
        File(rootfs, "root").mkdirs()
        File(rootfs, "root/.bashrc").writeText(
            """
            export PS1='\[\e[38;5;214m\]\u\[\e[0m\]:\[\e[38;5;245m\]\w\[\e[0m\]\$ '
            export PATH=/opt/node/bin:${'$'}PATH
            alias ll='ls -al --color=auto'
            cd /root/workspace 2>/dev/null || true
            """.trimIndent() + "\n",
        )
        File(rootfs, "etc/profile.d").mkdirs()
        File(rootfs, "etc/profile.d/vesper.sh").writeText(
            """
            export PATH=/opt/node/bin:${'$'}PATH
            export VESPER_HOME=/root/.vesper
            """.trimIndent() + "\n",
        )
        File(rootfs, "root/workspace").mkdirs()
        File(rootfs, "tmp").mkdirs()
    }

    // ---- assets --------------------------------------------------------------

    private fun copyAssets(assetPath: String, destination: File) {
        val children = context.assets.list(assetPath).orEmpty()
        if (children.isEmpty()) {
            destination.parentFile?.mkdirs()
            context.assets.open(assetPath).use { input ->
                FileOutputStream(destination).use { output -> input.copyTo(output) }
            }
            return
        }
        destination.mkdirs()
        for (child in children) copyAssets("$assetPath/$child", File(destination, child))
    }

    // ---- helpers -------------------------------------------------------------

    private fun label(kind: String): String = when (kind) {
        "rootfs" -> "the Linux root filesystem"
        "node" -> "the Node runtime"
        "proot" -> "PRoot"
        else -> kind
    }

    companion object {
        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val count = input.read(buffer)
                    if (count <= 0) break
                    digest.update(buffer, 0, count)
                }
            }
            return digest.digest().joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
        }
    }
}
