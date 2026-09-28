use rusqlite::{Connection, Result as SqliteResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::system_config::{db_file_in, read_system_settings, resolve_active_data_dir};

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub db_path: Mutex<PathBuf>,
}

pub fn open_db(path: &Path) -> SqliteResult<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK(status IN ('todo', 'done')),
            priority TEXT NOT NULL DEFAULT 'medium'
                CHECK(priority IN ('high', 'medium', 'low')),
            sort_order INTEGER NOT NULL DEFAULT 0,
            parent_id TEXT,
            category_id TEXT,
            estimate_pomodoros INTEGER NOT NULL DEFAULT 0,
            due_at INTEGER,
            start_at INTEGER,
            completed_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('focus', 'break')),
            planned_seconds INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL,
            completed INTEGER NOT NULL CHECK(completed IN (0, 1)),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pomodoro_task_id
            ON pomodoro_sessions(task_id);
        CREATE INDEX IF NOT EXISTS idx_pomodoro_started_at
            ON pomodoro_sessions(started_at);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        ",
    )?;
    migrate_schema(&conn)?;
    #[cfg(target_os = "android")]
    {
        fn on_db_change(_: rusqlite::hooks::Action, _: &str, _: &str, _: i64) {
            crate::widget::request_publish();
        }
        conn.update_hook(Some(on_db_change));
    }
    Ok(conn)
}

fn migrate_schema(conn: &Connection) -> SqliteResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "priority") {
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'",
            [],
        )?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "sort_order") {
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        // Backfill stable order within each priority (older updated_at first → higher index)
        for priority in ["high", "medium", "low"] {
            let ids: Vec<String> = {
                let mut s = conn.prepare(
                    "SELECT id FROM tasks WHERE priority = ?1 ORDER BY updated_at DESC, created_at DESC",
                )?;
                let rows = s.query_map([priority], |row| row.get(0))?;
                rows.filter_map(|r| r.ok()).collect()
            };
            for (idx, id) in ids.into_iter().enumerate() {
                conn.execute(
                    "UPDATE tasks SET sort_order = ?1 WHERE id = ?2",
                    rusqlite::params![idx as i64, id],
                )?;
            }
        }
    }

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "category_id") {
        conn.execute("ALTER TABLE tasks ADD COLUMN category_id TEXT", [])?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "estimate_pomodoros") {
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN estimate_pomodoros INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "due_at") {
        conn.execute("ALTER TABLE tasks ADD COLUMN due_at INTEGER", [])?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "start_at") {
        conn.execute("ALTER TABLE tasks ADD COLUMN start_at INTEGER", [])?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "completed_at") {
        conn.execute("ALTER TABLE tasks ADD COLUMN completed_at INTEGER", [])?;
        conn.execute(
            "UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL",
            [],
        )?;
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );",
    )?;

    let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "parent_id") {
        conn.execute("ALTER TABLE tasks ADD COLUMN parent_id TEXT", [])?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS habit_checkins (
            task_id TEXT NOT NULL,
            day TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (task_id, day),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_habit_checkins_day ON habit_checkins(day);",
    )?;

    let mut stmt = conn.prepare("PRAGMA table_info(habit_checkins)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "note") {
        conn.execute(
            "ALTER TABLE habit_checkins ADD COLUMN note TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(pomodoro_sessions)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "credit") {
        conn.execute(
            "ALTER TABLE pomodoro_sessions ADD COLUMN credit REAL NOT NULL DEFAULT 1",
            [],
        )?;
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS habit_checkin_items (
            habit_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            day TEXT NOT NULL,
            PRIMARY KEY (habit_id, task_id, day),
            FOREIGN KEY (habit_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_habit_checkin_items_day
            ON habit_checkin_items(day);",
    )?;

    Ok(())
}

/// Stable default data root, independent of the .app bundle location and rebuilds.
/// Uses the product name (not bundle id) so identifier changes won't orphan data.
fn legacy_db_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(home) = app.path().home_dir() {
        #[cfg(target_os = "macos")]
        {
            paths.push(
                home.join("Library/Application Support/com.abyssgazer.desktop/abyss.db"),
            );
            paths.push(home.join("Library/Application Support/com.abyssgazer.app/abyss.db"));
        }
        #[cfg(target_os = "windows")]
        {
            paths.push(home.join("AppData/Roaming/com.abyssgazer.desktop/abyss.db"));
            paths.push(home.join("AppData/Roaming/com.abyssgazer.app/abyss.db"));
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            paths.push(home.join(".local/share/com.abyssgazer.desktop/abyss.db"));
            paths.push(home.join(".local/share/com.abyssgazer.app/abyss.db"));
        }
    }
    if let Ok(app_data) = app.path().app_data_dir() {
        paths.push(app_data.join("abyss.db"));
    }
    paths
}

fn migrate_legacy_db(app: &AppHandle, dest: &Path) {
    if dest.exists() {
        return;
    }
    for src in legacy_db_candidates(app) {
        if src.exists() && src != dest {
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::copy(&src, dest) {
                Ok(_) => {
                    eprintln!(
                        "[abyss-gazer] migrated database from {} -> {}",
                        src.display(),
                        dest.display()
                    );
                    return;
                }
                Err(e) => {
                    eprintln!(
                        "[abyss-gazer] failed to migrate {} -> {}: {e}",
                        src.display(),
                        dest.display()
                    );
                }
            }
        }
    }
}

pub fn init_db(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let _ = read_system_settings(app)?;
    let dir = resolve_active_data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    let db_path = db_file_in(&dir);
    migrate_legacy_db(app, &db_path);
    eprintln!("[abyss-gazer] database: {}", db_path.display());
    let conn = open_db(&db_path).map_err(|e| format!("open database: {e}"))?;
    Ok((conn, db_path))
}

#[tauri::command]
pub fn get_db_path(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let path = db.db_path.lock().map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Drop the open connection and open the database file again.
/// An external replace keeps the old inode alive on the existing connection,
/// so reads stay stale and later writes never reach the new file.
#[tauri::command]
pub fn reopen_database(app: AppHandle, db: tauri::State<'_, DbState>) -> Result<(), String> {
    let dir = resolve_active_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    let db_path = db_file_in(&dir);
    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        let fresh = open_db(&db_path).map_err(|e| format!("open database: {e}"))?;
        *conn = fresh;
    }
    {
        let mut path = db.db_path.lock().map_err(|e| e.to_string())?;
        *path = db_path;
    }
    crate::widget::request_publish();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn migrations_and_task_roundtrip() {
        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-test-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = open_db(&path).expect("open");
        conn.execute(
            "INSERT INTO tasks (id, title, notes, status, priority, sort_order, category_id, created_at, updated_at)
             VALUES ('t1', 'Hello', '', 'todo', 'medium', 0, NULL, 1, 1)",
            [],
        )
        .expect("insert");
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .expect("select");
        assert_eq!(title, "Hello");
        conn.execute(
            "INSERT INTO habit_checkins (task_id, day, created_at) VALUES ('t1', '2026-09-22', 1)",
            [],
        )
        .expect("checkin");
        let day: String = conn
            .query_row(
                "SELECT day FROM habit_checkins WHERE task_id = 't1'",
                [],
                |r| r.get(0),
            )
            .expect("select checkin");
        assert_eq!(day, "2026-09-22");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migrates_parent_id_before_creating_index() {
        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-parent-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    priority TEXT NOT NULL DEFAULT 'medium',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    category_id TEXT,
                    estimate_pomodoros INTEGER NOT NULL DEFAULT 0,
                    due_at INTEGER,
                    start_at INTEGER,
                    completed_at INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                INSERT INTO tasks (id, title, notes, status, priority, sort_order, created_at, updated_at)
                VALUES ('t1', 'Old', '', 'todo', 'medium', 0, 1, 1);",
            )
            .unwrap();
        }
        let conn = open_db(&path).expect("open migrates parent_id");
        let parent_id: Option<String> = conn
            .query_row("SELECT parent_id FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .expect("parent_id");
        assert!(parent_id.is_none());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migrates_priority_onto_legacy_table() {
        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-legacy-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                INSERT INTO tasks VALUES ('t1', 'Old', '', 'todo', 1, 1);",
            )
            .unwrap();
        }
        let conn = open_db(&path).expect("open migrates");
        let priority: String = conn
            .query_row("SELECT priority FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .expect("priority");
        assert_eq!(priority, "medium");
        let _ = std::fs::remove_file(path);
    }
}
