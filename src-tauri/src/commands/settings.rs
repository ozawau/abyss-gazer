use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

const POMODORO_SETTINGS_KEY: &str = "pomodoro";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSettings {
    pub focus_minutes: i64,
    pub breaks_enabled: bool,
    pub short_break_minutes: i64,
    pub long_break_enabled: bool,
    pub long_break_minutes: i64,
    pub long_break_interval: i64,
    pub auto_start_focus: bool,
    pub auto_start_break: bool,
}

impl Default for PomodoroSettings {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            breaks_enabled: true,
            short_break_minutes: 5,
            long_break_enabled: true,
            long_break_minutes: 15,
            long_break_interval: 4,
            auto_start_focus: false,
            auto_start_break: false,
        }
    }
}

fn clamp_minutes(value: i64, fallback: i64) -> i64 {
    if value < 1 {
        return fallback.max(1);
    }
    value.min(180)
}

fn clamp_interval(value: i64) -> i64 {
    if value < 1 {
        return 1;
    }
    value.min(99)
}

fn normalize(settings: PomodoroSettings) -> PomodoroSettings {
    PomodoroSettings {
        focus_minutes: clamp_minutes(settings.focus_minutes, 25),
        breaks_enabled: settings.breaks_enabled,
        short_break_minutes: clamp_minutes(settings.short_break_minutes, 5),
        long_break_enabled: settings.long_break_enabled,
        long_break_minutes: clamp_minutes(settings.long_break_minutes, 15),
        long_break_interval: clamp_interval(settings.long_break_interval),
        auto_start_focus: settings.auto_start_focus,
        auto_start_break: settings.auto_start_break,
    }
}

fn read_pomodoro_settings(conn: &rusqlite::Connection) -> Result<PomodoroSettings, String> {
    let value: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        [POMODORO_SETTINGS_KEY],
        |row| row.get(0),
    );
    match value {
        Ok(raw) => {
            let parsed: PomodoroSettings =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(normalize(parsed))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(PomodoroSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_pomodoro_settings(db: State<'_, DbState>) -> Result<PomodoroSettings, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    read_pomodoro_settings(&conn)
}

#[tauri::command]
pub fn set_pomodoro_settings(
    db: State<'_, DbState>,
    settings: PomodoroSettings,
) -> Result<PomodoroSettings, String> {
    let normalized = normalize(settings);
    let raw = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![POMODORO_SETTINGS_KEY, raw],
    )
    .map_err(|e| e.to_string())?;
    Ok(normalized)
}
