package com.abyssgazer.desktop

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.os.Build
import android.widget.RemoteViews
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.UUID

/** 4×1 quick-add bar: draft title on the card, add → note category / high priority. */
class NoteTaskWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        updateAll(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_REFRESH -> updateAll(context)
            ACTION_ADD -> {
                val outcome = NoteTaskActions.addFromDraft(context)
                outcome.message?.let { message ->
                    Toast.makeText(context.applicationContext, message, Toast.LENGTH_SHORT).show()
                }
                if (outcome.clearedDraft) {
                    updateAll(context)
                }
                MainActivity.notifyCheckinChanged()
            }
            else -> super.onReceive(context, intent)
        }
    }

    companion object {
        private const val ACTION_REFRESH = "com.abyssgazer.desktop.action.NOTE_TASK_WIDGET_REFRESH"
        private const val ACTION_ADD = "com.abyssgazer.desktop.action.NOTE_TASK_WIDGET_ADD"

        @JvmStatic
        fun refresh(context: Context) {
            updateAll(context)
        }

        @JvmStatic
        fun requestPin(activity: Activity): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
            val manager = AppWidgetManager.getInstance(activity)
            if (!manager.isRequestPinAppWidgetSupported) return false
            val component = ComponentName(activity, NoteTaskWidgetProvider::class.java)
            return manager.requestPinAppWidget(component, null, null)
        }

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, NoteTaskWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            val draft = NoteTaskActions.readDraft(context)
            val hint = context.getString(R.string.note_task_widget_hint)
            for (id in ids) {
                manager.updateAppWidget(id, buildViews(context, draft, hint))
            }
        }

        private fun buildViews(context: Context, draft: String, hint: String): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.note_task_widget)
            views.setTextViewText(
                R.id.note_task_input,
                if (draft.isEmpty()) hint else draft,
            )
            views.setOnClickPendingIntent(
                R.id.note_task_input,
                inputIntent(context),
            )
            views.setOnClickPendingIntent(
                R.id.note_task_add,
                addIntent(context),
            )
            return views
        }

        private fun inputIntent(context: Context): PendingIntent {
            val intent = Intent(context, NoteTaskInputActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            return PendingIntent.getActivity(
                context,
                20,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private fun addIntent(context: Context): PendingIntent {
            val intent = Intent(context, NoteTaskWidgetProvider::class.java).apply {
                action = ACTION_ADD
            }
            return PendingIntent.getBroadcast(
                context,
                21,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}

data class AddTaskOutcome(
    val message: String?,
    val clearedDraft: Boolean,
)

object NoteTaskActions {
    private const val PREFS = "note_task_widget"
    private const val KEY_DRAFT = "draft"

    fun readDraft(context: Context): String {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_DRAFT, "")
            ?.trim()
            .orEmpty()
    }

    fun saveDraft(context: Context, text: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DRAFT, text)
            .apply()
        NoteTaskWidgetProvider.updateAll(context)
    }

    fun clearDraft(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_DRAFT)
            .commit()
    }

    fun addFromDraft(context: Context): AddTaskOutcome {
        val draft = readDraft(context)
        if (draft.isEmpty()) {
            val zh = isChinese(context)
            val message = if (zh) "请输入任务名称" else "Enter a task title"
            return AddTaskOutcome(message, clearedDraft = false)
        }
        return addTask(context, draft)
    }

    fun addTask(context: Context, title: String): AddTaskOutcome {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return AddTaskOutcome(message = null, clearedDraft = false)
        val zh = isChinese(context)
        val db = openDatabase(context)
            ?: return AddTaskOutcome(
                if (zh) "找不到数据库" else "Database not found",
                clearedDraft = false,
            )
        return try {
            db.beginTransaction()
            try {
                val categoryId = findNoteCategoryId(context, db)
                    ?: return AddTaskOutcome(
                        if (zh) {
                            "请先在设置 → 任务里选择便签分类"
                        } else {
                            "Choose a note category in Settings → Tasks"
                        },
                        clearedDraft = false,
                    )
                val sortOrder = nextSortOrderFront(db, "high")
                val id = UUID.randomUUID().toString()
                val ts = System.currentTimeMillis()
                db.execSQL(
                    """
                    INSERT INTO tasks (
                        id, title, notes, status, priority, sort_order, parent_id, category_id,
                        estimate_pomodoros, due_at, start_at, completed_at, created_at, updated_at
                    ) VALUES (?, ?, '', 'todo', 'high', ?, NULL, ?, 0, NULL, NULL, NULL, ?, ?)
                    """.trimIndent(),
                    arrayOf(id, trimmed, sortOrder, categoryId, ts, ts),
                )
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
            clearDraft(context)
            NoteTaskWidgetProvider.updateAll(context)
            AddTaskOutcome(
                if (zh) "已添加「$trimmed」" else "Added “$trimmed”",
                clearedDraft = true,
            )
        } catch (_: SQLiteException) {
            AddTaskOutcome(
                if (zh) "任务没有写入" else "Couldn’t save the task",
                clearedDraft = false,
            )
        } finally {
            db.close()
        }
    }

    private fun findNoteCategoryId(context: Context, db: SQLiteDatabase): String? {
        val configured = readSystemSettings(context)?.optString("noteCategoryId")?.trim().orEmpty()
        if (configured.isNotEmpty()) {
            return db.rawQuery(
                "SELECT id FROM categories WHERE id = ? LIMIT 1",
                arrayOf(configured),
            ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        }
        return null
    }

    private fun readSystemSettings(context: Context): JSONObject? {
        val config = File(context.dataDir, "system.json")
        if (!config.isFile) return null
        return try {
            JSONObject(config.readText())
        } catch (_: Exception) {
            null
        }
    }

    private fun nextSortOrderFront(db: SQLiteDatabase, priority: String): Long {
        val min = db.rawQuery(
            "SELECT MIN(sort_order) FROM tasks WHERE parent_id IS NULL AND priority = ?",
            arrayOf(priority),
        ).use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
        }
        return min?.minus(1) ?: 0L
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

    private fun isChinese(context: Context): Boolean {
        val config = File(context.dataDir, "system.json")
        if (config.isFile) {
            try {
                when (JSONObject(config.readText()).optString("language")) {
                    "zh" -> return true
                    "en" -> return false
                }
            } catch (_: Exception) {
                // Use locale below.
            }
        }
        val lang = Locale.getDefault().language.lowercase(Locale.ROOT)
        return lang.startsWith("zh")
    }
}
