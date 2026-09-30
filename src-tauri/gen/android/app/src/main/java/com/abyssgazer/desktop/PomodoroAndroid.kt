package com.abyssgazer.desktop

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.security.MessageDigest

object PomodoroAndroid {
    private const val CHANNEL_ID = "pomodoro_timer"
    private const val NOTIFICATION_ID = 4101
    private const val MAX_SOUND_BYTES = 5 * 1024 * 1024

    @JvmStatic
    fun readSoundBytes(activity: Activity, path: String): ByteArray {
        val trimmed = path.trim()
        if (trimmed.isEmpty()) throw IllegalArgumentException("路径为空")
        val bytes = when {
            trimmed.startsWith("content://") || trimmed.startsWith("file://") -> {
                val uri = Uri.parse(trimmed)
                activity.contentResolver.openInputStream(uri)?.use { stream ->
                    stream.readBytes()
                } ?: throw IllegalArgumentException("无法打开所选文件")
            }
            else -> {
                val file = File(trimmed)
                if (!file.isFile) throw IllegalArgumentException("文件不存在")
                file.readBytes()
            }
        }
        if (bytes.isEmpty()) throw IllegalArgumentException("文件为空")
        if (bytes.size > MAX_SOUND_BYTES) throw IllegalArgumentException("音频文件不能超过 5MB")
        return bytes
    }

    @JvmStatic
    fun persistSoundFile(activity: Activity, source: String): String {
        val trimmed = source.trim()
        if (trimmed.isEmpty()) throw IllegalArgumentException("路径为空")
        val internal = File(activity.filesDir, "custom_sounds")
        internal.mkdirs()
        val ext = soundExtension(trimmed)
        val key = MessageDigest.getInstance("SHA-256")
            .digest(trimmed.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(16)
        val dest = File(internal, "$key.$ext")
        if (dest.isFile && dest.length() > 0) return dest.absolutePath
        dest.writeBytes(readSoundBytes(activity, trimmed))
        return dest.absolutePath
    }

    @JvmStatic
    fun vibrateEnd(activity: Activity) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = activity.getSystemService(VibratorManager::class.java)
            manager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        } ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!vibrator.hasVibrator()) return
            val timings = longArrayOf(0, 220, 90, 260, 90, 280)
            val amplitudes = intArrayOf(0, 255, 0, 255, 0, 255)
            vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(longArrayOf(0, 220, 90, 260, 90, 280), -1)
        }
    }

    @JvmStatic
    fun updateTimerNotification(
        activity: Activity,
        clock: String,
        focusPhase: Boolean,
        active: Boolean,
        paused: Boolean,
    ) {
        if (!active) {
            clearTimerNotification(activity)
            return
        }
        if (!canPostNotifications(activity)) return
        ensureChannel(activity)
        val open = PendingIntent.getActivity(
            activity,
            0,
            Intent(activity, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val color = if (focusPhase) 0xFFDC2626.toInt() else 0xFF2563EB.toInt()
        val content = RemoteViews(activity.packageName, R.layout.notification_pomodoro_timer).apply {
            setTextViewText(R.id.pomodoro_timer_clock, clock)
            setTextColor(R.id.pomodoro_timer_clock, color)
        }
        val builder = NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setCustomContentView(content)
            .setCustomBigContentView(content)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setContentIntent(open)
            .setOngoing(!paused)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        NotificationManagerCompat.from(activity).notify(NOTIFICATION_ID, builder.build())
    }

    @JvmStatic
    fun clearTimerNotification(activity: Activity) {
        NotificationManagerCompat.from(activity).cancel(NOTIFICATION_ID)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.pomodoro_notification_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.pomodoro_notification_channel_desc)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun canPostNotifications(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun soundExtension(path: String): String {
        val name = when {
            path.startsWith("content://") || path.startsWith("file://") -> {
                Uri.parse(path).lastPathSegment.orEmpty()
            }
            else -> File(path).name
        }
        val ext = name.substringAfterLast('.', "").lowercase()
        return if (ext == "wav" || ext == "mp3") ext else "mp3"
    }
}
