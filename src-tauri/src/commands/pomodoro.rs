use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroSession {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub planned_seconds: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub completed: bool,
}

#[derive(Debug, Deserialize)]
pub struct RecordSessionInput {
    pub task_id: String,
    pub kind: String,
    pub planned_seconds: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub completed: bool,
}

#[tauri::command]
pub fn record_pomodoro_session(
    db: State<'_, DbState>,
    input: RecordSessionInput,
) -> Result<PomodoroSession, String> {
    if input.kind != "focus" && input.kind != "break" {
        return Err("Invalid session kind".into());
    }
    if input.planned_seconds <= 0 {
        return Err("planned_seconds must be positive".into());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1)",
            [&input.task_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Task not found".into());
    }

    let session = PomodoroSession {
        id: Uuid::new_v4().to_string(),
        task_id: input.task_id,
        kind: input.kind,
        planned_seconds: input.planned_seconds,
        started_at: input.started_at,
        ended_at: input.ended_at,
        completed: input.completed,
    };

    conn.execute(
        "INSERT INTO pomodoro_sessions
         (id, task_id, kind, planned_seconds, started_at, ended_at, completed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            session.id,
            session.task_id,
            session.kind,
            session.planned_seconds,
            session.started_at,
            session.ended_at,
            if session.completed { 1 } else { 0 }
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(session)
}

#[tauri::command]
pub fn count_today_focus_sessions(
    db: State<'_, DbState>,
    task_id: String,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Start of local calendar day as unix ms — approximate via UTC midnight offset
    // by using JS-side day bounds would be better; here we use local midnight via chrono-less math.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Offset from UTC to local is not available without chrono; accept UTC day boundary
    // for MVP and document. Better: pass day_start_ms from frontend.
    let day_ms: i64 = 86_400_000;
    let day_start = now - (now % day_ms);

    conn.query_row(
        "SELECT COUNT(*) FROM pomodoro_sessions
         WHERE task_id = ?1
           AND kind = 'focus'
           AND completed = 1
           AND started_at >= ?2",
        rusqlite::params![task_id, day_start],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_focus_sessions_since(
    db: State<'_, DbState>,
    task_id: String,
    since_ms: i64,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM pomodoro_sessions
         WHERE task_id = ?1
           AND kind = 'focus'
           AND completed = 1
           AND started_at >= ?2",
        rusqlite::params![task_id, since_ms],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_focus_sessions_total_since(
    db: State<'_, DbState>,
    since_ms: i64,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM pomodoro_sessions
         WHERE kind = 'focus'
           AND completed = 1
           AND started_at >= ?1",
        [since_ms],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusCountRow {
    pub task_id: String,
    pub count: i64,
}

#[tauri::command]
pub fn list_focus_counts_since(
    db: State<'_, DbState>,
    since_ms: i64,
) -> Result<Vec<FocusCountRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT task_id, COUNT(*) as cnt FROM pomodoro_sessions
             WHERE kind = 'focus'
               AND completed = 1
               AND started_at >= ?1
             GROUP BY task_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([since_ms], |row| {
            Ok(FocusCountRow {
                task_id: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
