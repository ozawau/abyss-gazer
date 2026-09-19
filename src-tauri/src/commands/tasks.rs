use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub status: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_tasks(db: State<'_, DbState>) -> Result<Vec<Task>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, status, created_at, updated_at
             FROM tasks
             ORDER BY
               CASE status WHEN 'todo' THEN 0 ELSE 1 END,
               updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                notes: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| e.to_string())?);
    }
    Ok(tasks)
}

#[tauri::command]
pub fn create_task(
    db: State<'_, DbState>,
    input: CreateTaskInput,
) -> Result<Task, String> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err("Title cannot be empty".into());
    }

    let notes = input.notes.unwrap_or_default();
    let id = Uuid::new_v4().to_string();
    let ts = now_ms();
    let task = Task {
        id: id.clone(),
        title: title.clone(),
        notes: notes.clone(),
        status: "todo".into(),
        created_at: ts,
        updated_at: ts,
    };

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO tasks (id, title, notes, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            task.id,
            task.title,
            task.notes,
            task.status,
            task.created_at,
            task.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(task)
}

#[tauri::command]
pub fn update_task(
    db: State<'_, DbState>,
    input: UpdateTaskInput,
) -> Result<Task, String> {
    if let Some(ref status) = input.status {
        if status != "todo" && status != "done" {
            return Err("Invalid status".into());
        }
    }
    if let Some(ref title) = input.title {
        if title.trim().is_empty() {
            return Err("Title cannot be empty".into());
        }
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let existing: Task = conn
        .query_row(
            "SELECT id, title, notes, status, created_at, updated_at
             FROM tasks WHERE id = ?1",
            [&input.id],
            |row| {
                Ok(Task {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    notes: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let title = input
        .title
        .map(|t| t.trim().to_string())
        .unwrap_or(existing.title);
    let notes = input.notes.unwrap_or(existing.notes);
    let status = input.status.unwrap_or(existing.status);
    let updated_at = now_ms();

    conn.execute(
        "UPDATE tasks SET title = ?1, notes = ?2, status = ?3, updated_at = ?4
         WHERE id = ?5",
        rusqlite::params![title, notes, status, updated_at, input.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Task {
        id: input.id,
        title,
        notes,
        status,
        created_at: existing.created_at,
        updated_at,
    })
}

#[tauri::command]
pub fn delete_task(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute("DELETE FROM tasks WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Task not found".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_task(db: State<'_, DbState>, id: String) -> Result<Task, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, title, notes, status, created_at, updated_at
         FROM tasks WHERE id = ?1",
        [&id],
        |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                notes: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
