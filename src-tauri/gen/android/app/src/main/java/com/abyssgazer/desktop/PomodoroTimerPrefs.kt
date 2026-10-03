package com.abyssgazer.desktop

import android.content.Context

internal object PomodoroTimerPrefs {
    private const val FILE = "pomodoro_timer_state"
    private const val KEY_ENDS_AT = "ends_at_ms"
    private const val KEY_PHASE = "phase"
    private const val KEY_PAUSED = "paused"
    private const val KEY_ACTIVE = "active"
    private const val KEY_FOCUS_UI = "focus_ui"
    private const val KEY_CLOCK = "clock"
    private const val KEY_AUTO_BREAK = "auto_break_after_focus"
    private const val KEY_BREAK_SEC = "break_seconds_after_focus"
    private const val KEY_AUTO_FOCUS = "auto_focus_after_break"
    private const val KEY_FOCUS_SEC = "focus_seconds_after_break"
    private const val KEY_HANDLED_ENDS_AT = "handled_ends_at_ms"

    fun save(
        context: Context,
        endsAtMs: Long,
        phase: String,
        paused: Boolean,
        active: Boolean,
        focusUi: Boolean,
        clock: String,
        autoBreakAfterFocus: Boolean,
        breakSecondsAfterFocus: Long,
        autoFocusAfterBreak: Boolean,
        focusSecondsAfterBreak: Long,
    ) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putLong(KEY_ENDS_AT, endsAtMs)
            .putString(KEY_PHASE, phase)
            .putBoolean(KEY_PAUSED, paused)
            .putBoolean(KEY_ACTIVE, active)
            .putBoolean(KEY_FOCUS_UI, focusUi)
            .putString(KEY_CLOCK, clock)
            .putBoolean(KEY_AUTO_BREAK, autoBreakAfterFocus)
            .putLong(KEY_BREAK_SEC, breakSecondsAfterFocus)
            .putBoolean(KEY_AUTO_FOCUS, autoFocusAfterBreak)
            .putLong(KEY_FOCUS_SEC, focusSecondsAfterBreak)
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun read(context: Context): State {
        val p = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        return State(
            endsAtMs = p.getLong(KEY_ENDS_AT, 0L),
            phase = p.getString(KEY_PHASE, "focus") ?: "focus",
            paused = p.getBoolean(KEY_PAUSED, false),
            active = p.getBoolean(KEY_ACTIVE, false),
            focusUi = p.getBoolean(KEY_FOCUS_UI, true),
            clock = p.getString(KEY_CLOCK, "00:00") ?: "00:00",
            autoBreakAfterFocus = p.getBoolean(KEY_AUTO_BREAK, false),
            breakSecondsAfterFocus = p.getLong(KEY_BREAK_SEC, 0L),
            autoFocusAfterBreak = p.getBoolean(KEY_AUTO_FOCUS, false),
            focusSecondsAfterBreak = p.getLong(KEY_FOCUS_SEC, 0L),
            handledEndsAtMs = p.getLong(KEY_HANDLED_ENDS_AT, 0L),
        )
    }

    fun markHandled(context: Context, endsAtMs: Long) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putLong(KEY_HANDLED_ENDS_AT, endsAtMs)
            .apply()
    }

    data class State(
        val endsAtMs: Long,
        val phase: String,
        val paused: Boolean,
        val active: Boolean,
        val focusUi: Boolean,
        val clock: String,
        val autoBreakAfterFocus: Boolean,
        val breakSecondsAfterFocus: Long,
        val autoFocusAfterBreak: Boolean,
        val focusSecondsAfterBreak: Long,
        val handledEndsAtMs: Long,
    )
}
