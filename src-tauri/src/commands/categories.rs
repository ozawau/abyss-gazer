use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryInput {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCategoryInput {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_valid_color(color: &str) -> bool {
    let c = color.trim();
    if !c.starts_with('#') || !(c.len() == 7 || c.len() == 4) {
        return false;
    }
    c.chars().skip(1).all(|ch| ch.is_ascii_hexdigit())
}

fn map_category(row: &rusqlite::Row<'_>) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
    })
}

#[tauri::command]
pub fn list_categories(db: State<'_, DbState>) -> Result<Vec<Category>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, created_at FROM categories ORDER BY created_at ASC, name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_category)
        .map_err(|e| e.to_string())?;
    let mut categories = Vec::new();
    for row in rows {
        categories.push(row.map_err(|e| e.to_string())?);
    }
    Ok(categories)
}

#[tauri::command]
pub fn create_category(
    db: State<'_, DbState>,
    input: CreateCategoryInput,
) -> Result<Category, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("Category name cannot be empty".into());
    }
    let color = input.color.trim().to_string();
    if !is_valid_color(&color) {
        return Err("Invalid color".into());
    }

    let category = Category {
        id: Uuid::new_v4().to_string(),
        name,
        color,
        created_at: now_ms(),
    };

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO categories (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            category.id,
            category.name,
            category.color,
            category.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(category)
}

#[tauri::command]
pub fn update_category(
    db: State<'_, DbState>,
    input: UpdateCategoryInput,
) -> Result<Category, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let existing: Category = conn
        .query_row(
            "SELECT id, name, color, created_at FROM categories WHERE id = ?1",
            [&input.id],
            map_category,
        )
        .map_err(|e| e.to_string())?;

    let name = input
        .name
        .map(|n| n.trim().to_string())
        .unwrap_or(existing.name);
    if name.is_empty() {
        return Err("Category name cannot be empty".into());
    }
    let color = input
        .color
        .map(|c| c.trim().to_string())
        .unwrap_or(existing.color);
    if !is_valid_color(&color) {
        return Err("Invalid color".into());
    }

    conn.execute(
        "UPDATE categories SET name = ?1, color = ?2 WHERE id = ?3",
        rusqlite::params![name, color, input.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Category {
        id: input.id,
        name,
        color,
        created_at: existing.created_at,
    })
}

#[tauri::command]
pub fn delete_category(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE tasks SET category_id = NULL WHERE category_id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    let changed = conn
        .execute("DELETE FROM categories WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Category not found".into());
    }
    Ok(())
}
