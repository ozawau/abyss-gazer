package com.abyssgazer.desktop

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class CheckinWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        updateAll(context)
    }

    override fun onEnabled(context: Context) {
        scheduleMidnight(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            updateAll(context)
            scheduleMidnight(context)
            return
        }
        if (intent.action == ACTION_TOGGLE) {
            val habitId = intent.getStringExtra(EXTRA_HABIT_ID)
            if (!habitId.isNullOrEmpty()) {
                val message = CheckinBoard.toggleToday(context, habitId)
                if (!message.isNullOrEmpty()) {
                    Toast.makeText(context.applicationContext, message, Toast.LENGTH_SHORT).show()
                }
                updateAll(context)
                MainActivity.notifyCheckinChanged()
            }
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val EXTRA_OPEN_CHECKIN = "com.abyssgazer.desktop.extra.OPEN_CHECKIN"
        const val EXTRA_HABIT_ID = "com.abyssgazer.desktop.extra.HABIT_ID"
        private const val ACTION_REFRESH = "com.abyssgazer.desktop.action.CHECKIN_WIDGET_REFRESH"
        private const val ACTION_TOGGLE = "com.abyssgazer.desktop.action.CHECKIN_WIDGET_TOGGLE"

        @JvmStatic
        fun refresh(context: Context) {
            updateAll(context)
        }

        /** Opens the system dialog to pin the check-in widget on the home screen. */
        @JvmStatic
        fun requestPin(activity: Activity): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
            val manager = AppWidgetManager.getInstance(activity)
            if (!manager.isRequestPinAppWidgetSupported) return false
            val component = ComponentName(activity, CheckinWidgetProvider::class.java)
            return manager.requestPinAppWidget(component, null, null)
        }

        private fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, CheckinWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            for (id in ids) {
                manager.updateAppWidget(id, buildViews(context, id))
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list)
            }
            scheduleMidnight(context)
        }

        private fun buildViews(context: Context, widgetId: Int): RemoteViews {
            val board = CheckinBoard.load(context)
            val views = RemoteViews(context.packageName, R.layout.checkin_widget)
            views.setTextViewText(R.id.widget_title, board.title)
            views.setTextViewText(R.id.widget_date, board.dateLabel)
            views.setTextViewText(R.id.widget_summary, board.summary)
            views.setViewVisibility(
                R.id.widget_summary,
                if (board.summary.isEmpty()) View.GONE else View.VISIBLE,
            )
            views.setTextViewText(R.id.widget_nudge, board.nudge)
            views.setViewVisibility(
                R.id.widget_nudge,
                if (board.nudge.isEmpty()) View.GONE else View.VISIBLE,
            )
            views.setViewVisibility(
                R.id.widget_progress,
                if (board.total == 0) View.GONE else View.VISIBLE,
            )
            views.setProgressBar(
                R.id.widget_progress,
                board.total.coerceAtLeast(1),
                board.done,
                false,
            )
            views.setTextViewText(R.id.widget_empty, board.emptyMessage)
            val service = Intent(context, CheckinWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.widget_list, service)
            views.setEmptyView(R.id.widget_list, R.id.widget_empty)
            views.setPendingIntentTemplate(R.id.widget_list, toggleIntent(context))
            views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context))
            return views
        }

        private fun openAppIntent(context: Context): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(EXTRA_OPEN_CHECKIN, true)
            }
            return PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private fun toggleIntent(context: Context): PendingIntent {
            val intent = Intent(context, CheckinWidgetProvider::class.java).apply {
                action = ACTION_TOGGLE
            }
            return PendingIntent.getBroadcast(
                context,
                3,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
        }

        private fun scheduleMidnight(context: Context) {
            val alarm = context.getSystemService(AlarmManager::class.java) ?: return
            val intent = Intent(context, CheckinWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pending = PendingIntent.getBroadcast(
                context,
                2,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val next = Calendar.getInstance().apply {
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 1)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC, next.timeInMillis, pending)
            } else {
                alarm.set(AlarmManager.RTC, next.timeInMillis, pending)
            }
        }
    }
}

class CheckinWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return CheckinWidgetFactory(applicationContext)
    }
}

private class CheckinWidgetFactory(
    private val context: Context,
) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<CheckinRow> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        rows = CheckinBoard.load(context).rows
    }

    override fun onDestroy() {
        rows = emptyList()
    }

    override fun getCount(): Int = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val row = rows.getOrNull(position) ?: return sectionView("")
        return when (row) {
            is CheckinRow.Section -> sectionView(row.title)
            is CheckinRow.Habit -> habitView(row)
        }
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 2

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = false

    private fun sectionView(title: String): RemoteViews {
        return RemoteViews(context.packageName, R.layout.checkin_widget_section).apply {
            setTextViewText(R.id.widget_section, title)
            setOnClickFillInIntent(R.id.widget_section, Intent())
        }
    }

    private fun habitView(row: CheckinRow.Habit): RemoteViews {
        return RemoteViews(context.packageName, R.layout.checkin_widget_row).apply {
            setTextViewText(R.id.widget_mark, if (row.done) "✓" else "○")
            setTextColor(
                R.id.widget_mark,
                if (row.done) 0xFF2563EB.toInt() else 0xFFDC2626.toInt(),
            )
            setTextViewText(R.id.widget_task, row.title)
            setTextViewText(R.id.widget_streak, row.streakLabel)
            setOnClickFillInIntent(
                R.id.widget_row,
                Intent().putExtra(CheckinWidgetProvider.EXTRA_HABIT_ID, row.id),
            )
        }
    }
}

internal sealed class CheckinRow {
    data class Section(val title: String) : CheckinRow()
    data class Habit(
        val id: String,
        val title: String,
        val done: Boolean,
        val streakLabel: String,
    ) : CheckinRow()
}

internal data class CheckinBoard(
    val chinese: Boolean,
    val title: String,
    val dateLabel: String,
    val summary: String,
    val nudge: String,
    val emptyMessage: String,
    val done: Int,
    val total: Int,
    val rows: List<CheckinRow>,
) {
    companion object {
        private val gate = Any()

        internal fun load(context: Context): CheckinBoard {
            synchronized(gate) {
                val file = snapshotFile(context)
                val parsed = readSnapshot(file)
                return compose(parsed)
            }
        }

        fun toggleToday(context: Context, habitId: String): String? {
            synchronized(gate) {
                return toggleTodayLocked(context, habitId)
            }
        }

        private fun readSnapshot(file: File): Snapshot? {
            if (!file.isFile) return null
            return try {
                val json = JSONObject(file.readText())
                val language = json.optString("language", "system")
                val habitsJson = json.optJSONArray("habits")
                    ?: return Snapshot(language, json.optString("checkinCategoryName", ""), emptyList())
                val habits = buildList {
                    for (index in 0 until habitsJson.length()) {
                        val item = habitsJson.optJSONObject(index) ?: continue
                        val manual = item.optJSONArray("manualDays")
                        val focus = item.optJSONArray("focusStarts")
                        add(
                            HabitSnap(
                                id = item.optString("id"),
                                title = item.optString("title"),
                                createdAt = item.optLong("createdAt"),
                                manualDays = buildSet {
                                    if (manual != null) {
                                        for (day in 0 until manual.length()) {
                                            val value = manual.optString(day)
                                            if (value.isNotEmpty()) add(value)
                                        }
                                    }
                                },
                                focusStarts = buildList {
                                    if (focus != null) {
                                        for (start in 0 until focus.length()) {
                                            if (!focus.isNull(start)) add(focus.optLong(start))
                                        }
                                    }
                                },
                            ),
                        )
                    }
                }
                Snapshot(
                    language,
                    json.optString("checkinCategoryName", ""),
                    habits,
                )
            } catch (_: Exception) {
                null
            }
        }

        private fun compose(snapshot: Snapshot?): CheckinBoard {
            val zh = useChinese(snapshot?.language)
            val today = startOfDay(System.currentTimeMillis())
            val habits = snapshot?.habits.orEmpty().mapNotNull { habit ->
                val created = startOfDay(habit.createdAt)
                if (created > today) return@mapNotNull null
                val checkedDays = checkedDayKeys(habit)
                val todayKey = dayKey(today)
                val manualToday = habit.manualDays.contains(todayKey)
                val autoToday = habit.focusStarts.any { dayKey(it) == todayKey }
                val done = checkedDays.contains(todayKey)
                val (current, _) = streak(created, today) { day ->
                    checkedDays.contains(dayKey(day))
                }
                HabitToday(habit.id, habit.title, done, manualToday, autoToday, current)
            }
            val done = habits.count { it.done }
            val total = habits.size
            val left = total - done
            val perfect = perfectStreak(snapshot?.habits.orEmpty(), today)
            val rows = buildList {
                val open = habits.filter { !it.done }
                val finished = habits.filter { it.done }
                if (open.isNotEmpty()) {
                    add(CheckinRow.Section(if (zh) "未打卡" else "Still open"))
                    open.forEach { add(it.toRow(zh)) }
                }
                if (finished.isNotEmpty()) {
                    add(CheckinRow.Section(if (zh) "已打卡" else "Checked in"))
                    finished.forEach { add(it.toRow(zh)) }
                }
            }
            return CheckinBoard(
                chinese = zh,
                title = if (zh) "今日打卡" else "Check-in",
                dateLabel = dateLabel(today, zh),
                summary = if (total == 0) {
                    ""
                } else if (zh) {
                    "待打卡 $total · 已打卡 $done · 未打卡 $left"
                } else {
                    "$total today · $done done · $left open"
                },
                nudge = nudge(zh, total, left, perfect),
                emptyMessage = if (snapshot == null) {
                    if (zh) "打开一次 Abyss Gazer，这里会显示今天的打卡。" else "Open Abyss Gazer once to show today’s check-ins."
                } else {
                    val category = snapshot.checkinCategoryName.trim()
                    when {
                        category.isEmpty() -> if (zh) {
                            "请先在设置 → 任务里选择打卡分类。"
                        } else {
                            "Choose a check-in category in Settings → Tasks."
                        }
                        zh -> "还没有打卡任务。把父任务的分类设为「$category」。"
                        else -> "No check-in tasks yet. Set a parent task’s category to “$category”."
                    }
                },
                done = done,
                total = total,
                rows = rows,
            )
        }

        private fun nudge(zh: Boolean, total: Int, left: Int, perfect: Streak): String {
            if (total == 0) return ""
            if (left == 0) {
                return if (perfect.current > 0) {
                    if (zh) "今天全部完成，连续全勤 ${perfect.current} 天" else "All done today, ${perfect.current}-day perfect streak"
                } else {
                    if (zh) "今天全部完成" else "All done today"
                }
            }
            if (perfect.current > 0) {
                return if (zh) "还差 $left 个，连续全勤 ${perfect.current} 天" else "$left left, ${perfect.current}-day perfect streak"
            }
            if (perfect.best > 0) {
                return if (zh) "还差 $left 个，最长全勤 ${perfect.best} 天" else "$left left, best perfect streak ${perfect.best} days"
            }
            return if (zh) "还差 $left 个，今天打完就是第一天" else "$left left. Finish today to start a streak"
        }

        private fun perfectStreak(habits: List<HabitSnap>, today: Long): Streak {
            if (habits.isEmpty()) return Streak(0, 0)
            val applicable = habits.map { it to startOfDay(it.createdAt) }.filter { it.second <= today }
            if (applicable.isEmpty()) return Streak(0, 0)
            val earliest = applicable.minOf { it.second }
            val checked = applicable.associate { (habit, _) -> habit to checkedDayKeys(habit) }
            return streak(earliest, today) { day ->
                val due = applicable.filter { it.second <= day }
                due.isNotEmpty() && due.all { (habit, _) -> checked.getValue(habit).contains(dayKey(day)) }
            }.let { Streak(it.first, it.second) }
        }

        private fun checkedDayKeys(habit: HabitSnap): Set<String> {
            val days = habit.manualDays.toMutableSet()
            for (started in habit.focusStarts) days.add(dayKey(started))
            return days
        }

        private fun streak(start: Long, today: Long, isOn: (Long) -> Boolean): Pair<Int, Int> {
            var cursor = start
            if (cursor > today) return 0 to 0
            var run = 0
            var best = 0
            var current = 0
            while (cursor <= today) {
                if (isOn(cursor)) {
                    run += 1
                    if (run > best) best = run
                    current = run
                } else if (cursor != today) {
                    run = 0
                    current = 0
                }
                cursor = addDays(cursor, 1)
            }
            return current to best
        }

        private fun useChinese(language: String?): Boolean {
            return when (language) {
                "zh" -> true
                "en" -> false
                else -> Locale.getDefault().language.startsWith("zh")
            }
        }

        private fun dateLabel(today: Long, zh: Boolean): String {
            val calendar = Calendar.getInstance().apply { timeInMillis = today }
            if (!zh) {
                return SimpleDateFormat("MMM d, EEE", Locale.ENGLISH).format(Date(today))
            }
            val week = arrayOf("日", "一", "二", "三", "四", "五", "六")
            val weekIndex = calendar.get(Calendar.DAY_OF_WEEK) - 1
            return "${calendar.get(Calendar.MONTH) + 1}月${calendar.get(Calendar.DAY_OF_MONTH)}日 周${week[weekIndex]}"
        }

        private fun dayKey(ms: Long): String {
            return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ms))
        }

        private fun startOfDay(ms: Long): Long {
            return Calendar.getInstance().apply {
                timeInMillis = ms
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
        }

        private fun addDays(ms: Long, days: Int): Long {
            return Calendar.getInstance().apply {
                timeInMillis = ms
                add(Calendar.DAY_OF_YEAR, days)
            }.timeInMillis
        }

        private fun snapshotFile(context: Context): File {
            return File(context.dataDir, "checkin-widget.json")
        }

        private fun openCheckinForHabit(context: Context, habitId: String) {
            val intent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(CheckinWidgetProvider.EXTRA_OPEN_CHECKIN, true)
                putExtra(CheckinWidgetProvider.EXTRA_HABIT_ID, habitId)
            }
            context.startActivity(intent)
        }

        private fun toggleTodayLocked(context: Context, habitId: String): String? {
            val file = snapshotFile(context)
            if (!file.isFile) return null
            val json = try {
                JSONObject(file.readText())
            } catch (_: Exception) {
                return null
            }
            val habits = json.optJSONArray("habits") ?: return null
            val habit = (0 until habits.length())
                .mapNotNull { habits.optJSONObject(it) }
                .firstOrNull { it.optString("id") == habitId }
                ?: return null
            val zh = useChinese(json.optString("language", "system"))
            val title = habit.optString("title")
            val today = dayKey(System.currentTimeMillis())
            val manual = habit.optJSONArray("manualDays") ?: JSONArray().also {
                habit.put("manualDays", it)
            }
            val manualIndex = (0 until manual.length()).firstOrNull { manual.optString(it) == today }
            val focus = habit.optJSONArray("focusStarts")
            val auto = focus != null && (0 until focus.length()).any { index ->
                !focus.isNull(index) && dayKey(focus.optLong(index)) == today
            }
            if (auto && manualIndex == null) {
                openCheckinForHabit(context, habitId)
                return null
            }
            val db = openDatabase(context)
                ?: return if (zh) "还不能打卡，请先打开一次应用" else "Open the app once before checking in"
            val checkedIn = try {
                db.beginTransaction()
                try {
                    val exists = hasCheckin(db, habitId, today)
                    val result = if (exists) {
                        db.delete(
                            "habit_checkins",
                            "task_id = ? AND day = ?",
                            arrayOf(habitId, today),
                        )
                        try {
                            db.delete(
                                "habit_checkin_items",
                                "habit_id = ? AND day = ?",
                                arrayOf(habitId, today),
                            )
                        } catch (_: SQLiteException) {
                            // Older databases have no item table.
                        }
                        while (true) {
                            val index = (0 until manual.length()).firstOrNull {
                                manual.optString(it) == today
                            } ?: break
                            manual.remove(index)
                        }
                        false
                    } else {
                        insertCheckin(db, habitId, today)
                        if (manualIndex == null) manual.put(today)
                        true
                    }
                    db.setTransactionSuccessful()
                    result
                } finally {
                    db.endTransaction()
                }
            } catch (_: Exception) {
                return if (zh) "打卡没有写入" else "Couldn’t save the check-in"
            } finally {
                db.close()
            }
            try {
                writeSnapshot(file, json)
            } catch (_: Exception) {
                // The database already has the change. Opening the app rewrites the card.
            }
            return if (checkedIn) {
                if (zh) "已打卡「$title」" else "Checked in “$title”"
            } else if (zh) {
                "已取消「$title」"
            } else {
                "Cleared “$title”"
            }
        }

        private fun hasCheckin(db: SQLiteDatabase, habitId: String, day: String): Boolean {
            return db.rawQuery(
                "SELECT 1 FROM habit_checkins WHERE task_id = ? AND day = ? LIMIT 1",
                arrayOf(habitId, day),
            ).use { cursor -> cursor.moveToFirst() }
        }

        private fun insertCheckin(db: SQLiteDatabase, habitId: String, day: String) {
            val createdAt = System.currentTimeMillis()
            try {
                db.execSQL(
                    "INSERT INTO habit_checkins (task_id, day, created_at, note) VALUES (?, ?, ?, '')",
                    arrayOf(habitId, day, createdAt),
                )
            } catch (_: SQLiteException) {
                db.execSQL(
                    "INSERT INTO habit_checkins (task_id, day, created_at) VALUES (?, ?, ?)",
                    arrayOf(habitId, day, createdAt),
                )
            }
        }

        private fun openDatabase(context: Context): SQLiteDatabase? {
            val path = databaseFile(context) ?: return null
            return try {
                val db = SQLiteDatabase.openDatabase(
                    path.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READWRITE,
                )
                db.rawQuery("PRAGMA busy_timeout = 3000", null).close()
                db
            } catch (_: SQLiteException) {
                null
            }
        }

        private fun databaseFile(context: Context): File? {
            val config = File(context.dataDir, "system.json")
            if (config.isFile) {
                try {
                    val custom = JSONObject(config.readText()).optString("dataDir")
                    if (custom.isNotEmpty()) {
                        val file = File(custom, "abyss.db")
                        if (file.isFile) return file
                    }
                } catch (_: Exception) {
                    // Fall back to the default database beside the snapshot.
                }
            }
            val fallback = File(context.dataDir, "abyss.db")
            return if (fallback.isFile) fallback else null
        }

        private fun writeSnapshot(file: File, json: JSONObject) {
            val tmp = File(file.parentFile, "checkin-widget.json.tmp")
            tmp.writeText(json.toString())
            if (!tmp.renameTo(file)) {
                file.writeText(json.toString())
                tmp.delete()
            }
        }
    }
}

private data class Snapshot(
    val language: String,
    val checkinCategoryName: String,
    val habits: List<HabitSnap>,
)

private data class HabitSnap(
    val id: String,
    val title: String,
    val createdAt: Long,
    val manualDays: Set<String>,
    val focusStarts: List<Long>,
)

private data class HabitToday(
    val id: String,
    val title: String,
    val done: Boolean,
    val manualToday: Boolean,
    val autoToday: Boolean,
    val current: Int,
) {
    fun toRow(zh: Boolean): CheckinRow.Habit {
        val streak = when {
            manualToday && zh -> "连续 $current 天 · 点按取消"
            manualToday -> "$current-day streak · tap to clear"
            autoToday && done && zh -> "番茄钟已打卡 · 点按打开应用"
            autoToday && done -> "Pomodoro check-in · tap to open app"
            done && zh -> "连续 $current 天"
            done -> "$current-day streak"
            current > 0 && zh -> "已连续 $current 天 · 点按打卡"
            current > 0 -> "$current-day streak · tap to check in"
            zh -> "点按打卡"
            else -> "Tap to check in"
        }
        return CheckinRow.Habit(id, title, done, streak)
    }
}

private data class Streak(val current: Int, val best: Int)
