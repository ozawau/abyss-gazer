package com.abyssgazer.desktop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PomodoroTimerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        PomodoroAndroid.onTimerAlarm(context.applicationContext)
    }
}
