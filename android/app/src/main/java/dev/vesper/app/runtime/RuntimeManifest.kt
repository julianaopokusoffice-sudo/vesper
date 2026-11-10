package dev.vesper.app.runtime

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Describes the three binaries the Linux runtime needs. They are never committed
 * to the repository: `npm run mobile:runtime` downloads them, hashes them, and
 * writes the manifest that ships inside the APK.
 *
 * `kind` is one of `rootfs` (Ubuntu base tar.gz), `node` (official linux-arm64
 * tar.gz), or `proot` (a statically linked proot binary).
 */
data class RuntimeArtifact(
    val kind: String,
    /** Present when the artifact is downloaded by the device. */
    val url: String?,
    /** Present when the artifact ships inside the APK (offline install). */
    val asset: String?,
    val sha256: String,
    val bytes: Long,
)

data class RuntimeManifest(
    val version: Int,
    val artifacts: List<RuntimeArtifact>,
    val notes: String? = null,
) {
    fun of(kind: String): RuntimeArtifact? = artifacts.firstOrNull { it.kind == kind }

    /** Changes whenever any pinned byte changes, so a stale install is redone. */
    val stamp: String
        get() = "v$version;${artifacts.joinToString(",") { "${it.kind}:${it.sha256.take(16)}" }}"

    companion object {
        private const val PLACEHOLDER = "0000000000000000000000000000000000000000000000000000000000000000"
        private val REQUIRED = listOf("rootfs", "proot", "node")

        fun load(context: Context): RuntimeManifest {
            val raw = readManifest(context)
                ?: error("No runtime manifest in this build. Run `npm run mobile:runtime`, then rebuild the app.")

            val root = runCatching { JSONObject(raw) }
                .getOrElse { error("runtime.json is not valid JSON: ${it.message}") }
            val array = root.optJSONArray("artifacts") ?: error("runtime.json has no artifacts[]")

            val artifacts = ArrayList<RuntimeArtifact>(array.length())
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                artifacts += RuntimeArtifact(
                    kind = item.getString("kind"),
                    url = item.optString("url").takeIf { it.isNotBlank() },
                    asset = item.optString("asset").takeIf { it.isNotBlank() },
                    sha256 = item.getString("sha256").trim().lowercase(),
                    bytes = item.optLong("bytes", 0L),
                )
            }

            for (artifact in artifacts) {
                if (artifact.sha256.length != 64 || artifact.sha256 == PLACEHOLDER) {
                    error(
                        "runtime.json has no checksum for '${artifact.kind}'. " +
                            "Vesper refuses to install an unverified binary.",
                    )
                }
                if (artifact.url != null && !artifact.url.startsWith("https://") && !artifact.url.startsWith("http://")) {
                    error("runtime.json has an unusable URL for '${artifact.kind}'.")
                }
                if (artifact.url == null && artifact.asset == null) {
                    error("runtime.json has neither a url nor an asset for '${artifact.kind}'.")
                }
            }

            val missing = REQUIRED.filter { kind -> artifacts.none { it.kind == kind } }
            require(missing.isEmpty()) { "runtime.json is missing: ${missing.joinToString()}" }

            return RuntimeManifest(
                version = root.optInt("version", 1),
                artifacts = artifacts,
                notes = root.optString("notes").takeIf { it.isNotBlank() },
            )
        }

        /** Prefer the manifest shipped in the APK; fall back to one pushed onto the device. */
        private fun readManifest(context: Context): String? {
            runCatching {
                context.assets.open("runtime.json").bufferedReader().use { return it.readText() }
            }
            val sidecar = File(context.filesDir, "runtime.json")
            if (sidecar.exists()) return sidecar.readText()
            return null
        }
    }
}
