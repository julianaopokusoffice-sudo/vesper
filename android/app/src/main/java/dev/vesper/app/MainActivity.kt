package dev.vesper.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import dev.vesper.app.plugin.VesperNativePlugin

/**
 * Hosts the boot screen (mobile/web). The console itself opens in
 * [ConsoleActivity] so this WebView — and with it the native bridge — survives.
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(VesperNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
