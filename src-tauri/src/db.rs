use rusqlite::{Connection, Result as SqliteResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

pub fn open_db(path: &Path) -> SqliteResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK(status IN ('todo', 'done')),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
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
        ",
    )?;
    Ok(conn)
}

/// Stable data root, independent of the .app bundle location and rebuilds.
/// Uses the product name (not bundle id) so identifier changes won't orphan data.
pub fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))?;

    #[cfg(target_os = "macos")]
    let dir = home.join("Library/Application Support/Abyss Gazer");

    #[cfg(target_os = "windows")]
    let dir = home.join("AppData/Roaming/Abyss Gazer");

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let dir = home.join(".local/share/abyss-gazer");

    Ok(dir)
}

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
    let dir = resolve_data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    let db_path = dir.join("abyss.db");
    migrate_legacy_db(app, &db_path);
    eprintln!("[abyss-gazer] database: {}", db_path.display());
    let conn = open_db(&db_path).map_err(|e| format!("open database: {e}"))?;
    Ok((conn, db_path))
}

#[tauri::command]
pub fn get_db_path(db: tauri::State<'_, DbState>) -> String {
    db.db_path.display().to_string()
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
            "INSERT INTO tasks (id, title, notes, status, created_at, updated_at)
             VALUES ('t1', 'Hello', '', 'todo', 1, 1)",
            [],
        )
        .expect("insert");
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .expect("select");
        assert_eq!(title, "Hello");
        let _ = std::fs::remove_file(path);
    }
}
