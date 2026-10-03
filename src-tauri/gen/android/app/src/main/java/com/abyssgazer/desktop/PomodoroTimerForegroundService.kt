package com.abyssgazer.desktop

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

/** Keeps the process alive so the notification chronometer stays accurate on aggressive OEMs. */
class PomodoroTimerForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                val endsAtMs = intent.getLongExtra(EXTRA_ENDS_AT_MS, 0L)
                val focusPhase = intent.getBooleanExtra(EXTRA_FOCUS_PHASE, true)
                val clock = intent.getStringExtra(EXTRA_CLOCK).orEmpty()
                val notification = PomodoroAndroid.buildTimerNotification(
                    this,
                    clock,
                    focusPhase,
                    paused = false,
                    endsAtMs = endsAtMs,
                )
                startForeground(PomodoroAndroid.NOTIFICATION_ID, notification)
                return START_STICKY
            }
        }
        return START_NOT_STICKY
    }

    companion object {
        private const val ACTION_START = "com.abyssgazer.desktop.action.POMODORO_TIMER_START"
        private const val ACTION_STOP = "com.abyssgazer.desktop.action.POMODORO_TIMER_STOP"
        private const val EXTRA_ENDS_AT_MS = "ends_at_ms"
        private const val EXTRA_FOCUS_PHASE = "focus_phase"
        private const val EXTRA_CLOCK = "clock"

        fun start(context: Context, endsAtMs: Long, focusPhase: Boolean, clock: String) {
            val app = context.applicationContext
            val intent = Intent(app, PomodoroTimerForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_ENDS_AT_MS, endsAtMs)
                putExtra(EXTRA_FOCUS_PHASE, focusPhase)
                putExtra(EXTRA_CLOCK, clock)
            }
            app.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val app = context.applicationContext
            app.startService(
                Intent(app, PomodoroTimerForegroundService::class.java).apply {
                    action = ACTION_STOP
                },
            )
        }
    }
}
