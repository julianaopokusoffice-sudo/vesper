package dev.vesper.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import dev.vesper.app.MainActivity
import dev.vesper.app.R

/**
 * Keeps the runtime alive while you use the console, and makes the node
 * discoverable: Android otherwise freezes or kills a background socket-holding
 * process, which would drop the link to your laptop mid-task.
 */
class NodeService : Service() {

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, notification())
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Vesper node",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps the agent runtime reachable from your other devices."
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Vesper is running")
        .setContentText("Your phone is serving the agent console on port 8787.")
        .setSmallIcon(R.drawable.ic_notification)
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setContentIntent(
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
        )
        .build()

    companion object {
        private const val CHANNEL_ID = "vesper-node"
        private const val NOTIFICATION_ID = 0x5645
    }
}
