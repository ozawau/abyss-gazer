use crate::system_config;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const CACHE_FILE: &str = "cn-holidays-cache.json";

fn holiday_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(system_config::resolve_system_config_dir(app)?.join(CACHE_FILE))
}

fn legacy_holiday_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(system_config::resolve_config_dir(app)?.join(CACHE_FILE))
}

#[tauri::command]
pub fn read_cn_holidays_cache(app: AppHandle) -> Result<Option<String>, String> {
    let path = holiday_cache_path(&app)?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("read holiday cache: {e}"))?;
        return Ok(Some(raw));
    }

    let legacy = legacy_holiday_cache_path(&app)?;
    if !legacy.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&legacy).map_err(|e| format!("read holiday cache: {e}"))?;
    let _ = write_cn_holidays_cache(app, raw.clone());
    Ok(Some(raw))
}

#[tauri::command]
pub fn write_cn_holidays_cache(app: AppHandle, json: String) -> Result<(), String> {
    let dir = system_config::resolve_system_config_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    let path = dir.join(CACHE_FILE);
    fs::write(&path, json).map_err(|e| format!("write holiday cache: {e}"))?;
    Ok(())
}
