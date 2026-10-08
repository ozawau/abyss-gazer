package com.abyssgazer.desktop

import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
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
    const val NOTIFICATION_ID = 4101
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
        endsAtMs: Long,
        timerPhase: String,
        autoBreakAfterFocus: Boolean,
        breakSecondsAfterFocus: Long,
        autoFocusAfterBreak: Boolean,
        focusSecondsAfterBreak: Long,
    ) {
        val context = activity.applicationContext
        syncTimerNotification(
            context,
            clock,
            focusPhase,
            active,
            paused,
            endsAtMs,
            timerPhase,
            autoBreakAfterFocus,
            breakSecondsAfterFocus,
            autoFocusAfterBreak,
            focusSecondsAfterBreak,
        )
    }

    @JvmStatic
    fun syncTimerNotification(
        context: Context,
        clock: String,
        focusPhase: Boolean,
        active: Boolean,
        paused: Boolean,
        endsAtMs: Long,
        timerPhase: String,
        autoBreakAfterFocus: Boolean,
        breakSecondsAfterFocus: Long,
        autoFocusAfterBreak: Boolean,
        focusSecondsAfterBreak: Long,
    ) {
        if (!active) {
            cancelTimerAlarm(context)
            PomodoroTimerPrefs.clear(context)
            PomodoroTimerForegroundService.stop(context)
            clearTimerNotification(context)
            PomodoroTimerOverlay.sync(context, false, false, 0L, true, "")
            return
        }
        if (!canPostNotifications(context)) return
        ensureChannel(context)
        val endsAt = resolveEndsAtMs(clock, endsAtMs, paused)
        val phase = timerPhase.ifBlank { if (focusPhase) "focus" else "break" }
        val existing = PomodoroTimerPrefs.read(context)
        if (
            existing.active &&
            !existing.paused &&
            existing.endsAtMs > System.currentTimeMillis() &&
            (existing.phase == "break" || existing.phase == "long_break") &&
            phase == "focus" &&
            endsAt <= System.currentTimeMillis()
        ) {
            scheduleTimerAlarm(context, existing.endsAtMs)
            val displayClock = formatClockMs(existing.endsAtMs - System.currentTimeMillis())
            val notification = buildTimerNotification(
                context,
                displayClock,
                existing.focusUi,
                paused = false,
                existing.endsAtMs,
            )
            PomodoroTimerForegroundService.start(context, existing.endsAtMs, existing.focusUi, displayClock)
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            PomodoroTimerOverlay.sync(context, true, false, existing.endsAtMs, existing.focusUi, displayClock)
            return
        }
        if (
            existing.active &&
            !existing.paused &&
            existing.endsAtMs > System.currentTimeMillis() &&
            existing.phase == "focus" &&
            (phase == "break" || phase == "long_break") &&
            endsAt <= System.currentTimeMillis()
        ) {
            scheduleTimerAlarm(context, existing.endsAtMs)
            val displayClock = formatClockMs(existing.endsAtMs - System.currentTimeMillis())
            val notification = buildTimerNotification(
                context,
                displayClock,
                focusPhase = true,
                paused = false,
                existing.endsAtMs,
            )
            PomodoroTimerForegroundService.start(context, existing.endsAtMs, true, displayClock)
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            PomodoroTimerOverlay.sync(context, true, false, existing.endsAtMs, true, displayClock)
            return
        }
        PomodoroTimerPrefs.save(
            context,
            endsAt,
            phase,
            paused,
            active,
            focusPhase,
            clock,
            autoBreakAfterFocus,
            breakSecondsAfterFocus,
            autoFocusAfterBreak,
            focusSecondsAfterBreak,
        )
        if (!paused && endsAt > 0L && endsAt <= System.currentTimeMillis()) {
            onSegmentExpired(context)
            return
        }
        if (!paused && endsAt > System.currentTimeMillis()) {
            scheduleTimerAlarm(context, endsAt)
        } else {
            cancelTimerAlarm(context)
        }
        val runningCountdown = !paused && endsAt > System.currentTimeMillis()
        val displayClock = if (runningCountdown) clock else formatClockMs((endsAt - System.currentTimeMillis()).coerceAtLeast(0L))
        val notification = buildTimerNotification(context, displayClock, focusPhase, paused, endsAt)
        if (runningCountdown) {
            PomodoroTimerForegroundService.start(context, endsAt, focusPhase, displayClock)
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } else {
            PomodoroTimerForegroundService.stop(context)
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        }
        PomodoroTimerOverlay.sync(context, active, paused, endsAt, focusPhase, displayClock)
    }

    internal fun onTimerAlarm(context: Context) {
        onSegmentExpired(context)
    }

    private fun onSegmentExpired(context: Context) {
        val state = PomodoroTimerPrefs.read(context)
        if (!state.active || state.paused) return
        if (state.endsAtMs > System.currentTimeMillis()) {
            scheduleTimerAlarm(context, state.endsAtMs)
            return
        }
        if (state.handledEndsAtMs == state.endsAtMs) return
        PomodoroTimerPrefs.markHandled(context, state.endsAtMs)
        when (state.phase) {
            "focus" -> {
                if (state.autoBreakAfterFocus && state.breakSecondsAfterFocus > 0L) {
                    val breakEnds = System.currentTimeMillis() + state.breakSecondsAfterFocus * 1000L
                    val breakClock = formatClockMs(state.breakSecondsAfterFocus * 1000L)
                    PomodoroTimerPrefs.save(
                        context,
                        breakEnds,
                        "break",
                        paused = false,
                        active = true,
                        focusUi = false,
                        clock = breakClock,
                        autoBreakAfterFocus = state.autoBreakAfterFocus,
                        breakSecondsAfterFocus = state.breakSecondsAfterFocus,
                        autoFocusAfterBreak = state.autoFocusAfterBreak,
                        focusSecondsAfterBreak = state.focusSecondsAfterBreak,
                    )
                    scheduleTimerAlarm(context, breakEnds)
                    val notification = buildTimerNotification(context, breakClock, focusPhase = false, paused = false, breakEnds)
                    PomodoroTimerForegroundService.start(context, breakEnds, false, breakClock)
                    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
                } else {
                    cancelTimerAlarm(context)
                    PomodoroTimerPrefs.clear(context)
                    PomodoroTimerForegroundService.stop(context)
                    clearTimerNotification(context)
                }
            }
            "break", "long_break" -> {
                if (state.autoFocusAfterBreak && state.focusSecondsAfterBreak > 0L) {
                    val focusEnds = System.currentTimeMillis() + state.focusSecondsAfterBreak * 1000L
                    val focusClock = formatClockMs(state.focusSecondsAfterBreak * 1000L)
                    PomodoroTimerPrefs.save(
                        context,
                        focusEnds,
                        "focus",
                        paused = false,
                        active = true,
                        focusUi = true,
                        clock = focusClock,
                        autoBreakAfterFocus = state.autoBreakAfterFocus,
                        breakSecondsAfterFocus = state.breakSecondsAfterFocus,
                        autoFocusAfterBreak = state.autoFocusAfterBreak,
                        focusSecondsAfterBreak = state.focusSecondsAfterBreak,
                    )
                    scheduleTimerAlarm(context, focusEnds)
                    val notification = buildTimerNotification(context, focusClock, focusPhase = true, paused = false, focusEnds)
                    PomodoroTimerForegroundService.start(context, focusEnds, true, focusClock)
                    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
                } else {
                    cancelTimerAlarm(context)
                    PomodoroTimerPrefs.clear(context)
                    PomodoroTimerForegroundService.stop(context)
                    clearTimerNotification(context)
                }
            }
            else -> {
                cancelTimerAlarm(context)
                PomodoroTimerPrefs.clear(context)
                PomodoroTimerForegroundService.stop(context)
                clearTimerNotification(context)
            }
        }
        PomodoroTimerOverlay.refreshFromStoredState(context)
    }

    private fun scheduleTimerAlarm(context: Context, endsAtMs: Long) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = Intent(context, PomodoroTimerAlarmReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        cancelTimerAlarm(context)
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAtMs, pi)
    }

    private fun cancelTimerAlarm(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = Intent(context, PomodoroTimerAlarmReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        am.cancel(pi)
    }

    private fun formatClockMs(remainingMs: Long): String {
        val safe = (remainingMs / 1000L).coerceAtLeast(0L)
        val m = (safe / 60).toString().padStart(2, '0')
        val s = (safe % 60).toString().padStart(2, '0')
        return "$m:$s"
    }

    private const val ALARM_REQUEST_CODE = 4102

    internal fun buildTimerNotification(
        context: Context,
        clock: String,
        focusPhase: Boolean,
        paused: Boolean,
        endsAtMs: Long,
    ): android.app.Notification {
        ensureChannel(context)
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val color = if (focusPhase) 0xFFDC2626.toInt() else 0xFF2563EB.toInt()
        val runningCountdown = !paused && endsAtMs > System.currentTimeMillis()
        val content = RemoteViews(context.packageName, R.layout.notification_pomodoro_timer).apply {
            if (runningCountdown) {
                val base = SystemClock.elapsedRealtime() + (endsAtMs - System.currentTimeMillis())
                setChronometerCountDown(R.id.pomodoro_timer_clock, true)
                setChronometer(R.id.pomodoro_timer_clock, base, null, true)
            } else {
                setChronometerCountDown(R.id.pomodoro_timer_clock, false)
                setChronometer(R.id.pomodoro_timer_clock, 0, null, false)
                setTextViewText(R.id.pomodoro_timer_clock, clock)
            }
            setTextColor(R.id.pomodoro_timer_clock, color)
        }
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setCustomContentView(content)
            .setCustomBigContentView(content)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setContentIntent(open)
            .setOngoing(!paused)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setColorized(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    private fun resolveEndsAtMs(clock: String, endsAtMs: Long, paused: Boolean): Long {
        if (paused) return 0L
        if (endsAtMs > 0L) return endsAtMs
        val seconds = parseClockSeconds(clock) ?: return 0L
        if (seconds <= 0) return 0L
        return System.currentTimeMillis() + seconds * 1000L
    }

    private fun parseClockSeconds(clock: String): Int? {
        val parts = clock.trim().split(":")
        if (parts.size != 2) return null
        val minutes = parts[0].toIntOrNull() ?: return null
        val seconds = parts[1].toIntOrNull() ?: return null
        return minutes * 60 + seconds
    }

    @JvmStatic
    fun clearTimerNotification(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
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
