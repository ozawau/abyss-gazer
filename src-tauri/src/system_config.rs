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
    pub local_backup_dir: Option<String>,
    pub git_commit_message: String,
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
            local_backup_dir: None,
            git_commit_message: "chore: sync Abyss Gazer data".into(),
            week_starts_on: default_week_starts_on(),
            gantt_activity_mode: default_gantt_activity_mode(),
            launch_at_login: false,
            language: default_language(),
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

pub fn normalize_system_settings(settings: SystemSettings) -> SystemSettings {
    let data_dir = settings
        .data_dir
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let local_backup_dir = settings
        .local_backup_dir
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
        local_backup_dir,
        git_commit_message,
        week_starts_on: normalize_week_starts_on(settings.week_starts_on),
        gantt_activity_mode: normalize_gantt_activity_mode(&settings.gantt_activity_mode),
        launch_at_login: settings.launch_at_login,
        language: normalize_language(&settings.language),
    }
}

/// Default data root (database). Config files live in `~/.config/abyss-gazer`.
pub fn resolve_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = home_dir(app)?;

    #[cfg(target_os = "macos")]
    let dir = home.join("Library/Application Support/Abyss Gazer");

    #[cfg(target_os = "windows")]
    let dir = home.join("AppData/Roaming/Abyss Gazer");

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let dir = home.join(".local/share/abyss-gazer");

    Ok(dir)
}

/// Location of `system.json`: `~/.config/abyss-gazer`.
pub fn resolve_system_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(home_dir(app)?.join(".config").join("abyss-gazer"))
}

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
