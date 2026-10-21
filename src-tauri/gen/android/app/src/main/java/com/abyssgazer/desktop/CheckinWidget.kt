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
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
        ensureWatching(context)
        scheduleMidnight(context)
    }

    override fun onDisabled(context: Context) {
        stopWatching()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            ensureWatching(context)
            updateAll(context)
            scheduleMidnight(context)
            return
        }
        if (intent.action == ACTION_TOGGLE) {
            val habitId = intent.getStringExtra(EXTRA_HABIT_ID)
            if (!habitId.isNullOrEmpty()) {
                // Launchers re-deliver collection clicks when the list rebinds
                // under the finger. Ignore any toggle for a short window after
                // the last one (all habits — not just the same id).
                if (CheckinBoard.shouldIgnoreRapidToggle(habitId)) {
                    return
                }
                val appCtx = context.applicationContext
                // Block Rust snapshot publisher + FileObserver while the tap
                // settles, otherwise a stale publish rewrites 2 done → 1 done.
                CheckinBoard.markToggleQuiet(appCtx)
                suppressWatcherRefreshUntil(
                    SystemClock.elapsedRealtime() + CheckinBoard.TOGGLE_QUIET_MS,
                )
                val message = CheckinBoard.toggleToday(appCtx, habitId)
                if (!message.isNullOrEmpty()) {
                    Toast.makeText(appCtx, message, Toast.LENGTH_SHORT).show()
                }
                // Header only — rebinding the list mid-tap re-delivers the click.
                updateCountsOnly(appCtx)
                mainHandler.postDelayed({
                    updateAll(appCtx)
                    MainActivity.notifyCheckinChanged()
                }, CheckinBoard.LIST_REFRESH_DELAY_MS)
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

        private val watcherLock = Any()
        private val mainHandler = Handler(Looper.getMainLooper())
        private var snapshotWatcher: FileObserver? = null
        private val refreshRunnable = Runnable {
            if (SystemClock.elapsedRealtime() < suppressWatcherUntilElapsed) return@Runnable
            val ctx = watcherContext ?: return@Runnable
            updateAll(ctx)
        }
        @Volatile private var watcherContext: Context? = null
        @Volatile private var suppressWatcherUntilElapsed: Long = 0L

        private fun suppressWatcherRefreshUntil(elapsedRealtimeDeadline: Long) {
            suppressWatcherUntilElapsed = elapsedRealtimeDeadline
            mainHandler.removeCallbacks(refreshRunnable)
        }

        @JvmStatic
        fun refresh(context: Context) {
            val appCtx = context.applicationContext
            ensureWatching(appCtx)
            updateAll(appCtx)
        }

        /**
         * Watch the snapshot file so in-app check-ins still redraw the card.
         * Do not watch the SQLite files: journal traffic mid-toggle rebinds the
         * list under the finger and undoes the tap on several OEMs.
         */
        @JvmStatic
        fun ensureWatching(context: Context) {
            val appCtx = context.applicationContext
            synchronized(watcherLock) {
                watcherContext = appCtx
                if (snapshotWatcher == null) {
                    snapshotWatcher = watchDirectory(
                        appCtx.dataDir,
                        setOf(
                            "checkin-widget.json",
                            "checkin-widget.json.tmp",
                            "checkin-widget.tick",
                        ),
                    )
                }
            }
        }

        @JvmStatic
        fun stopWatching() {
            synchronized(watcherLock) {
                snapshotWatcher?.stopWatching()
                snapshotWatcher = null
                watcherContext = null
                mainHandler.removeCallbacks(refreshRunnable)
            }
        }

        private fun watchDirectory(dir: File, names: Set<String>): FileObserver? {
            if (!dir.isDirectory) return null
            val mask = FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or
                FileObserver.MODIFY or FileObserver.CREATE
            @Suppress("DEPRECATION")
            val observer = object : FileObserver(dir.absolutePath, mask) {
                override fun onEvent(event: Int, path: String?) {
                    if (path == null || path !in names) return
                    if (SystemClock.elapsedRealtime() < suppressWatcherUntilElapsed) return
                    mainHandler.removeCallbacks(refreshRunnable)
                    mainHandler.postDelayed(refreshRunnable, 200)
                }
            }
            return try {
                observer.startWatching()
                observer
            } catch (_: Exception) {
                null
            }
        }

        /** Explicit broadcast so launchers that ignore silent AppWidget updates still redraw. */
        @JvmStatic
        fun requestRefreshBroadcast(context: Context) {
            val appCtx = context.applicationContext
            ensureWatching(appCtx)
            val intent = Intent(ACTION_REFRESH).setClass(appCtx, CheckinWidgetProvider::class.java)
            appCtx.sendBroadcast(intent)
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
            ensureWatching(context)
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

        /** Redraw summary / progress only — keeps the list stable under a tap. */
        private fun updateCountsOnly(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, CheckinWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            val board = CheckinBoard.load(context)
            for (id in ids) {
                manager.partiallyUpdateAppWidget(id, countsRemoteViews(context, board))
            }
        }

        private fun countsRemoteViews(context: Context, board: CheckinBoard): RemoteViews {
            return RemoteViews(context.packageName, R.layout.checkin_widget).apply {
                setTextViewText(R.id.widget_summary, board.summary)
                setViewVisibility(
                    R.id.widget_summary,
                    if (board.summary.isEmpty()) View.GONE else View.VISIBLE,
                )
                setTextViewText(R.id.widget_nudge, board.nudge)
                setViewVisibility(
                    R.id.widget_nudge,
                    if (board.nudge.isEmpty()) View.GONE else View.VISIBLE,
                )
                setViewVisibility(
                    R.id.widget_progress,
                    if (board.total == 0) View.GONE else View.VISIBLE,
                )
                setProgressBar(
                    R.id.widget_progress,
                    board.total.coerceAtLeast(1),
                    board.done,
                    false,
                )
            }
        }

        private fun buildViews(context: Context, widgetId: Int): RemoteViews {
            val board = CheckinBoard.load(context)
            val views = countsRemoteViews(context, board)
            views.setTextViewText(R.id.widget_title, board.title)
            views.setTextViewText(R.id.widget_date, board.dateLabel)
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
        /** Ignore every toggle (any habit) after one tap — list rebind can hit a neighbour. */
        const val TOGGLE_QUIET_MS = 1200L
        const val LIST_REFRESH_DELAY_MS = 700L
        private var lastToggleAtElapsed: Long = 0L

        /**
         * True when any habit was toggled moments ago. Call before [toggleToday]
         * so a duplicated / misplaced launcher click cannot undo the tap.
         */
        fun shouldIgnoreRapidToggle(@Suppress("UNUSED_PARAMETER") habitId: String): Boolean {
            synchronized(gate) {
                val now = SystemClock.elapsedRealtime()
                if (now - lastToggleAtElapsed < TOGGLE_QUIET_MS) {
                    return true
                }
                lastToggleAtElapsed = now
                return false
            }
        }

        /** Tell the Rust publisher to skip snapshot writes for [TOGGLE_QUIET_MS]. */
        fun markToggleQuiet(context: Context) {
            try {
                File(context.dataDir, "checkin-widget.quiet")
                    .writeText(System.currentTimeMillis().toString())
            } catch (_: Exception) {
                // Best-effort; debounce + deferred list refresh still apply.
            }
        }

        internal fun load(context: Context): CheckinBoard {
            synchronized(gate) {
                val file = snapshotFile(context)
                val parsed = hydrateFromDatabase(context, readSnapshot(file))
                return compose(parsed)
            }
        }

        /**
         * JSON can lag behind the SQLite database after in-app check-ins.
         * Always merge live check-in days (and focus starts) before composing.
         */
        private fun hydrateFromDatabase(context: Context, snapshot: Snapshot?): Snapshot? {
            if (snapshot == null || snapshot.habits.isEmpty()) return snapshot
            val dbFile = databaseFile(context) ?: return snapshot
            if (!dbFile.isFile) return snapshot
            val db = openDatabase(context, writable = false) ?: return snapshot
            return try {
                // Reject empty / pre-migration leftovers so we never replace a
                // good snapshot with a blank habit_checkins table.
                val hasCheckinsTable = db.rawQuery(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'habit_checkins' LIMIT 1",
                    null,
                ).use { it.moveToFirst() }
                if (!hasCheckinsTable) return snapshot

                val parentOf = HashMap<String, String>()
                db.rawQuery("SELECT id, parent_id FROM tasks", null).use { cursor ->
                    val idIdx = cursor.getColumnIndex("id")
                    val parentIdx = cursor.getColumnIndex("parent_id")
                    while (cursor.moveToNext()) {
                        if (idIdx < 0) continue
                        val id = cursor.getString(idIdx) ?: continue
                        val parent = if (parentIdx >= 0 && !cursor.isNull(parentIdx)) {
                            cursor.getString(parentIdx)
                        } else {
                            null
                        }
                        if (!parent.isNullOrEmpty()) parentOf[id] = parent
                    }
                }
                val habitIds = snapshot.habits.map { it.id }.toSet()
                fun habitRoot(taskId: String): String? {
                    var current = taskId
                    val seen = HashSet<String>()
                    while (true) {
                        if (habitIds.contains(current)) return current
                        val parent = parentOf[current] ?: return null
                        if (!seen.add(current)) return null
                        current = parent
                    }
                }
                val manualByHabit = HashMap<String, MutableSet<String>>()
                db.rawQuery("SELECT task_id, day FROM habit_checkins", null).use { cursor ->
                    val taskIdx = cursor.getColumnIndex("task_id")
                    val dayIdx = cursor.getColumnIndex("day")
                    while (cursor.moveToNext()) {
                        if (taskIdx < 0 || dayIdx < 0) continue
                        val taskId = cursor.getString(taskIdx) ?: continue
                        val day = cursor.getString(dayIdx) ?: continue
                        if (!habitIds.contains(taskId)) continue
                        manualByHabit.getOrPut(taskId) { linkedSetOf() }.add(day)
                    }
                }
                val focusByHabit = HashMap<String, MutableList<Long>>()
                db.rawQuery(
                    "SELECT task_id, started_at FROM pomodoro_sessions WHERE kind = 'focus' AND completed = 1",
                    null,
                ).use { cursor ->
                    val taskIdx = cursor.getColumnIndex("task_id")
                    val startIdx = cursor.getColumnIndex("started_at")
                    while (cursor.moveToNext()) {
                        if (taskIdx < 0 || startIdx < 0 || cursor.isNull(startIdx)) continue
                        val taskId = cursor.getString(taskIdx) ?: continue
                        val habitId = habitRoot(taskId) ?: continue
                        focusByHabit.getOrPut(habitId) { mutableListOf() }.add(cursor.getLong(startIdx))
                    }
                }
                snapshot.copy(
                    habits = snapshot.habits.map { habit ->
                        habit.copy(
                            manualDays = manualByHabit[habit.id] ?: emptySet(),
                            focusStarts = focusByHabit[habit.id] ?: emptyList(),
                        )
                    },
                )
            } catch (_: Exception) {
                snapshot
            } finally {
                db.close()
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
                                weekdays = weekdaysOf(item.optJSONArray("weekdays")),
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
            val source = snapshot?.habits.orEmpty()
            val habits = source.mapNotNull { habit ->
                val created = startOfDay(habit.createdAt)
                if (created > today || !scheduled(habit, today)) return@mapNotNull null
                val todayKey = dayKey(today)
                val manualToday = habit.manualDays.contains(todayKey)
                val autoToday = habit.focusStarts.any { dayKey(it) == todayKey }
                val done = checkedOn(habit, today)
                val (current, _) = streak(created, today) { day ->
                    when {
                        !scheduled(habit, day) -> DayMark.SKIP
                        checkedOn(habit, day) -> DayMark.HIT
                        else -> DayMark.MISS
                    }
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
                } else if (source.isNotEmpty() && habits.isEmpty()) {
                    if (zh) "今天没有需要打卡的习惯。" else "No habits are scheduled today."
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
            return streak(earliest, today) { day ->
                val due = applicable.filter { it.second <= day && scheduled(it.first, day) }
                when {
                    due.isEmpty() -> DayMark.SKIP
                    due.all { (habit, _) -> checkedOn(habit, day) } -> DayMark.HIT
                    else -> DayMark.MISS
                }
            }.let { Streak(it.first, it.second) }
        }

        private fun checkedDayKeys(habit: HabitSnap): Set<String> {
            val days = habit.manualDays.toMutableSet()
            for (started in habit.focusStarts) days.add(dayKey(started))
            return days
        }

        private enum class DayMark { HIT, MISS, SKIP }

        private fun weekdaysOf(raw: JSONArray?): Set<Int>? {
            if (raw == null) return null
            val days = buildSet {
                for (index in 0 until raw.length()) {
                    if (raw.isNull(index)) continue
                    val day = raw.optInt(index, -1)
                    if (day in 0..6) add(day)
                }
            }
            return if (days.isEmpty() || days.size == 7) null else days
        }

        private fun scheduled(habit: HabitSnap, day: Long): Boolean {
            val days = habit.weekdays ?: return true
            val weekday = Calendar.getInstance().apply { timeInMillis = day }.get(Calendar.DAY_OF_WEEK) - 1
            return days.contains(weekday)
        }

        private fun checkedOn(habit: HabitSnap, day: Long): Boolean {
            if (!scheduled(habit, day)) return false
            return checkedDayKeys(habit).contains(dayKey(day))
        }

        private fun streak(start: Long, today: Long, mark: (Long) -> DayMark): Pair<Int, Int> {
            var cursor = start
            if (cursor > today) return 0 to 0
            var run = 0
            var best = 0
            var current = 0
            while (cursor <= today) {
                when (mark(cursor)) {
                    DayMark.HIT -> {
                        run += 1
                        if (run > best) best = run
                        current = run
                    }
                    DayMark.SKIP -> Unit
                    DayMark.MISS -> if (cursor != today) {
                        run = 0
                        current = 0
                    }
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
                        try {
                            db.execSQL(
                                "INSERT OR IGNORE INTO habit_checkin_items (habit_id, task_id, day) VALUES (?, ?, ?)",
                                arrayOf(habitId, habitId, today),
                            )
                        } catch (_: SQLiteException) {
                            // Older databases have no item table.
                        }
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

        private fun openDatabase(
            context: Context,
            writable: Boolean = true,
        ): SQLiteDatabase? {
            val path = databaseFile(context) ?: return null
            return try {
                val flags = if (writable) {
                    SQLiteDatabase.OPEN_READWRITE
                } else {
                    SQLiteDatabase.OPEN_READONLY
                }
                val db = SQLiteDatabase.openDatabase(path.absolutePath, null, flags)
                db.rawQuery("PRAGMA busy_timeout = 3000", null).close()
                db
            } catch (_: SQLiteException) {
                null
            }
        }

        /** Visible so the provider can watch the live database for check-in changes. */
        fun databasePath(context: Context): File? = databaseFile(context)

        private fun databaseFile(context: Context): File? {
            val config = File(context.dataDir, "system.json")
            if (config.isFile) {
                try {
                    val custom = JSONObject(config.readText()).optString("dataDir").trim()
                    if (custom.isNotEmpty()) {
                        // Always use the configured data dir. Never fall back to
                        // the leftover app-private abyss.db — that stale copy
                        // (often from first launch) has no recent check-ins and
                        // hydrate would wipe the card to "0 done".
                        return File(custom, "abyss.db")
                    }
                } catch (_: Exception) {
                    // Fall through to the default database beside the snapshot.
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
    val weekdays: Set<Int>? = null,
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
