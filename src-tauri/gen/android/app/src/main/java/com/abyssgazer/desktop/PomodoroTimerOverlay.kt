package com.abyssgazer.desktop

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs

/** Floating countdown while timing and another app is in the foreground. */
internal object PomodoroTimerOverlay {
    private val handler = Handler(Looper.getMainLooper())
    private var appInForeground = true
    private var overlayView: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var askedOverlayPermission = false
    private var dragStartX = 0f
    private var dragStartY = 0f
    private var paramStartX = 0
    private var paramStartY = 0
    private var dragging = false
    private var lastTapAtMs = 0L
    private var tickEndsAtMs = 0L
    private var tickRunnable: Runnable? = null

    private const val DRAG_THRESHOLD_PX = 8
    private const val DOUBLE_TAP_WINDOW_MS = 320L

    fun onAppForegrounded() {
        handler.post {
            appInForeground = true
            removeOverlay()
        }
    }

    fun onAppBackgrounded(context: Context) {
        handler.post {
            appInForeground = false
            syncFromPrefs(context.applicationContext)
        }
    }

    fun sync(
        context: Context,
        active: Boolean,
        paused: Boolean,
        endsAtMs: Long,
        focusPhase: Boolean,
        clock: String,
    ) {
        handler.post {
            if (!active || paused) {
                removeOverlay()
                return@post
            }
            val running = endsAtMs > System.currentTimeMillis()
            if (!running) {
                removeOverlay()
                return@post
            }
            if (appInForeground) {
                removeOverlay()
                return@post
            }
            show(context.applicationContext, endsAtMs, focusPhase)
        }
    }

    fun refreshFromStoredState(context: Context) {
        handler.post { syncFromPrefs(context.applicationContext) }
    }

    private fun syncFromPrefs(context: Context) {
        val state = PomodoroTimerPrefs.read(context)
        sync(
            context,
            state.active,
            state.paused,
            state.endsAtMs,
            state.focusUi,
            state.clock,
        )
    }

    private fun show(context: Context, endsAtMs: Long, focusPhase: Boolean) {
        if (!Settings.canDrawOverlays(context)) {
            maybePromptOverlayPermission(context)
            return
        }
        val wm = context.getSystemService(WindowManager::class.java) ?: return
        val textColor = if (focusPhase) 0xFFDC2626.toInt() else 0xFF2563EB.toInt()
        val view = overlayView ?: LayoutInflater.from(context)
            .inflate(R.layout.overlay_pomodoro_timer, null)
            .also { root ->
                root.setOnTouchListener(dragTouchListener(context))
                overlayView = root
            }
        val clockView = view.findViewById<TextView>(R.id.pomodoro_overlay_clock)
        clockView.setTextColor(textColor)
        startOverlayTicks(clockView, endsAtMs)

        val params = layoutParams ?: defaultLayoutParams(context).also { layoutParams = it }
        if (view.parent == null) {
            wm.addView(view, params)
        } else {
            wm.updateViewLayout(view, params)
        }
    }

    private fun dragTouchListener(context: Context): View.OnTouchListener {
        return View.OnTouchListener { _, event ->
            val params = layoutParams ?: return@OnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    dragStartX = event.rawX
                    dragStartY = event.rawY
                    paramStartX = params.x
                    paramStartY = params.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - dragStartX).toInt()
                    val dy = (event.rawY - dragStartY).toInt()
                    if (!dragging && (abs(dx) > DRAG_THRESHOLD_PX || abs(dy) > DRAG_THRESHOLD_PX)) {
                        dragging = true
                    }
                    if (dragging) {
                        params.x = paramStartX + dx
                        params.y = paramStartY + dy
                        overlayView?.let { view ->
                            (view.context.getSystemService(WindowManager::class.java))
                                ?.updateViewLayout(view, params)
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragging) {
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastTapAtMs <= DOUBLE_TAP_WINDOW_MS) {
                            lastTapAtMs = 0L
                            openApp(context)
                        } else {
                            lastTapAtMs = now
                        }
                    }
                    dragging = false
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    dragging = false
                    true
                }
                else -> false
            }
        }
    }

    private fun openApp(context: Context) {
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        context.startActivity(open)
    }

    private fun defaultLayoutParams(context: Context): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val topInset = statusBarHeight(context)
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            x = 0
            y = topInset + dp(context, 6)
        }
    }

    private fun statusBarHeight(context: Context): Int {
        val id = context.resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) context.resources.getDimensionPixelSize(id) else dp(context, 24)
    }

    private fun dp(context: Context, value: Int): Int {
        return (value * context.resources.displayMetrics.density).toInt()
    }

    private fun startOverlayTicks(clockView: TextView, endsAtMs: Long) {
        stopOverlayTicks()
        tickEndsAtMs = endsAtMs
        val runnable = object : Runnable {
            override fun run() {
                val remainingMs = tickEndsAtMs - System.currentTimeMillis()
                if (remainingMs <= 0L) {
                    clockView.text = "00:00"
                    return
                }
                clockView.text = formatClockMs(remainingMs)
                handler.postDelayed(this, 1000L)
            }
        }
        tickRunnable = runnable
        runnable.run()
    }

    private fun stopOverlayTicks() {
        tickRunnable?.let { handler.removeCallbacks(it) }
        tickRunnable = null
        tickEndsAtMs = 0L
    }

    private fun formatClockMs(remainingMs: Long): String {
        val safe = (remainingMs / 1000L).coerceAtLeast(0L)
        val m = (safe / 60).toString().padStart(2, '0')
        val s = (safe % 60).toString().padStart(2, '0')
        return "$m:$s"
    }

    private fun removeOverlay() {
        stopOverlayTicks()
        val view = overlayView ?: return
        val wm = view.context.getSystemService(WindowManager::class.java) ?: return
        try {
            wm.removeView(view)
        } catch (_: IllegalArgumentException) {
        }
        overlayView = null
        layoutParams = null
    }

    private fun maybePromptOverlayPermission(context: Context) {
        if (askedOverlayPermission) return
        askedOverlayPermission = true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        ).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        Toast.makeText(context, context.getString(R.string.pomodoro_overlay_permission_hint), Toast.LENGTH_LONG).show()
        context.startActivity(intent)
    }
}
