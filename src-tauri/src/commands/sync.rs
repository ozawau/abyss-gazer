use crate::db::{open_db, DbState};
use crate::system_config::{
    db_file_in, normalize_system_settings, read_system_settings, resolve_active_data_dir,
    resolve_config_dir, write_system_settings, SyncMethod, SystemSettings,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

fn checkpoint_db(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("checkpoint database: {e}"))?;
    Ok(())
}

fn copy_db_file(src: &Path, dest_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("create backup dir: {e}"))?;
    let dest = dest_dir.join(
        src.file_name()
            .ok_or_else(|| "invalid database file name".to_string())?,
    );
    fs::copy(src, &dest).map_err(|e| format!("copy database to {}: {e}", dest.display()))?;
    Ok(())
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("无法执行 git（请确认已安装）: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(if stdout.is_empty() { stderr } else { stdout });
    }
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit {}", output.status)
    };
    Err(format!("git {} 失败: {detail}", args.join(" ")))
}

fn ensure_git_repo(dir: &Path) -> Result<(), String> {
    if !dir.join(".git").exists() {
        return Err(format!(
            "数据目录不是 git 仓库：{}",
            dir.display()
        ));
    }
    Ok(())
}

fn sync_local(db_path: &Path, backup_dir: &str) -> Result<(), String> {
    let dest = PathBuf::from(backup_dir.trim());
    if backup_dir.trim().is_empty() {
        return Err("请先选择本地备份目录".into());
    }
    if !dest.exists() {
        return Err(format!("备份目录不存在：{}", dest.display()));
    }
    if !dest.is_dir() {
        return Err(format!("备份路径不是目录：{}", dest.display()));
    }
    copy_db_file(db_path, &dest)
}

fn sync_git(data_dir: &Path, message: &str) -> Result<(), String> {
    ensure_git_repo(data_dir)?;
    run_git(data_dir, &["pull", "--rebase", "--autostash"]).map_err(|e| {
        if e.to_lowercase().contains("conflict") || e.contains("CONFLICT") {
            format!("git 同步冲突，已停止同步。{e}")
        } else if e.contains("Could not resolve")
            || e.contains("unable to access")
            || e.contains("Failed to connect")
            || e.contains("Network is unreachable")
        {
            format!("无法连接远程仓库，已停止同步。{e}")
        } else {
            e
        }
    })?;

    run_git(data_dir, &["add", "-A"])?;
    let status = run_git(data_dir, &["status", "--porcelain"])?;
    if !status.is_empty() {
        match run_git(data_dir, &["commit", "-m", message]) {
            Ok(_) => {}
            Err(e) if e.contains("nothing to commit") => {}
            Err(e) => return Err(e),
        }
    }

    run_git(data_dir, &["push"]).map_err(|e| {
        if e.to_lowercase().contains("conflict")
            || e.contains("non-fast-forward")
            || e.contains("rejected")
        {
            format!("git 推送冲突，已停止同步。{e}")
        } else if e.contains("Could not resolve")
            || e.contains("unable to access")
            || e.contains("Failed to connect")
            || e.contains("Network is unreachable")
        {
            format!("无法连接远程仓库，已停止同步。{e}")
        } else {
            e
        }
    })?;
    Ok(())
}

fn disable_sync(app: &AppHandle) -> Result<(), String> {
    let mut settings = read_system_settings(app)?;
    settings.sync_enabled = false;
    write_system_settings(app, &settings)
}

#[tauri::command]
pub fn get_system_settings(app: AppHandle) -> Result<SystemSettings, String> {
    read_system_settings(&app)
}

#[tauri::command]
pub fn get_default_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(resolve_config_dir(&app)?.display().to_string())
}

#[tauri::command]
pub fn get_active_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(resolve_active_data_dir(&app)?.display().to_string())
}

#[tauri::command]
pub fn set_system_settings(
    app: AppHandle,
    settings: SystemSettings,
) -> Result<SystemSettings, String> {
    let normalized = normalize_system_settings(settings);
    write_system_settings(&app, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
pub fn set_data_directory(
    app: AppHandle,
    db: State<'_, DbState>,
    path: String,
) -> Result<SystemSettings, String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("数据目录不能为空".into());
    }
    let new_dir = PathBuf::from(&trimmed);
    fs::create_dir_all(&new_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    if !new_dir.is_dir() {
        return Err(format!("路径不是目录：{}", new_dir.display()));
    }

    let new_db_path = db_file_in(&new_dir);
    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut db_path = db.db_path.lock().map_err(|e| e.to_string())?;
        checkpoint_db(&conn)?;
        if !new_db_path.exists() {
            fs::copy(&*db_path, &new_db_path)
                .map_err(|e| format!("复制数据库到新目录失败: {e}"))?;
        }
        let new_conn =
            open_db(&new_db_path).map_err(|e| format!("打开新数据库失败: {e}"))?;
        *conn = new_conn;
        *db_path = new_db_path;
    }

    let mut settings = read_system_settings(&app)?;
    settings.data_dir = Some(trimmed);
    let normalized = normalize_system_settings(settings);
    write_system_settings(&app, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
pub fn run_data_sync(app: AppHandle, db: State<'_, DbState>) -> Result<(), String> {
    let settings = read_system_settings(&app)?;
    if !settings.sync_enabled {
        return Ok(());
    }

    let result = (|| -> Result<(), String> {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let db_path = db.db_path.lock().map_err(|e| e.to_string())?;
        checkpoint_db(&conn)?;
        match settings.sync_method {
            SyncMethod::Local => {
                let backup = settings
                    .local_backup_dir
                    .as_deref()
                    .unwrap_or("");
                sync_local(&db_path, backup)
            }
            SyncMethod::Git => {
                let data_dir = resolve_active_data_dir(&app)?;
                sync_git(&data_dir, &settings.git_commit_message)
            }
        }
    })();

    if let Err(err) = result {
        let _ = disable_sync(&app);
        return Err(err);
    }
    Ok(())
}
