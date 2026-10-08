use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const SYNC_FORMAT_VERSION: u8 = 1;
const SYNC_DIR: &str = "sync";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncEnvelope<T> {
    pub v: u8,
    pub updated_at: i64,
    pub deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncTask {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub sort_order: i64,
    pub parent_id: Option<String>,
    pub category_id: Option<String>,
    pub estimate_pomodoros: i64,
    pub due_at: Option<i64>,
    pub start_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub recurrence_source_id: Option<String>,
    #[serde(default)]
    pub recurrence_occurrence: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncCategory {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncPomodoroSession {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub planned_seconds: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub completed: bool,
    pub credit: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncHabitCheckin {
    pub task_id: String,
    pub day: String,
    pub note: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncHabitCheckinItem {
    pub habit_id: String,
    pub task_id: String,
    pub day: String,
}

pub fn sync_root(data_dir: &Path) -> PathBuf {
    data_dir.join(SYNC_DIR)
}

pub fn record_tombstone(conn: &Connection, kind: &str, entity_id: &str) -> Result<(), String> {
    let updated_at = now_ms();
    conn.execute(
        "INSERT INTO sync_tombstones (kind, entity_id, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(kind, entity_id) DO UPDATE SET updated_at = excluded.updated_at",
        rusqlite::params![kind, entity_id, updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_data_gitignore(data_dir: &Path) -> Result<(), String> {
    let path = data_dir.join(".gitignore");
    const DB_LINES: &str = "abyss.db\nabyss.db-wal\nabyss.db-shm\nabyss.db-journal\n";
    const LOCAL_ONLY: &str = "sync/app_settings/\n";
    let mut existing = if path.is_file() {
        fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };
    let mut changed = false;
    if !existing.contains("abyss.db") {
        existing.push_str(DB_LINES);
        changed = true;
    }
    if !existing.contains("sync/app_settings") {
        existing.push_str(LOCAL_ONLY);
        changed = true;
    }
    if changed {
        fs::write(&path, existing).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn untrack_database_from_git(data_dir: &Path) -> Result<(), String> {
    if !data_dir.join(".git").exists() {
        return Ok(());
    }
    let _ = std::process::Command::new("git")
        .args(["rm", "--cached", "-f", "abyss.db"])
        .current_dir(data_dir)
        .stdin(std::process::Stdio::null())
        .status();
    for name in ["abyss.db-wal", "abyss.db-shm", "abyss.db-journal"] {
        let _ = std::process::Command::new("git")
            .args(["rm", "--cached", "-f", name])
            .current_dir(data_dir)
            .stdin(std::process::Stdio::null())
            .status();
    }
    Ok(())
}

pub fn import_logical(conn: &Connection, data_dir: &Path) -> Result<(), String> {
    let root = sync_root(data_dir);
    if !root.join("VERSION").is_file() {
        return Ok(());
    }
    import_tasks(conn, &root)?;
    import_categories(conn, &root)?;
    import_pomodoro_sessions(conn, &root)?;
    import_habit_checkins(conn, &root)?;
    import_habit_checkin_items(conn, &root)?;
    Ok(())
}

pub fn export_logical(conn: &Connection, data_dir: &Path) -> Result<(), String> {
    let root = sync_root(data_dir);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    fs::write(root.join("VERSION"), format!("{SYNC_FORMAT_VERSION}\n")).map_err(|e| e.to_string())?;
    export_tasks(conn, &root)?;
    export_categories(conn, &root)?;
    export_pomodoro_sessions(conn, &root)?;
    export_habit_checkins(conn, &root)?;
    export_habit_checkin_items(conn, &root)?;
    remove_local_only_sync_dirs(&root)?;
    export_tombstones(conn, &root)?;
    Ok(())
}

/// Per-device settings live only in local `app_settings`; drop any legacy Git tree.
fn remove_local_only_sync_dirs(root: &Path) -> Result<(), String> {
    let dir = root.join("app_settings");
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Single-line canonical JSON so Mac/Android/git diffs only reflect data, not layout.
    let mut raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
    raw.push('\n');
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn local_task_updated_at(conn: &Connection, id: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT updated_at FROM tasks WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn apply_task_delete(conn: &Connection, id: &str, updated_at: i64) -> Result<(), String> {
    let local = local_task_updated_at(conn, id)?;
    if local.is_some_and(|ts| ts > updated_at) {
        return Ok(());
    }
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "DELETE FROM sync_tombstones WHERE kind = 'task' AND entity_id = ?1",
        [id],
    );
    Ok(())
}

fn apply_task(conn: &Connection, env: &SyncEnvelope<SyncTask>) -> Result<(), String> {
    if env.deleted {
        if let Some(t) = env.data.as_ref() {
            return apply_task_delete(conn, &t.id, env.updated_at);
        }
        return Ok(());
    }
    if env.data.is_none() {
        return Ok(());
    }
    let t = env.data.as_ref().unwrap();
    let remote_ts = env.updated_at.max(t.updated_at);
    let local = local_task_updated_at(conn, &t.id)?;
    if local.is_some_and(|ts| ts >= remote_ts) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO tasks (id, title, notes, status, priority, sort_order, parent_id, category_id,
         estimate_pomodoros, due_at, start_at, completed_at, created_at, updated_at,
         recurrence, recurrence_source_id, recurrence_occurrence)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
         ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, notes=excluded.notes, status=excluded.status, priority=excluded.priority,
         sort_order=excluded.sort_order, parent_id=excluded.parent_id, category_id=excluded.category_id,
         estimate_pomodoros=excluded.estimate_pomodoros, due_at=excluded.due_at, start_at=excluded.start_at,
         completed_at=excluded.completed_at, created_at=excluded.created_at, updated_at=excluded.updated_at,
         recurrence=excluded.recurrence, recurrence_source_id=excluded.recurrence_source_id,
         recurrence_occurrence=excluded.recurrence_occurrence",
        rusqlite::params![
            t.id,
            t.title,
            t.notes,
            t.status,
            t.priority,
            t.sort_order,
            t.parent_id,
            t.category_id,
            t.estimate_pomodoros,
            t.due_at,
            t.start_at,
            t.completed_at,
            t.created_at,
            t.updated_at,
            t.recurrence,
            t.recurrence_source_id,
            t.recurrence_occurrence,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn import_tasks(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("tasks");
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let env: SyncEnvelope<SyncTask> =
            read_json(&path)?.ok_or_else(|| format!("empty task sync file {}", path.display()))?;
        if env.deleted {
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let updated_at = if env.updated_at > 0 {
                env.updated_at
            } else {
                now_ms()
            };
            apply_task_delete(conn, &id, updated_at)?;
            continue;
        }
        apply_task(conn, &env)?;
    }
    Ok(())
}

fn export_tasks(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("tasks");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, status, priority, sort_order, parent_id, category_id,
             estimate_pomodoros, due_at, start_at, completed_at, created_at, updated_at,
             recurrence, recurrence_source_id, recurrence_occurrence FROM tasks",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SyncTask {
                id: row.get(0)?,
                title: row.get(1)?,
                notes: row.get(2)?,
                status: row.get(3)?,
                priority: row.get(4)?,
                sort_order: row.get(5)?,
                parent_id: row.get(6)?,
                category_id: row.get(7)?,
                estimate_pomodoros: row.get(8)?,
                due_at: row.get(9)?,
                start_at: row.get(10)?,
                completed_at: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                recurrence: row.get(14)?,
                recurrence_source_id: row.get(15)?,
                recurrence_occurrence: row.get(16)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let task = row.map_err(|e| e.to_string())?;
        keep.insert(task.id.clone());
        let env = SyncEnvelope {
            v: SYNC_FORMAT_VERSION,
            updated_at: task.updated_at,
            deleted: false,
            data: Some(task.clone()),
        };
        write_json(&dir.join(format!("{}.json", task.id)), &env)?;
    }
    prune_json_dir(&dir, &keep)?;
    Ok(())
}

fn import_categories(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("categories");
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let env: SyncEnvelope<SyncCategory> =
            read_json(&path)?.ok_or_else(|| format!("empty category file {}", path.display()))?;
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if env.deleted {
            let local: Option<i64> = conn
                .query_row(
                    "SELECT updated_at FROM categories WHERE id = ?1",
                    [&id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if local.is_some_and(|ts| ts > env.updated_at) {
                continue;
            }
            conn.execute("DELETE FROM categories WHERE id = ?1", [&id])
                .map_err(|e| e.to_string())?;
            continue;
        }
        let Some(c) = env.data else { continue };
        let local: Option<i64> = conn
            .query_row(
                "SELECT updated_at FROM categories WHERE id = ?1",
                [&c.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if local.is_some_and(|ts| ts >= env.updated_at) {
            continue;
        }
        conn.execute(
            "INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color,
             created_at=excluded.created_at, updated_at=excluded.updated_at",
            rusqlite::params![c.id, c.name, c.color, c.created_at, c.updated_at],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn export_categories(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("categories");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at, updated_at FROM categories")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SyncCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let c = row.map_err(|e| e.to_string())?;
        keep.insert(c.id.clone());
        let env = SyncEnvelope {
            v: SYNC_FORMAT_VERSION,
            updated_at: c.updated_at,
            deleted: false,
            data: Some(c.clone()),
        };
        write_json(&dir.join(format!("{}.json", c.id)), &env)?;
    }
    prune_json_dir(&dir, &keep)?;
    Ok(())
}

fn import_pomodoro_sessions(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("pomodoro_sessions");
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let env: SyncEnvelope<SyncPomodoroSession> = match read_json(&path)? {
            Some(v) => v,
            None => continue,
        };
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if env.deleted {
            let local: Option<i64> = conn
                .query_row(
                    "SELECT started_at FROM pomodoro_sessions WHERE id = ?1",
                    [&id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if local.is_some_and(|ts| ts > env.updated_at) {
                continue;
            }
            conn.execute("DELETE FROM pomodoro_sessions WHERE id = ?1", [&id])
                .map_err(|e| e.to_string())?;
            continue;
        }
        let Some(s) = env.data else { continue };
        let local: Option<i64> = conn
            .query_row(
                "SELECT started_at FROM pomodoro_sessions WHERE id = ?1",
                [&s.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if local.is_some_and(|ts| ts >= env.updated_at) {
            continue;
        }
        conn.execute(
            "INSERT INTO pomodoro_sessions (id, task_id, kind, planned_seconds, started_at, ended_at, completed, credit)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, kind=excluded.kind,
             planned_seconds=excluded.planned_seconds, started_at=excluded.started_at,
             ended_at=excluded.ended_at, completed=excluded.completed, credit=excluded.credit",
            rusqlite::params![
                s.id,
                s.task_id,
                s.kind,
                s.planned_seconds,
                s.started_at,
                s.ended_at,
                if s.completed { 1 } else { 0 },
                s.credit,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn export_pomodoro_sessions(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("pomodoro_sessions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, kind, planned_seconds, started_at, ended_at, completed, credit
             FROM pomodoro_sessions",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SyncPomodoroSession {
                id: row.get(0)?,
                task_id: row.get(1)?,
                kind: row.get(2)?,
                planned_seconds: row.get(3)?,
                started_at: row.get(4)?,
                ended_at: row.get(5)?,
                completed: row.get::<_, i64>(6)? != 0,
                credit: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let s = row.map_err(|e| e.to_string())?;
        keep.insert(s.id.clone());
        let env = SyncEnvelope {
            v: SYNC_FORMAT_VERSION,
            updated_at: s.started_at,
            deleted: false,
            data: Some(s.clone()),
        };
        write_json(&dir.join(format!("{}.json", s.id)), &env)?;
    }
    prune_json_dir(&dir, &keep)?;
    Ok(())
}

fn checkin_file_key(task_id: &str, day: &str) -> String {
    format!("{task_id}__{day}")
}

fn import_habit_checkins(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("habit_checkins");
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let env: SyncEnvelope<SyncHabitCheckin> = match read_json(&path)? {
            Some(v) => v,
            None => continue,
        };
        if env.deleted {
            if let Some(c) = env.data.as_ref() {
                conn.execute(
                    "DELETE FROM habit_checkins WHERE task_id = ?1 AND day = ?2",
                    rusqlite::params![c.task_id, c.day],
                )
                .map_err(|e| e.to_string())?;
            }
            continue;
        }
        let Some(c) = env.data else { continue };
        let local: Option<i64> = conn
            .query_row(
                "SELECT created_at FROM habit_checkins WHERE task_id = ?1 AND day = ?2",
                rusqlite::params![c.task_id, c.day],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if local.is_some_and(|ts| ts >= env.updated_at) {
            continue;
        }
        conn.execute(
            "INSERT INTO habit_checkins (task_id, day, created_at, note) VALUES (?1,?2,?3,?4)
             ON CONFLICT(task_id, day) DO UPDATE SET created_at=excluded.created_at, note=excluded.note",
            rusqlite::params![c.task_id, c.day, c.created_at, c.note],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn export_habit_checkins(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("habit_checkins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare("SELECT task_id, day, note, created_at FROM habit_checkins")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SyncHabitCheckin {
                task_id: row.get(0)?,
                day: row.get(1)?,
                note: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let c = row.map_err(|e| e.to_string())?;
        let key = checkin_file_key(&c.task_id, &c.day);
        keep.insert(key.clone());
        let env = SyncEnvelope {
            v: SYNC_FORMAT_VERSION,
            updated_at: c.created_at,
            deleted: false,
            data: Some(c.clone()),
        };
        write_json(&dir.join(format!("{key}.json")), &env)?;
    }
    prune_json_dir(&dir, &keep)?;
    Ok(())
}

fn checkin_item_key(habit_id: &str, task_id: &str, day: &str) -> String {
    format!("{habit_id}__{task_id}__{day}")
}

/// Habit check-in items are immutable; use a stable envelope timestamp so Mac/phone exports match.
fn stable_checkin_item_updated_at(habit_id: &str, task_id: &str, day: &str) -> i64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in format!("{habit_id}\0{task_id}\0{day}").bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    i64::try_from(hash & 0x7fff_ffff_ffff_ffff).unwrap_or(1)
}

fn import_habit_checkin_items(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("habit_checkin_items");
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let env: SyncEnvelope<SyncHabitCheckinItem> = match read_json(&path)? {
            Some(v) => v,
            None => continue,
        };
        if env.deleted {
            if let Some(c) = env.data.as_ref() {
                conn.execute(
                    "DELETE FROM habit_checkin_items WHERE habit_id = ?1 AND task_id = ?2 AND day = ?3",
                    rusqlite::params![c.habit_id, c.task_id, c.day],
                )
                .map_err(|e| e.to_string())?;
            }
            continue;
        }
        let Some(c) = env.data else { continue };
        conn.execute(
            "INSERT OR IGNORE INTO habit_checkin_items (habit_id, task_id, day) VALUES (?1,?2,?3)",
            rusqlite::params![c.habit_id, c.task_id, c.day],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn export_habit_checkin_items(conn: &Connection, root: &Path) -> Result<(), String> {
    let dir = root.join("habit_checkin_items");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare("SELECT habit_id, task_id, day FROM habit_checkin_items")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SyncHabitCheckinItem {
                habit_id: row.get(0)?,
                task_id: row.get(1)?,
                day: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let c = row.map_err(|e| e.to_string())?;
        let key = checkin_item_key(&c.habit_id, &c.task_id, &c.day);
        keep.insert(key.clone());
        let env = SyncEnvelope {
            v: SYNC_FORMAT_VERSION,
            updated_at: stable_checkin_item_updated_at(&c.habit_id, &c.task_id, &c.day),
            deleted: false,
            data: Some(c.clone()),
        };
        write_json(&dir.join(format!("{key}.json")), &env)?;
    }
    prune_json_dir(&dir, &keep)?;
    Ok(())
}

fn export_tombstones(conn: &Connection, root: &Path) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT kind, entity_id, updated_at FROM sync_tombstones")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (kind, entity_id, updated_at) = row.map_err(|e| e.to_string())?;
        match kind.as_str() {
            "task" => {
                let env = SyncEnvelope::<SyncTask> {
                    v: SYNC_FORMAT_VERSION,
                    updated_at,
                    deleted: true,
                    data: None,
                };
                write_json(&root.join("tasks").join(format!("{entity_id}.json")), &env)?;
            }
            "category" => {
                let env = SyncEnvelope::<SyncCategory> {
                    v: SYNC_FORMAT_VERSION,
                    updated_at,
                    deleted: true,
                    data: None,
                };
                write_json(
                    &root.join("categories").join(format!("{entity_id}.json")),
                    &env,
                )?;
            }
            "habit_checkin" => {
                let parts: Vec<&str> = entity_id.splitn(2, '\u{1f}').collect();
                if parts.len() == 2 {
                    let env = SyncEnvelope {
                        v: SYNC_FORMAT_VERSION,
                        updated_at,
                        deleted: true,
                        data: Some(SyncHabitCheckin {
                            task_id: parts[0].to_string(),
                            day: parts[1].to_string(),
                            note: String::new(),
                            created_at: updated_at,
                        }),
                    };
                    let key = checkin_file_key(parts[0], parts[1]);
                    write_json(&root.join("habit_checkins").join(format!("{key}.json")), &env)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn prune_json_dir(dir: &Path, keep: &std::collections::HashSet<String>) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let stem = name.strip_suffix(".json").unwrap_or(&name).to_string();
        if !keep.contains(&stem) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

pub fn checkin_tombstone_id(task_id: &str, day: &str) -> String {
    format!("{task_id}\u{1f}{day}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_db;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn category_envelope_canonical_json() {
        let env = SyncEnvelope {
            v: SYNC_FORMAT_VERSION,
            updated_at: 1790612199963,
            deleted: false,
            data: Some(SyncCategory {
                id: "f0aa00b0-0099-4a8a-933c-ea0910f36485".into(),
                name: "Note".into(),
                color: "#475569".into(),
                created_at: 1790612199963,
                updated_at: 1790612199963,
            }),
        };
        let raw = serde_json::to_string(&env).unwrap();
        assert!(
            raw.starts_with("{\"v\":1,\"updated_at\":1790612199963,\"deleted\":false,\"data\":"),
            "unexpected key order: {raw}"
        );
        let back: SyncEnvelope<SyncCategory> = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.data.as_ref().unwrap().name, "Note");
    }

    #[test]
    fn export_import_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "abyss-sync-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("abyss.db");
        let conn = open_db(&db_path).expect("open");
        conn.execute(
            "INSERT INTO tasks (id, title, notes, status, priority, sort_order, created_at, updated_at)
             VALUES ('t1', 'Hi', '', 'todo', 'medium', 0, 100, 200)",
            [],
        )
        .unwrap();
        export_logical(&conn, &dir).expect("export");
        conn.execute("DELETE FROM tasks", []).unwrap();
        import_logical(&conn, &dir).expect("import");
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Hi");
        let _ = std::fs::remove_dir_all(dir);
    }
}
