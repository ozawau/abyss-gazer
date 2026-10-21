use std::collections::{HashMap, HashSet};
#[cfg(target_os = "android")]
use std::fs;
#[cfg(target_os = "android")]
use std::io::Write;
#[cfg(target_os = "android")]
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(target_os = "android")]
use std::sync::OnceLock;
#[cfg(target_os = "android")]
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
static DIRTY: AtomicBool = AtomicBool::new(false);
/// Bumped on every publish so a mid-transaction snapshot cannot overwrite a
/// newer post-commit publish (update_hook fires before COMMIT).
#[cfg(target_os = "android")]
static PUBLISH_GEN: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "android")]
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Ask the Android home-screen card to rebuild from the database.
/// Desktop builds ignore this.
pub fn request_publish() {
    #[cfg(target_os = "android")]
    DIRTY.store(true, Ordering::Relaxed);
}

/// Write the snapshot and refresh widgets immediately (Android only).
pub fn publish_now(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    {
        // Clear dirty first so the background loop does not immediately redo a
        // stale mid-tx read; bump generation so older publishes abort.
        DIRTY.store(false, Ordering::Release);
        let gen = PUBLISH_GEN.fetch_add(1, Ordering::AcqRel) + 1;
        publish_once(app, gen);
        // update_hook may have set DIRTY again while we published; leave it.
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

#[tauri::command]
pub fn refresh_checkin_widget(app: tauri::AppHandle) -> Result<(), String> {
    publish_now(&app);
    Ok(())
}

pub fn install(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    install_android(app);
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

/// Android only: ask the launcher to pin the check-in home-screen widget.
#[tauri::command]
pub fn request_pin_checkin_widget(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return request_pin_android(&app);
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    Ok(false)
}

#[cfg(target_os = "android")]
fn request_pin_android(app: &tauri::AppHandle) -> Result<bool, String> {
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _webview| {
                let _ = tx.send(call_request_pin(env, activity));
            });
        })
        .map_err(|err| format!("无法添加桌面卡片: {err}"))?;
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(result) => result,
        Err(_) => Err("添加桌面卡片超时".into()),
    }
}

#[cfg(target_os = "android")]
fn call_request_pin(
    env: &mut jni::JNIEnv,
    activity: &jni::objects::JObject,
) -> Result<bool, String> {
    let name = env
        .new_string("com.abyssgazer.desktop.CheckinWidgetProvider")
        .map_err(|err| err.to_string())?;
    let class = env
        .call_method(
            activity,
            "getAppClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[jni::objects::JValue::Object(&name)],
        )
        .map_err(|err| format!("找不到打卡卡片: {err}"))?
        .l()
        .map_err(|err| err.to_string())?;
    let class = jni::objects::JClass::from(class);
    let value = env
        .call_static_method(
            class,
            "requestPin",
            "(Landroid/app/Activity;)Z",
            &[jni::objects::JValue::Object(activity)],
        )
        .map_err(|err| format!("无法添加桌面卡片: {err}"))?
        .z()
        .map_err(|err| err.to_string())?;
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return Err("无法添加桌面卡片".into());
    }
    Ok(value)
}

#[cfg(target_os = "android")]
fn install_android(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    request_publish();
    std::thread::Builder::new()
        .name("checkin-widget".into())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_millis(400));
            if !DIRTY.swap(false, Ordering::AcqRel) {
                continue;
            }
            let Some(app) = APP.get() else {
                DIRTY.store(true, Ordering::Relaxed);
                continue;
            };
            // Wait out in-flight transactions: update_hook marks dirty before
            // COMMIT, and a snapshot taken then would miss the new check-in.
            std::thread::sleep(Duration::from_millis(250));
            loop {
                let gen = PUBLISH_GEN.fetch_add(1, Ordering::AcqRel) + 1;
                publish_once(app, gen);
                if !DIRTY.swap(false, Ordering::AcqRel) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(120));
            }
        })
        .ok();
}

#[cfg(target_os = "android")]
fn publish_once(app: &tauri::AppHandle, gen: u64) {
    if PUBLISH_GEN.load(Ordering::Acquire) != gen {
        return;
    }
    // Home-screen taps write the DB + JSON themselves. A concurrent publish
    // that started from an older dirty flag can briefly rewrite the snapshot
    // without the new check-in (2 done → 1 done). Honour the quiet file.
    if widget_toggle_quiet(app) {
        DIRTY.store(true, Ordering::Relaxed);
        return;
    }
    let Some(state) = app.try_state::<crate::db::DbState>() else {
        DIRTY.store(true, Ordering::Relaxed);
        return;
    };
    let db_path = match state.db_path.lock() {
        Ok(path) => path.clone(),
        Err(_) => {
            DIRTY.store(true, Ordering::Relaxed);
            return;
        }
    };
    drop(state);
    if PUBLISH_GEN.load(Ordering::Acquire) != gen {
        return;
    }
    // Open a fresh connection so home-screen toggles and app writes are both
    // visible, instead of relying on the long-lived locked connection.
    let conn = match crate::db::open_db_for_read(&db_path) {
        Ok(conn) => conn,
        Err(err) => {
            eprintln!("checkin widget open: {err}");
            DIRTY.store(true, Ordering::Relaxed);
            return;
        }
    };
    let language = crate::system_config::read_system_settings(app)
        .map(|settings| settings.language)
        .unwrap_or_else(|_| "system".into());
    if PUBLISH_GEN.load(Ordering::Acquire) != gen {
        return;
    }
    if let Err(err) = write_snapshot(app, &conn, &language) {
        eprintln!("checkin widget: {err}");
        DIRTY.store(true, Ordering::Relaxed);
        return;
    }
    drop(conn);
    // Skip notify if a newer publish already started — its write + notify win.
    if PUBLISH_GEN.load(Ordering::Acquire) != gen {
        return;
    }
    notify_widgets(app);
}

/// True when the Android widget asked publishers to stay quiet after a tap.
#[cfg(target_os = "android")]
fn widget_toggle_quiet(app: &tauri::AppHandle) -> bool {
    let Ok(dir) = app.path().app_data_dir() else {
        return false;
    };
    let path = dir.join("checkin-widget.quiet");
    let Ok(raw) = fs::read_to_string(&path) else {
        return false;
    };
    let Ok(marked_at) = raw.trim().parse::<u128>() else {
        return false;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    now.saturating_sub(marked_at) < 1_500
}

#[cfg(target_os = "android")]
fn write_snapshot(
    app: &tauri::AppHandle,
    conn: &Connection,
    language: &str,
) -> Result<(), String> {
    let settings = crate::system_config::read_system_settings(app).unwrap_or_default();
    let snapshot = build_snapshot(conn, language, settings.checkin_category_id.as_deref())?;
    let raw = serde_json::to_vec(&snapshot).map_err(|err| err.to_string())?;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("checkin-widget.json");
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|err| err.to_string())?;
        file.write_all(&raw).map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    // Side-channel tick so FileObserver always sees a CLOSE_WRITE even when
    // some OEMs skip MOVED_TO for the atomic rename.
    let tick = path.with_extension("tick");
    let _ = fs::write(&tick, format!("{}\n", PUBLISH_GEN.load(Ordering::Relaxed)));
    Ok(())
}

#[cfg(target_os = "android")]
fn notify_widgets(app: &tauri::AppHandle) {
    use tauri::Manager;
    // Never block the invoke / publisher thread waiting for the webview: that
    // deadlocks Android when save_habit_checkin is awaited from JS. The
    // FileObserver on checkin-widget.json is the reliable redraw path; JNI
    // refresh is best-effort.
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| {
        webview.jni_handle().exec(|env, activity, _webview| {
            let Ok(name) = env.new_string("com.abyssgazer.desktop.CheckinWidgetProvider") else {
                return;
            };
            let Ok(class) = env
                .call_method(
                    activity,
                    "getAppClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[jni::objects::JValue::Object(&name)],
                )
                .and_then(|value| value.l())
            else {
                let _ = env.exception_clear();
                return;
            };
            let class = jni::objects::JClass::from(class);
            let app_ctx = env
                .call_method(activity, "getApplicationContext", "()Landroid/content/Context;", &[])
                .ok()
                .and_then(|value| value.l().ok());
            let ctx = app_ctx.as_ref().unwrap_or(activity);
            for method in ["ensureWatching", "refresh", "requestRefreshBroadcast"] {
                if env
                    .call_static_method(
                        &class,
                        method,
                        "(Landroid/content/Context;)V",
                        &[jni::objects::JValue::Object(ctx)],
                    )
                    .is_err()
                    || env.exception_check().unwrap_or(false)
                {
                    let _ = env.exception_clear();
                }
            }
        });
    });
}

#[derive(Serialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct Snapshot {
    language: String,
    #[serde(rename = "checkinCategoryName")]
    checkin_category_name: String,
    habits: Vec<HabitSnap>,
}

#[derive(Serialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct HabitSnap {
    id: String,
    title: String,
    #[serde(rename = "createdAt")]
    created_at: i64,
    #[serde(rename = "manualDays")]
    manual_days: Vec<String>,
    #[serde(rename = "focusStarts")]
    focus_starts: Vec<i64>,
    #[serde(rename = "weekdays", skip_serializing_if = "Option::is_none")]
    weekdays: Option<Vec<i64>>,
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct TaskRow {
    id: String,
    title: String,
    parent_id: Option<String>,
    category_id: Option<String>,
    sort_order: i64,
    created_at: i64,
    checkin_weekdays: Option<String>,
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn build_snapshot(
    conn: &Connection,
    language: &str,
    checkin_category_id: Option<&str>,
) -> Result<Snapshot, String> {
    let mut categories = HashMap::<String, String>::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name FROM categories")
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|err| err.to_string())?;
        for row in rows {
            let (id, name) = row.map_err(|err| err.to_string())?;
            categories.insert(id, name);
        }
    }

    let mut tasks = Vec::<TaskRow>::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, parent_id, category_id, sort_order, created_at, checkin_weekdays FROM tasks",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TaskRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    parent_id: row.get(2)?,
                    category_id: row.get(3)?,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    checkin_weekdays: row.get(6)?,
                })
            })
            .map_err(|err| err.to_string())?;
        for row in rows {
            tasks.push(row.map_err(|err| err.to_string())?);
        }
    }

    let mut parent_of = HashMap::<String, String>::new();
    for task in &tasks {
        if let Some(parent) = &task.parent_id {
            parent_of.insert(task.id.clone(), parent.clone());
        }
    }

    let checkin_category_name = checkin_category_id
        .and_then(|id| categories.get(id))
        .map(|name| name.trim().to_string())
        .unwrap_or_default();
    let mut habits: Vec<&TaskRow> = tasks
        .iter()
        .filter(|task| {
            task.parent_id.is_none()
                && checkin_category_id.is_some_and(|id| task.category_id.as_deref() == Some(id))
        })
        .collect();
    habits.sort_by(|a, b| {
        a.sort_order
            .cmp(&b.sort_order)
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.id.cmp(&b.id))
    });
    let habit_ids: HashSet<&str> = habits.iter().map(|task| task.id.as_str()).collect();

    let mut manual_days = HashMap::<String, Vec<String>>::new();
    {
        let mut stmt = conn
            .prepare("SELECT task_id, day FROM habit_checkins")
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|err| err.to_string())?;
        for row in rows {
            let (task_id, day) = row.map_err(|err| err.to_string())?;
            if habit_ids.contains(task_id.as_str()) {
                manual_days.entry(task_id).or_default().push(day);
            }
        }
    }
    for days in manual_days.values_mut() {
        days.sort();
        days.dedup();
    }

    let mut focus_starts = HashMap::<String, Vec<i64>>::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT task_id, started_at FROM pomodoro_sessions
                 WHERE kind = 'focus' AND completed = 1",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|err| err.to_string())?;
        for row in rows {
            let (task_id, started_at) = row.map_err(|err| err.to_string())?;
            if let Some(habit_id) = habit_of(&task_id, &parent_of, &habit_ids) {
                focus_starts.entry(habit_id).or_default().push(started_at);
            }
        }
    }

    let language = match language {
        "zh" | "en" | "system" => language.to_string(),
        _ => "system".to_string(),
    };
    Ok(Snapshot {
        language,
        checkin_category_name,
        habits: habits
            .into_iter()
            .map(|task| HabitSnap {
                manual_days: manual_days.remove(&task.id).unwrap_or_default(),
                focus_starts: focus_starts.remove(&task.id).unwrap_or_default(),
                id: task.id.clone(),
                title: task.title.clone(),
                created_at: task.created_at,
                weekdays: parse_checkin_weekdays(task.checkin_weekdays.clone()),
            })
            .collect(),
    })
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn parse_checkin_weekdays(raw: Option<String>) -> Option<Vec<i64>> {
    let raw = raw?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let list = value.as_array()?;
    let mut days = Vec::<i64>::new();
    for item in list {
        let Some(day) = item.as_i64() else {
            continue;
        };
        if (0..=6).contains(&day) && !days.contains(&day) {
            days.push(day);
        }
    }
    days.sort_unstable();
    if days.is_empty() || days.len() == 7 {
        None
    } else {
        Some(days)
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn habit_of(
    task_id: &str,
    parent_of: &HashMap<String, String>,
    habit_ids: &HashSet<&str>,
) -> Option<String> {
    let mut current = task_id.to_string();
    let mut seen = HashSet::<String>::new();
    loop {
        if habit_ids.contains(current.as_str()) {
            return Some(current);
        }
        let parent = parent_of.get(&current)?.clone();
        if !seen.insert(current) {
            return None;
        }
        current = parent;
    }
}

#[cfg(test)]
mod tests {
    use super::build_snapshot;
    use crate::db::open_db;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn snapshot_includes_habit_roots_and_descendant_focus() {
        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-widget-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = open_db(&path).expect("open");
        conn.execute(
            "INSERT INTO categories (id, name, color, created_at) VALUES
             ('habit', ' Habit ', '#2563eb', 1),
             ('other', 'Work', '#000', 1)",
            [],
        )
        .expect("categories");
        conn.execute(
            "INSERT INTO tasks (id, title, notes, status, priority, sort_order, parent_id, category_id, created_at, updated_at)
             VALUES
             ('run', '跑步', '', 'todo', 'medium', 1, NULL, 'habit', 10, 10),
             ('read', '阅读', '', 'todo', 'medium', 0, NULL, 'habit', 10, 10),
             ('page', '读一章', '', 'todo', 'medium', 0, 'read', 'habit', 10, 10),
             ('work', '工作', '', 'todo', 'medium', 0, NULL, 'other', 10, 10)",
            [],
        )
        .expect("tasks");
        conn.execute(
            "INSERT INTO habit_checkins (task_id, day, created_at) VALUES ('read', '2026-09-28', 1)",
            [],
        )
        .expect("checkin");
        conn.execute(
            "INSERT INTO pomodoro_sessions
             (id, task_id, kind, planned_seconds, started_at, ended_at, completed, credit)
             VALUES
             ('focus', 'page', 'focus', 1500, 1000, 2000, 1, 1),
             ('break', 'page', 'break', 300, 3000, 3300, 1, 1),
             ('other', 'work', 'focus', 1500, 4000, 5000, 1, 1)",
            [],
        )
        .expect("sessions");

        let snapshot = build_snapshot(&conn, "zh", Some("habit")).expect("snapshot");
        assert_eq!(snapshot.language, "zh");
        assert_eq!(snapshot.checkin_category_name, "Habit");
        assert_eq!(snapshot.habits.len(), 2);
        assert_eq!(snapshot.habits[0].id, "read");
        assert_eq!(snapshot.habits[0].manual_days, vec!["2026-09-28".to_string()]);
        assert_eq!(snapshot.habits[0].focus_starts, vec![1000]);
        assert_eq!(snapshot.habits[1].id, "run");
        assert!(snapshot.habits[1].manual_days.is_empty());
        assert!(snapshot.habits[1].focus_starts.is_empty());
        let _ = std::fs::remove_file(&path);
    }
}
