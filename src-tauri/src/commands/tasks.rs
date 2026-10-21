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
    pub completed_pomodoros: f64,
    pub due_at: Option<i64>,
    pub start_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub recurrence: Option<String>,
    pub recurrence_source_id: Option<String>,
    pub recurrence_occurrence: Option<String>,
    /// `null` means the habit is due every day. Otherwise a JSON array of weekday numbers, Sunday = 0.
    pub checkin_weekdays: Option<String>,
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
    /// Missing = leave unchanged; `null` = clear; string = set.
    #[serde(default)]
    pub recurrence: Option<Option<String>>,
    /// Missing = leave unchanged; `null` = every day; string = weekday list.
    #[serde(default)]
    pub checkin_weekdays: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct SpawnRecurringItem {
    pub template_id: String,
    pub occurrence: String,
    pub start_at: i64,
}

#[derive(Debug, Serialize)]
pub struct SpawnRecurringOutcome {
    pub created: Vec<Task>,
    pub settled: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReparentTaskInput {
    pub id: String,
    /// `None` promotes the task to a root (outermost) task.
    pub parent_id: Option<String>,
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

/// Local edits must win over the last exported sync revision (same millisecond / stale remote).
fn monotonic_updated_at(previous: i64) -> i64 {
    now_ms().max(previous.saturating_add(1))
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
        recurrence: row.get(14)?,
        recurrence_source_id: row.get(15)?,
        recurrence_occurrence: row.get(16)?,
        checkin_weekdays: row.get(17)?,
        completed_pomodoros: row.get(18)?,
    })
}

const TASK_SELECT: &str = "SELECT t.id, t.title, t.notes, t.status, t.priority, t.sort_order,
       t.parent_id, t.category_id, t.estimate_pomodoros, t.due_at, t.start_at, t.completed_at, t.created_at, t.updated_at,
       t.recurrence, t.recurrence_source_id, t.recurrence_occurrence, t.checkin_weekdays,
       CAST(COALESCE((SELECT SUM(p.credit) FROM pomodoro_sessions p
         WHERE p.kind = 'focus' AND p.completed = 1
           AND p.task_id IN (
             WITH RECURSIVE subtree(id) AS (
               SELECT t.id
               UNION ALL
               SELECT child.id FROM tasks child
               INNER JOIN subtree ON child.parent_id = subtree.id
             )
             SELECT id FROM subtree
           )), 0) AS REAL) AS completed_pomodoros
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

fn complete_descendants(
    conn: &rusqlite::Connection,
    root_id: &str,
    updated_at: i64,
) -> Result<(), String> {
    for id in collect_descendant_ids(conn, root_id)? {
        conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = COALESCE(completed_at, ?1), updated_at = ?1 WHERE id = ?2",
            rusqlite::params![updated_at, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
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

    let recurrence = match input.recurrence {
        None => existing.recurrence.clone(),
        Some(None) => None,
        Some(Some(raw)) => Some(canonical_recurrence(&raw)?),
    };

    let checkin_weekdays = match input.checkin_weekdays {
        None => existing.checkin_weekdays.clone(),
        Some(None) => None,
        Some(Some(raw)) => canonical_checkin_weekdays(&raw)?,
    };

    let updated_at = monotonic_updated_at(existing.updated_at);
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
         recurrence = ?11, checkin_weekdays = ?12, updated_at = ?13
         WHERE id = ?14",
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
            recurrence,
            checkin_weekdays,
            updated_at,
            input.id
        ],
    )
    .map_err(|e| e.to_string())?;

    if status == "done" && previous_status != "done" {
        complete_descendants(&conn, &input.id, updated_at)?;
    }

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
pub fn reparent_task(
    db: State<'_, DbState>,
    input: ReparentTaskInput,
) -> Result<Vec<Task>, String> {
    if input.parent_id.as_ref() == Some(&input.id) {
        return Err("不能将任务设为自己的子任务".into());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let moving = fetch_task(&conn, &input.id)?;
    let updated_at = now_ms();

    let (parent_id, priority, category_id, sort_order) =
        if let Some(ref parent_id) = input.parent_id {
            let parent = fetch_task(&conn, parent_id)?;
            let descendants = collect_descendant_ids(&conn, &input.id)?;
            if descendants.iter().any(|id| id == parent_id) {
                return Err("不能移动到自身下级任务下".into());
            }
            let sort_order = next_sort_order_end(&conn, parent_id)?;
            (
                Some(parent.id),
                parent.priority,
                parent.category_id,
                sort_order,
            )
        } else {
            let priority = moving.priority.clone();
            let category_id = moving.category_id.clone();
            let sort_order = next_sort_order_front(&conn, &priority, None)?;
            (None, priority, category_id, sort_order)
        };

    conn.execute(
        "UPDATE tasks SET parent_id = ?1, priority = ?2, category_id = ?3, sort_order = ?4, updated_at = ?5
         WHERE id = ?6",
        rusqlite::params![
            parent_id,
            priority,
            category_id,
            sort_order,
            updated_at,
            input.id
        ],
    )
    .map_err(|e| e.to_string())?;
    cascade_field(
        &conn,
        &input.id,
        "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::types::Value::Text(priority),
        updated_at,
    )?;
    let category_value = match &category_id {
        Some(id) => rusqlite::types::Value::Text(id.clone()),
        None => rusqlite::types::Value::Null,
    };
    cascade_field(
        &conn,
        &input.id,
        "UPDATE tasks SET category_id = ?1, updated_at = ?2 WHERE id = ?3",
        category_value,
        updated_at,
    )?;
    list_tasks_ordered(&conn)
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
        crate::sync_logical::record_tombstone(&conn, "task", &task_id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_task(db: State<'_, DbState>, id: String) -> Result<Task, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    fetch_task(&conn, &id)
}

const RECURRENCE_NAMESPACE: Uuid = uuid::uuid!("c0ffee00-7a51-4eec-9a11-ab9550a2e001");

fn is_day_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes.iter().enumerate().all(|(index, byte)| {
            index == 4 || index == 7 || byte.is_ascii_digit()
        })
}

fn read_number_list(
    obj: &serde_json::Map<String, serde_json::Value>,
    plural: &str,
    singular: &str,
    min: i64,
    max: i64,
) -> Result<Vec<i64>, String> {
    let raw = obj
        .get(plural)
        .or_else(|| obj.get(singular))
        .ok_or_else(|| "Invalid recurrence".to_string())?;
    let values = if let Some(list) = raw.as_array() {
        if list.is_empty() {
            return Err("Invalid recurrence".into());
        }
        list.iter()
            .map(|item| item.as_i64().ok_or_else(|| "Invalid recurrence".to_string()))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![raw.as_i64().ok_or_else(|| "Invalid recurrence".to_string())?]
    };
    let mut nums = Vec::new();
    for n in values {
        if !(min..=max).contains(&n) {
            return Err("Invalid recurrence".into());
        }
        if !nums.contains(&n) {
            nums.push(n);
        }
    }
    nums.sort_unstable();
    Ok(nums)
}

fn read_counts(
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Result<(&'static str, Vec<i64>), String> {
    if obj.get("indexes").is_none() && obj.get("index").and_then(|item| item.as_str()) == Some("last")
    {
        return Ok(("backward", vec![1]));
    }
    let indexes = if obj.contains_key("indexes") {
        read_number_list(obj, "indexes", "indexes", 1, 31)?
    } else {
        read_number_list(obj, "index", "index", 1, 31)?
    };
    let direction = match obj.get("direction").and_then(|item| item.as_str()) {
        Some("backward") => "backward",
        Some("forward") | None => "forward",
        _ => return Err("Invalid recurrence".into()),
    };
    Ok((direction, indexes))
}

/// `None` means every day. A full week is stored the same way.
fn canonical_checkin_weekdays(raw: &str) -> Result<Option<String>, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "Invalid check-in weekdays".to_string())?;
    let list = value
        .as_array()
        .ok_or_else(|| "Invalid check-in weekdays".to_string())?;
    if list.is_empty() {
        return Err("Invalid check-in weekdays".into());
    }
    let mut days = Vec::<i64>::new();
    for item in list {
        let day = item
            .as_i64()
            .ok_or_else(|| "Invalid check-in weekdays".to_string())?;
        if !(0..=6).contains(&day) {
            return Err("Invalid check-in weekdays".into());
        }
        if !days.contains(&day) {
            days.push(day);
        }
    }
    days.sort_unstable();
    if days.len() == 7 {
        return Ok(None);
    }
    Ok(Some(
        serde_json::to_string(&days).map_err(|err| err.to_string())?,
    ))
}

fn canonical_recurrence(raw: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "Invalid recurrence".to_string())?;
    let obj = value
        .as_object()
        .ok_or_else(|| "Invalid recurrence".to_string())?;
    let kind = obj
        .get("kind")
        .and_then(|item| item.as_str())
        .ok_or_else(|| "Invalid recurrence".to_string())?;
    let since = obj.get("since").and_then(|item| item.as_str()).unwrap_or("");
    if !since.is_empty() && !is_day_key(since) {
        return Err("Invalid recurrence".into());
    }

    let mut out = serde_json::Map::new();
    match kind {
        "daily" => {
            out.insert("kind".into(), serde_json::json!("daily"));
        }
        "interval" => {
            let days = obj
                .get("days")
                .and_then(|item| item.as_i64())
                .ok_or_else(|| "Invalid recurrence".to_string())?;
            if days < 1 {
                return Err("Invalid recurrence".into());
            }
            out.insert("kind".into(), serde_json::json!("interval"));
            out.insert("days".into(), serde_json::json!(days));
        }
        "weekly" => {
            let weekdays = read_number_list(obj, "weekdays", "weekday", 0, 6)?;
            out.insert("kind".into(), serde_json::json!("weekly"));
            out.insert("weekdays".into(), serde_json::json!(weekdays));
        }
        "monthly-day" => {
            let days = read_number_list(obj, "days", "day", 1, 31)?;
            let direction = match obj.get("direction").and_then(|item| item.as_str()) {
                Some("backward") => "backward",
                Some("forward") | None => "forward",
                _ => return Err("Invalid recurrence".into()),
            };
            out.insert("kind".into(), serde_json::json!("monthly-day"));
            out.insert("days".into(), serde_json::json!(days));
            out.insert("direction".into(), serde_json::json!(direction));
        }
        "monthly-workday" | "monthly-restday" => {
            let (direction, indexes) = read_counts(obj)?;
            out.insert("kind".into(), serde_json::json!(kind));
            out.insert("direction".into(), serde_json::json!(direction));
            out.insert("indexes".into(), serde_json::json!(indexes));
        }
        "monthly" => match obj.get("anchor").and_then(|item| item.as_str()) {
            Some("first-workday") => {
                out.insert("kind".into(), serde_json::json!("monthly-workday"));
                out.insert("direction".into(), serde_json::json!("forward"));
                out.insert("indexes".into(), serde_json::json!([1]));
            }
            Some("last-restday") => {
                out.insert("kind".into(), serde_json::json!("monthly-restday"));
                out.insert("direction".into(), serde_json::json!("backward"));
                out.insert("indexes".into(), serde_json::json!([1]));
            }
            _ => return Err("Invalid recurrence".into()),
        },
        "yearly" | "lunar-yearly" => {
            let max_day: i64 = if kind == "lunar-yearly" { 30 } else { 31 };
            let months = read_number_list(obj, "months", "month", 1, 12)?;
            let days = read_number_list(obj, "days", "day", 1, max_day)?;
            out.insert("kind".into(), serde_json::json!(kind));
            out.insert("months".into(), serde_json::json!(months));
            out.insert("days".into(), serde_json::json!(days));
        }
        _ => return Err("Invalid recurrence".into()),
    }
    if !since.is_empty() {
        out.insert("since".into(), serde_json::json!(since));
    }
    serde_json::to_string(&serde_json::Value::Object(out)).map_err(|err| err.to_string())
}

fn recurrence_instance_id(template_id: &str, occurrence: &str) -> String {
    Uuid::new_v5(
        &RECURRENCE_NAMESPACE,
        format!("{template_id}:{occurrence}").as_bytes(),
    )
    .to_string()
}

fn spawn_recurring_task(
    conn: &rusqlite::Connection,
    template_id: &str,
    occurrence: &str,
    start_at: i64,
) -> Result<Option<Task>, String> {
    if !is_day_key(occurrence) {
        return Ok(None);
    }
    let template = match fetch_task(conn, template_id) {
        Ok(task) => task,
        Err(_) => return Ok(None),
    };
    let id = recurrence_instance_id(template_id, occurrence);
    let tombstoned: bool = conn
        .query_row(
            "SELECT 1 FROM sync_tombstones WHERE kind = 'task' AND entity_id = ?1",
            [&id],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if tombstoned {
        return Ok(None);
    }
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM tasks
             WHERE id = ?1
                OR (recurrence_source_id = ?2 AND recurrence_occurrence = ?3)
             LIMIT 1",
            rusqlite::params![id, template_id, occurrence],
            |row| row.get(0),
        )
        .ok();
    if existing.is_some() {
        return Ok(None);
    }

    let sort_order =
        next_sort_order_front(conn, &template.priority, template.parent_id.as_deref())?;
    let ts = now_ms();
    conn.execute(
        "INSERT INTO tasks (
            id, title, notes, status, priority, sort_order, parent_id, category_id,
            estimate_pomodoros, due_at, start_at, completed_at, created_at, updated_at,
            recurrence_source_id, recurrence_occurrence
         ) VALUES (?1, ?2, ?3, 'todo', ?4, ?5, ?6, ?7, ?8, NULL, ?9, NULL, ?10, ?10, ?11, ?12)",
        rusqlite::params![
            id,
            template.title,
            template.notes,
            template.priority,
            sort_order,
            template.parent_id,
            template.category_id,
            template.estimate_pomodoros,
            start_at,
            ts,
            template_id,
            occurrence,
        ],
    )
    .map_err(|err| err.to_string())?;
    fetch_task(conn, &id).map(Some)
}

#[tauri::command]
pub fn spawn_recurring_tasks(
    db: State<'_, DbState>,
    items: Vec<SpawnRecurringItem>,
) -> Result<SpawnRecurringOutcome, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut created = Vec::new();
    let mut settled = Vec::new();
    for item in items.into_iter().take(500) {
        let key = format!("{}:{}", item.template_id, item.occurrence);
        if let Some(task) =
            spawn_recurring_task(&conn, &item.template_id, &item.occurrence, item.start_at)?
        {
            created.push(task);
        }
        settled.push(key);
    }
    Ok(SpawnRecurringOutcome { created, settled })
}

#[cfg(test)]
mod tests {
    use super::{complete_descendants, fetch_task};
    use crate::db::open_db;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn marking_parent_done_completes_descendants() {
        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-cascade-done-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = open_db(&path).expect("open");
        conn.execute_batch(
            "INSERT INTO tasks (id, title, notes, status, priority, sort_order, parent_id, created_at, updated_at)
             VALUES
               ('p', 'Parent', '', 'todo', 'medium', 0, NULL, 1, 1),
               ('c', 'Child', '', 'todo', 'medium', 0, 'p', 1, 1),
               ('g', 'Grand', '', 'todo', 'medium', 0, 'c', 1, 1);",
        )
        .expect("seed");

        conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = 99, updated_at = 99 WHERE id = 'p'",
            [],
        )
        .expect("complete parent");
        complete_descendants(&conn, "p", 99).expect("cascade");

        for id in ["c", "g"] {
            let status: String = conn
                .query_row("SELECT status FROM tasks WHERE id = ?1", [id], |r| r.get(0))
                .expect("status");
            assert_eq!(status, "done", "task {id}");
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn completed_pomodoros_include_descendants() {
        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-rollup-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = open_db(&path).expect("open");
        conn.execute_batch(
            "INSERT INTO tasks (id, title, notes, status, priority, sort_order, parent_id, created_at, updated_at)
             VALUES
               ('p', 'Parent', '', 'todo', 'medium', 0, NULL, 1, 1),
               ('c', 'Child', '', 'todo', 'medium', 0, 'p', 1, 1),
               ('g', 'Grand', '', 'todo', 'medium', 0, 'c', 1, 1);
             INSERT INTO pomodoro_sessions
               (id, task_id, kind, planned_seconds, started_at, ended_at, completed, credit)
             VALUES
               ('s1', 'p', 'focus', 1500, 1, 2, 1, 1.0),
               ('s2', 'c', 'focus', 1500, 1, 2, 1, 0.3),
               ('s3', 'g', 'focus', 1500, 1, 2, 1, 0.5);",
        )
        .expect("seed");

        let parent = fetch_task(&conn, "p").expect("parent");
        let child = fetch_task(&conn, "c").expect("child");
        let grand = fetch_task(&conn, "g").expect("grand");
        assert!((grand.completed_pomodoros - 0.5).abs() < 0.001);
        assert!((child.completed_pomodoros - 0.8).abs() < 0.001);
        assert!((parent.completed_pomodoros - 1.8).abs() < 0.001);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn spawning_is_idempotent_and_respects_tombstones() {
        use super::spawn_recurring_task;
        use crate::sync_logical::record_tombstone;

        let path = std::env::temp_dir().join(format!(
            "abyss-gazer-recurrence-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = open_db(&path).expect("open");
        conn.execute(
            "INSERT INTO tasks (id, title, notes, status, priority, sort_order, estimate_pomodoros, created_at, updated_at, recurrence)
             VALUES ('tpl', 'Weekly', 'notes', 'todo', 'high', 0, 2, 1, 1, '{\"kind\":\"weekly\",\"weekday\":1}')",
            [],
        )
        .expect("seed");

        let first = spawn_recurring_task(&conn, "tpl", "2026-10-12", 1_700_000_000_000)
            .expect("spawn")
            .expect("created");
        assert_eq!(first.title, "Weekly");
        assert_eq!(first.notes, "notes");
        assert_eq!(first.estimate_pomodoros, 2);
        assert_eq!(first.recurrence_source_id.as_deref(), Some("tpl"));
        assert_eq!(first.recurrence_occurrence.as_deref(), Some("2026-10-12"));
        assert!(first.recurrence.is_none());
        assert!(spawn_recurring_task(&conn, "tpl", "2026-10-12", 1).expect("again").is_none());

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE recurrence_source_id = 'tpl'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);

        conn.execute("DELETE FROM tasks WHERE id = ?1", [&first.id])
            .expect("delete instance");
        record_tombstone(&conn, "task", &first.id).expect("tombstone");
        assert!(spawn_recurring_task(&conn, "tpl", "2026-10-12", 1).expect("blocked").is_none());
        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE recurrence_source_id = 'tpl'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(after, 0);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn canonical_recurrence_accepts_lists_and_legacy_values() {
        use super::canonical_recurrence;

        let weekly = canonical_recurrence(r#"{"kind":"weekly","weekday":6}"#).unwrap();
        assert!(weekly.contains(r#""weekdays":[6]"#));
        let days =
            canonical_recurrence(r#"{"kind":"monthly-day","days":[3,1,2,1]}"#).unwrap();
        assert!(days.contains(r#""days":[1,2,3]"#));
        assert!(days.contains(r#""direction":"forward""#));
        let backward = canonical_recurrence(
            r#"{"kind":"monthly-day","direction":"backward","days":[2,1],"since":"2026-10-16"}"#,
        ).unwrap();
        assert!(backward.contains(r#""direction":"backward""#));
        assert!(backward.contains(r#""days":[1,2]"#));
        assert!(backward.contains(r#""since":"2026-10-16""#));
        assert!(canonical_recurrence(r#"{"kind":"monthly-day","direction":"invalid","days":[1]}"#).is_err());
        let counted = canonical_recurrence(
            r#"{"kind":"monthly-workday","direction":"forward","indexes":[3,1]}"#,
        )
        .unwrap();
        assert!(counted.contains(r#""indexes":[1,3]"#));
        let legacy = canonical_recurrence(
            r#"{"kind":"monthly-restday","index":"last"}"#,
        )
        .unwrap();
        assert!(legacy.contains(r#""direction":"backward""#));
        assert!(legacy.contains(r#""indexes":[1]"#));
        let interval = canonical_recurrence(r#"{"kind":"interval","days":3}"#).unwrap();
        assert!(interval.contains(r#""days":3"#));
        assert!(canonical_recurrence(r#"{"kind":"interval","days":0}"#).is_err());
        assert!(canonical_recurrence(r#"{"kind":"weekly","weekdays":[]}"#).is_err());
        assert!(canonical_recurrence(r#"{"kind":"yearly","months":[1,13],"days":[1]}"#).is_err());
        assert_eq!(
            super::canonical_checkin_weekdays("[1,3,1]").unwrap().as_deref(),
            Some("[1,3]")
        );
        assert!(super::canonical_checkin_weekdays("[0,1,2,3,4,5,6]")
            .unwrap()
            .is_none());
        assert!(super::canonical_checkin_weekdays("[]").is_err());
    }
}
