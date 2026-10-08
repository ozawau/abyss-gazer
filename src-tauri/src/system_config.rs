use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SYSTEM_CONFIG_FILE: &str = "system.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncMethod {
    Local,
    Git,
}

impl Default for SyncMethod {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettings {
    /// Custom data directory. `None` means the default Application Support folder.
    pub data_dir: Option<String>,
    pub sync_enabled: bool,
    pub sync_method: SyncMethod,
    pub sync_interval_minutes: i64,
    /// When true, the desktop app syncs soon after local data mutations.
    #[serde(default)]
    pub sync_on_data_change: bool,
    pub local_backup_dir: Option<String>,
    pub git_commit_message: String,
    /// Optional HTTP(S)/SOCKS proxy for Git sync, e.g. `http://127.0.0.1:7890`.
    #[serde(default)]
    pub git_proxy: Option<String>,
    /// Calendar week start: 0=Sunday … 6=Saturday (same as JS `Date.getDay()`).
    #[serde(default = "default_week_starts_on")]
    pub week_starts_on: u8,
    #[serde(default = "default_gantt_activity_mode")]
    pub gantt_activity_mode: String,
    /// Open the app when the user logs in. Applied via the OS login item.
    #[serde(default)]
    pub launch_at_login: bool,
    /// `system` follows the OS language. Otherwise `zh` or `en`.
    #[serde(default = "default_language")]
    pub language: String,
    /// Remember whether the desktop sidebar is collapsed. Narrow layouts ignore this.
    #[serde(default)]
    pub sidebar_collapsed: bool,
    /// Parent tasks in this category appear in check-in views and widgets.
    #[serde(default)]
    pub checkin_category_id: Option<String>,
    /// Quick-add note widget creates tasks in this category.
    #[serde(default)]
    pub note_category_id: Option<String>,
}

fn default_week_starts_on() -> u8 {
    1
}

fn default_gantt_activity_mode() -> String {
    "discrete".into()
}

fn default_language() -> String {
    "system".into()
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            data_dir: None,
            sync_enabled: false,
            sync_method: SyncMethod::Local,
            sync_interval_minutes: 10,
            sync_on_data_change: false,
            local_backup_dir: None,
            git_commit_message: "chore: sync Abyss Gazer data".into(),
            git_proxy: None,
            week_starts_on: default_week_starts_on(),
            gantt_activity_mode: default_gantt_activity_mode(),
            launch_at_login: false,
            language: default_language(),
            sidebar_collapsed: false,
            checkin_category_id: None,
            note_category_id: None,
        }
    }
}

fn normalize_week_starts_on(value: u8) -> u8 {
    if value <= 6 {
        value
    } else {
        default_week_starts_on()
    }
}

fn normalize_interval(minutes: i64) -> i64 {
    match minutes {
        5 | 10 | 30 => minutes,
        _ => 10,
    }
}

fn normalize_language(value: &str) -> String {
    match value {
        "zh" | "en" | "system" => value.into(),
        _ => default_language(),
    }
}

fn normalize_gantt_activity_mode(value: &str) -> String {
    if value == "continuous" {
        "continuous".into()
    } else {
        default_gantt_activity_mode()
    }
}

fn normalize_optional_id(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn normalize_system_settings(settings: SystemSettings) -> SystemSettings {
    let data_dir = settings
        .data_dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let local_backup_dir = settings
        .local_backup_dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let git_proxy = settings
        .git_proxy
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let git_commit_message = {
        let trimmed = settings.git_commit_message.trim().to_string();
        if trimmed.is_empty() {
            "chore: sync Abyss Gazer data".into()
        } else {
            trimmed
        }
    };
    SystemSettings {
        data_dir,
        sync_enabled: settings.sync_enabled,
        sync_method: settings.sync_method,
        sync_interval_minutes: normalize_interval(settings.sync_interval_minutes),
        sync_on_data_change: settings.sync_on_data_change,
        local_backup_dir,
        git_commit_message,
        git_proxy,
        week_starts_on: normalize_week_starts_on(settings.week_starts_on),
        gantt_activity_mode: normalize_gantt_activity_mode(&settings.gantt_activity_mode),
        launch_at_login: settings.launch_at_login,
        language: normalize_language(&settings.language),
        sidebar_collapsed: settings.sidebar_collapsed,
        checkin_category_id: normalize_optional_id(settings.checkin_category_id),
        note_category_id: normalize_optional_id(settings.note_category_id),
    }
}

pub fn category_id_by_name(conn: &Connection, name: &str) -> Result<Option<String>, String> {
    let needle = name.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare("SELECT id, name FROM categories")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, label) = row.map_err(|e| e.to_string())?;
        if label.trim().to_lowercase() == needle {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

pub fn ensure_category_id(conn: &Connection, id: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM categories WHERE id = ?1 LIMIT 1",
            [id],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if exists {
        Ok(())
    } else {
        Err("所选任务分类不存在".into())
    }
}

/// One-time migration from legacy Habit / Note category names into settings.
pub fn migrate_legacy_task_category_ids(
    app: &AppHandle,
    settings: &mut SystemSettings,
) -> Result<(), String> {
    if settings.checkin_category_id.is_some() && settings.note_category_id.is_some() {
        return Ok(());
    }
    let Some(state) = app.try_state::<crate::db::DbState>() else {
        return Ok(());
    };
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut changed = false;
    if settings.checkin_category_id.is_none() {
        if let Some(id) = category_id_by_name(&conn, "habit")? {
            settings.checkin_category_id = Some(id);
            changed = true;
        }
    }
    if settings.note_category_id.is_none() {
        if let Some(id) = category_id_by_name(&conn, "note")? {
            settings.note_category_id = Some(id);
            changed = true;
        }
    }
    drop(conn);
    if changed {
        write_system_settings(app, settings)?;
        crate::widget::request_publish();
    }
    Ok(())
}

/// Default data root (database). Config files live in `~/.config/abyss-gazer`.
pub fn resolve_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        app.path()
            .app_data_dir()
            .map_err(|e| format!("resolve data dir: {e}"))
    }
    #[cfg(not(target_os = "android"))]
    {
        let home = home_dir(app)?;

        #[cfg(target_os = "macos")]
        let dir = home.join("Library/Application Support/Abyss Gazer");

        #[cfg(target_os = "windows")]
        let dir = home.join("AppData/Roaming/Abyss Gazer");

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let dir = home.join(".local/share/abyss-gazer");

        Ok(dir)
    }
}

/// Location of `system.json`: `~/.config/abyss-gazer`.
pub fn resolve_system_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        return app
            .path()
            .app_config_dir()
            .map_err(|e| format!("resolve config dir: {e}"));
    }
    #[cfg(not(target_os = "android"))]
    Ok(home_dir(app)?.join(".config").join("abyss-gazer"))
}

#[cfg(not(target_os = "android"))]
fn home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map_err(|e| format!("resolve home dir: {e}"))
}

fn system_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_system_config_dir(app)?.join(SYSTEM_CONFIG_FILE))
}

fn legacy_system_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_config_dir(app)?.join(SYSTEM_CONFIG_FILE))
}

fn parse_system_settings(raw: &str) -> Result<SystemSettings, String> {
    let parsed: SystemSettings =
        serde_json::from_str(raw).map_err(|e| format!("parse system config: {e}"))?;
    Ok(normalize_system_settings(parsed))
}

pub fn read_system_settings(app: &AppHandle) -> Result<SystemSettings, String> {
    let path = system_config_path(app)?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("read system config: {e}"))?;
        return parse_system_settings(&raw);
    }

    let legacy = legacy_system_config_path(app)?;
    if !legacy.exists() {
        return Ok(SystemSettings::default());
    }
    let raw = fs::read_to_string(&legacy).map_err(|e| format!("read system config: {e}"))?;
    let settings = parse_system_settings(&raw)?;
    let _ = write_system_settings(app, &settings);
    Ok(settings)
}

pub fn write_system_settings(app: &AppHandle, settings: &SystemSettings) -> Result<(), String> {
    let dir = resolve_system_config_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    let path = dir.join(SYSTEM_CONFIG_FILE);
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("write system config: {e}"))?;
    Ok(())
}

pub fn resolve_active_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = read_system_settings(app)?;
    if let Some(ref custom) = settings.data_dir {
        return Ok(PathBuf::from(custom));
    }
    resolve_config_dir(app)
}

pub fn db_file_in(dir: &Path) -> PathBuf {
    dir.join("abyss.db")
}
