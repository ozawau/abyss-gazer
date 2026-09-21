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
        }
    }
}

fn normalize_interval(minutes: i64) -> i64 {
    match minutes {
        5 | 10 | 30 => minutes,
        _ => 10,
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
    }
}

/// Fixed config root (always Application Support / Abyss Gazer).
pub fn resolve_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_config_dir(app)?.join(SYSTEM_CONFIG_FILE))
}

pub fn read_system_settings(app: &AppHandle) -> Result<SystemSettings, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(SystemSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read system config: {e}"))?;
    let parsed: SystemSettings =
        serde_json::from_str(&raw).map_err(|e| format!("parse system config: {e}"))?;
    Ok(normalize_system_settings(parsed))
}

pub fn write_system_settings(app: &AppHandle, settings: &SystemSettings) -> Result<(), String> {
    let dir = resolve_config_dir(app)?;
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
