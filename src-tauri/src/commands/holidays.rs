use crate::system_config;
use std::fs;
use tauri::AppHandle;

const CACHE_FILE: &str = "cn-holidays-cache.json";

#[tauri::command]
pub fn read_cn_holidays_cache(app: AppHandle) -> Result<Option<String>, String> {
    let path = system_config::resolve_config_dir(&app)?.join(CACHE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read holiday cache: {e}"))?;
    Ok(Some(raw))
}

#[tauri::command]
pub fn write_cn_holidays_cache(app: AppHandle, json: String) -> Result<(), String> {
    let dir = system_config::resolve_config_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    let path = dir.join(CACHE_FILE);
    fs::write(&path, json).map_err(|e| format!("write holiday cache: {e}"))?;
    Ok(())
}
