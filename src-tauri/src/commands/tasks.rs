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
    pub priority: String,
    pub sort_order: i64,
    pub parent_id: Option<String>,
    pub category_id: Option<String>,
    pub estimate_pomodoros: i64,
    pub completed_pomodoros: i64,
    pub due_at: Option<i64>,
    pub start_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<String>,
    pub category_id: Option<String>,
    pub estimate_pomodoros: Option<i64>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    /// Missing = leave unchanged; `null` = clear; string = set.
    #[serde(default)]
    pub category_id: Option<Option<String>>,
    pub estimate_pomodoros: Option<i64>,
    /// Missing = leave unchanged; `null` = clear; number = set.
    #[serde(default)]
    pub due_at: Option<Option<i64>>,
    /// Missing = leave unchanged; `null` = clear; number = set.
    #[serde(default)]
    pub start_at: Option<Option<i64>>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderTaskInput {
    pub id: String,
    pub priority: String,
    /// Insert before this task id within the target priority. `None` appends to the end.
    pub before_id: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_valid_priority(priority: &str) -> bool {
    matches!(priority, "high" | "medium" | "low")
}

fn clamp_estimate(value: i64) -> Result<i64, String> {
    if value < 0 {
        return Err("estimate_pomodoros cannot be negative".into());
    }
    if value > 99 {
        return Err("estimate_pomodoros cannot exceed 99".into());
    }
    Ok(value)
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
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
        completed_pomodoros: row.get(14)?,
    })
}

const TASK_SELECT: &str = "SELECT t.id, t.title, t.notes, t.status, t.priority, t.sort_order,
       t.parent_id, t.category_id, t.estimate_pomodoros, t.due_at, t.start_at, t.completed_at, t.created_at, t.updated_at,
       (SELECT COUNT(*) FROM pomodoro_sessions p
         WHERE p.task_id = t.id AND p.kind = 'focus' AND p.completed = 1) AS completed_pomodoros
     FROM tasks t";

fn next_sort_order_front(
    conn: &rusqlite::Connection,
    priority: &str,
    parent_id: Option<&str>,
) -> Result<i64, String> {
    let min: Option<i64> = if let Some(parent_id) = parent_id {
        conn.query_row(
            "SELECT MIN(sort_order) FROM tasks WHERE parent_id = ?1",
            [parent_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT MIN(sort_order) FROM tasks WHERE parent_id IS NULL AND priority = ?1",
            [priority],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(min.map(|m| m - 1).unwrap_or(0))
}

fn next_sort_order_end(
    conn: &rusqlite::Connection,
    parent_id: &str,
) -> Result<i64, String> {
    let max: Option<i64> = conn
        .query_row(
            "SELECT MAX(sort_order) FROM tasks WHERE parent_id = ?1",
            [parent_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(max.map(|m| m + 1).unwrap_or(0))
}

fn collect_descendant_ids(
    conn: &rusqlite::Connection,
    root_id: &str,
) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    let mut stack = vec![root_id.to_string()];
    while let Some(id) = stack.pop() {
        let mut stmt = conn
            .prepare("SELECT id FROM tasks WHERE parent_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let child = row.map_err(|e| e.to_string())?;
            stack.push(child.clone());
            ids.push(child);
        }
    }
    Ok(ids)
}

fn cascade_field(
    conn: &rusqlite::Connection,
    root_id: &str,
    sql: &str,
    value: rusqlite::types::Value,
    updated_at: i64,
) -> Result<(), String> {
    let ids = collect_descendant_ids(conn, root_id)?;
    for id in ids {
        conn.execute(
            sql,
            rusqlite::params![value.clone(), updated_at, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_category_exists(
    conn: &rusqlite::Connection,
    category_id: &str,
) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1)",
            [category_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("Category not found".into());
    }
    Ok(())
}

fn fetch_task(conn: &rusqlite::Connection, id: &str) -> Result<Task, String> {
    conn.query_row(
        &format!("{TASK_SELECT} WHERE t.id = ?1"),
        [id],
        map_task,
    )
    .map_err(|e| e.to_string())
}

fn list_tasks_ordered(conn: &rusqlite::Connection) -> Result<Vec<Task>, String> {
    let mut stmt = conn
        .prepare(
            &format!(
                "{TASK_SELECT}
             ORDER BY
               CASE t.priority
                 WHEN 'high' THEN 0
                 WHEN 'medium' THEN 1
                 ELSE 2
               END,
               t.sort_order ASC,
               t.created_at ASC"
            ),
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], map_task)
        .map_err(|e| e.to_string())?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| e.to_string())?);
    }
    Ok(tasks)
}

#[tauri::command]
pub fn list_tasks(db: State<'_, DbState>) -> Result<Vec<Task>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    list_tasks_ordered(&conn)
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

    let priority = input.priority.unwrap_or_else(|| "high".into());
    if !is_valid_priority(&priority) {
        return Err("Invalid priority".into());
    }

    let estimate_pomodoros = clamp_estimate(input.estimate_pomodoros.unwrap_or(0))?;
    let notes = input.notes.unwrap_or_default();
    let id = Uuid::new_v4().to_string();
    let ts = now_ms();

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (priority, category_id, parent_id, sort_order) =
        if let Some(ref parent_id) = input.parent_id {
            let parent = fetch_task(&conn, parent_id)?;
            let sort_order = next_sort_order_end(&conn, parent_id)?;
            (parent.priority, parent.category_id, Some(parent.id), sort_order)
        } else {
            if let Some(ref category_id) = input.category_id {
                ensure_category_exists(&conn, category_id)?;
            }
            let sort_order = next_sort_order_front(&conn, &priority, None)?;
            (priority, input.category_id, None, sort_order)
        };

    conn.execute(
        "INSERT INTO tasks (id, title, notes, status, priority, sort_order, parent_id, category_id,
         estimate_pomodoros, due_at, start_at, completed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            id,
            title,
            notes,
            "todo",
            priority,
            sort_order,
            parent_id,
            category_id,
            estimate_pomodoros,
            Option::<i64>::None,
            Option::<i64>::None,
            Option::<i64>::None,
            ts,
            ts
        ],
    )
    .map_err(|e| e.to_string())?;

    fetch_task(&conn, &id)
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
    if let Some(ref priority) = input.priority {
        if !is_valid_priority(priority) {
            return Err("Invalid priority".into());
        }
    }
    if let Some(ref title) = input.title {
        if title.trim().is_empty() {
            return Err("Title cannot be empty".into());
        }
    }
    if let Some(estimate) = input.estimate_pomodoros {
        clamp_estimate(estimate)?;
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let existing = fetch_task(&conn, &input.id)?;

    let previous_status = existing.status.clone();
    let is_subtask = existing.parent_id.is_some();
    let title = input
        .title
        .map(|t| t.trim().to_string())
        .unwrap_or(existing.title);
    let notes = input.notes.unwrap_or(existing.notes);
    let status = input.status.unwrap_or(existing.status);
    let priority = if is_subtask {
        existing.priority.clone()
    } else {
        input.priority.unwrap_or_else(|| existing.priority.clone())
    };
    let estimate_pomodoros = input
        .estimate_pomodoros
        .unwrap_or(existing.estimate_pomodoros);
    let mut sort_order = existing.sort_order;
    if !is_subtask && priority != existing.priority {
        let max: Option<i64> = conn
            .query_row(
                "SELECT MAX(sort_order) FROM tasks WHERE parent_id IS NULL AND priority = ?1",
                [&priority],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        sort_order = max.map(|m| m + 1).unwrap_or(0);
    }

    let category_id = if is_subtask {
        existing.category_id.clone()
    } else {
        match input.category_id {
            None => existing.category_id.clone(),
            Some(None) => None,
            Some(Some(id)) => {
                ensure_category_exists(&conn, &id)?;
                Some(id)
            }
        }
    };

    let category_changed = category_id != existing.category_id;
    let priority_changed = priority != existing.priority;

    let due_at = match input.due_at {
        None => existing.due_at,
        Some(None) => None,
        Some(Some(ts)) => Some(ts),
    };

    let start_at = match input.start_at {
        None => existing.start_at,
        Some(None) => None,
        Some(Some(ts)) => Some(ts),
    };

    let updated_at = now_ms();
    let completed_at = if status == "done" {
        if previous_status == "done" {
            existing.completed_at.or(Some(updated_at))
        } else {
            Some(updated_at)
        }
    } else {
        None
    };

    conn.execute(
        "UPDATE tasks SET title = ?1, notes = ?2, status = ?3, priority = ?4, sort_order = ?5,
         category_id = ?6, estimate_pomodoros = ?7, due_at = ?8, start_at = ?9, completed_at = ?10,
         updated_at = ?11
         WHERE id = ?12",
        rusqlite::params![
            title,
            notes,
            status,
            priority,
            sort_order,
            category_id,
            estimate_pomodoros,
            due_at,
            start_at,
            completed_at,
            updated_at,
            input.id
        ],
    )
    .map_err(|e| e.to_string())?;

    if !is_subtask && category_changed {
        let value = match &category_id {
            Some(id) => rusqlite::types::Value::Text(id.clone()),
            None => rusqlite::types::Value::Null,
        };
        cascade_field(
            &conn,
            &input.id,
            "UPDATE tasks SET category_id = ?1, updated_at = ?2 WHERE id = ?3",
            value,
            updated_at,
        )?;
    }
    if !is_subtask && priority_changed {
        cascade_field(
            &conn,
            &input.id,
            "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::types::Value::Text(priority),
            updated_at,
        )?;
    }

    fetch_task(&conn, &input.id)
}

#[tauri::command]
pub fn reorder_task(
    db: State<'_, DbState>,
    input: ReorderTaskInput,
) -> Result<Vec<Task>, String> {
    if !is_valid_priority(&input.priority) {
        return Err("Invalid priority".into());
    }
    if input.before_id.as_ref() == Some(&input.id) {
        return Err("Cannot insert a task before itself".into());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let moving = fetch_task(&conn, &input.id)?;
    let sibling_parent = moving.parent_id.clone();

    if let Some(ref before_id) = input.before_id {
        let before = fetch_task(&conn, before_id)?;
        if before.parent_id != sibling_parent {
            return Err("Cannot reorder a task outside its parent".into());
        }
        if sibling_parent.is_none() && before.priority != input.priority {
            return Err("before_id is not in the target priority group".into());
        }
    }

    let mut ordered_ids: Vec<String> = if let Some(ref parent_id) = sibling_parent {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM tasks WHERE parent_id = ?1 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([parent_id.as_str()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok())
            .filter(|id| id != &input.id)
            .collect()
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM tasks WHERE parent_id IS NULL AND priority = ?1 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([input.priority.as_str()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok())
            .filter(|id| id != &input.id)
            .collect()
    };

    let insert_at = match &input.before_id {
        Some(before_id) => ordered_ids
            .iter()
            .position(|id| id == before_id)
            .ok_or_else(|| "before_id not found in target group".to_string())?,
        None => ordered_ids.len(),
    };
    ordered_ids.insert(insert_at, input.id.clone());

    let updated_at = now_ms();
    let next_priority = if sibling_parent.is_some() {
        moving.priority.clone()
    } else {
        input.priority.clone()
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![next_priority, updated_at, input.id],
    )
    .map_err(|e| e.to_string())?;

    if sibling_parent.is_none() && moving.priority != input.priority {
        cascade_field(
            &tx,
            &input.id,
            "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::types::Value::Text(input.priority.clone()),
            updated_at,
        )?;
    }

    for (idx, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE tasks SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![idx as i64, updated_at, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    if sibling_parent.is_none() && moving.priority != input.priority {
        let old_ids: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id FROM tasks WHERE parent_id IS NULL AND priority = ?1 ORDER BY sort_order ASC, created_at ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&moving.priority], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for (idx, id) in old_ids.iter().enumerate() {
            conn.execute(
                "UPDATE tasks SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![idx as i64, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    list_tasks_ordered(&conn)
}

#[tauri::command]
pub fn delete_task(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    fetch_task(&conn, &id)?;
    let mut ids = collect_descendant_ids(&conn, &id)?;
    ids.push(id);
    for task_id in ids.into_iter().rev() {
        conn.execute("DELETE FROM tasks WHERE id = ?1", [&task_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_task(db: State<'_, DbState>, id: String) -> Result<Task, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    fetch_task(&conn, &id)
}
