use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct HabitCheckin {
    pub task_id: String,
    pub day: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HabitCheckinItem {
    pub habit_id: String,
    pub task_id: String,
    pub day: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveHabitCheckinInput {
    pub task_id: String,
    pub day: String,
    pub checked: bool,
    pub note: String,
    pub task_ids: Vec<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    bytes
        .iter()
        .enumerate()
        .all(|(index, ch)| index == 4 || index == 7 || ch.is_ascii_digit())
}

fn task_exists(conn: &rusqlite::Connection, task_id: &str) -> Result<bool, String> {
    match conn.query_row(
        "SELECT 1 FROM tasks WHERE id = ?1",
        [task_id],
        |_| Ok(1i64),
    ) {
        Ok(_) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn list_habit_checkins(
    db: State<'_, DbState>,
    start_day: String,
    end_day: String,
) -> Result<Vec<HabitCheckin>, String> {
    if !valid_day(&start_day) || !valid_day(&end_day) || end_day < start_day {
        return Err("日期范围无效".into());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT task_id, day, note FROM habit_checkins
             WHERE day >= ?1 AND day <= ?2
             ORDER BY day ASC, task_id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![start_day, end_day], |row| {
            Ok(HabitCheckin {
                task_id: row.get(0)?,
                day: row.get(1)?,
                note: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Returns whether the task is checked in on that day after the toggle.
#[tauri::command]
pub fn toggle_habit_checkin(
    db: State<'_, DbState>,
    task_id: String,
    day: String,
) -> Result<bool, String> {
    if !valid_day(&day) {
        return Err("日期无效".into());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    if !task_exists(&conn, &task_id)? {
        return Err("任务不存在".into());
    }
    let existing = match conn.query_row(
        "SELECT 1 FROM habit_checkins WHERE task_id = ?1 AND day = ?2",
        rusqlite::params![task_id, day],
        |_| Ok(1i64),
    ) {
        Ok(_) => true,
        Err(rusqlite::Error::QueryReturnedNoRows) => false,
        Err(err) => return Err(err.to_string()),
    };
    if existing {
        conn.execute(
            "DELETE FROM habit_checkins WHERE task_id = ?1 AND day = ?2",
            rusqlite::params![task_id, day],
        )
        .map_err(|e| e.to_string())?;
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO habit_checkins (task_id, day, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![task_id, day, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn list_habit_checkin_items(
    db: State<'_, DbState>,
    start_day: String,
    end_day: String,
) -> Result<Vec<HabitCheckinItem>, String> {
    if !valid_day(&start_day) || !valid_day(&end_day) || end_day < start_day {
        return Err("日期范围无效".into());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT habit_id, task_id, day FROM habit_checkin_items
             WHERE day >= ?1 AND day <= ?2
             ORDER BY day ASC, habit_id ASC, task_id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![start_day, end_day], |row| {
            Ok(HabitCheckinItem {
                habit_id: row.get(0)?,
                task_id: row.get(1)?,
                day: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn in_habit_tree(conn: &rusqlite::Connection, habit_id: &str, task_id: &str) -> Result<bool, String> {
    if task_id == habit_id {
        return Ok(true);
    }
    let mut current = task_id.to_string();
    let mut seen = std::collections::HashSet::new();
    seen.insert(current.clone());
    loop {
        let parent: Option<String> = match conn.query_row(
            "SELECT parent_id FROM tasks WHERE id = ?1",
            [&current],
            |row| row.get(0),
        ) {
            Ok(parent) => parent,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
            Err(err) => return Err(err.to_string()),
        };
        let Some(parent_id) = parent else {
            return Ok(false);
        };
        if parent_id == habit_id {
            return Ok(true);
        }
        if !seen.insert(parent_id.clone()) {
            return Ok(false);
        }
        current = parent_id;
    }
}

#[tauri::command]
pub fn save_habit_checkin(
    db: State<'_, DbState>,
    input: SaveHabitCheckinInput,
) -> Result<(), String> {
    if !valid_day(&input.day) {
        return Err("日期无效".into());
    }
    let note = input.note.trim();
    if note.chars().count() > 4000 {
        return Err("描述不能超过 4000 字".into());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    if !task_exists(&conn, &input.task_id)? {
        return Err("任务不存在".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if !input.checked {
        tx.execute(
            "DELETE FROM habit_checkin_items WHERE habit_id = ?1 AND day = ?2",
            rusqlite::params![input.task_id, input.day],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM habit_checkins WHERE task_id = ?1 AND day = ?2",
            rusqlite::params![input.task_id, input.day],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut task_ids = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for task_id in input.task_ids {
        if !seen.insert(task_id.clone()) {
            continue;
        }
        if in_habit_tree(&tx, &input.task_id, &task_id)? {
            task_ids.push(task_id);
        }
    }

    tx.execute(
        "INSERT INTO habit_checkins (task_id, day, created_at, note)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(task_id, day) DO UPDATE SET note = excluded.note",
        rusqlite::params![input.task_id, input.day, now_ms(), note],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM habit_checkin_items WHERE habit_id = ?1 AND day = ?2",
        rusqlite::params![input.task_id, input.day],
    )
    .map_err(|e| e.to_string())?;
    for task_id in task_ids {
        tx.execute(
            "INSERT INTO habit_checkin_items (habit_id, task_id, day) VALUES (?1, ?2, ?3)",
            rusqlite::params![input.task_id, task_id, input.day],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
