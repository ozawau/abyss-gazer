use crate::db::{open_db, DbState};
use crate::system_config::{
    db_file_in, normalize_system_settings, read_system_settings, resolve_active_data_dir,
    resolve_config_dir, write_system_settings, SyncMethod, SystemSettings,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex as SyncGate;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Only one sync runs at a time. A second request returns immediately.
static SYNC_GATE: SyncGate<()> = SyncGate::new(());

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
        .stdin(Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "/usr/bin/false")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .env("GIT_EDITOR", "true")
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

/// Register or remove the OS login item.
/// macOS writes a LaunchAgent plist. Windows writes the current-user Run key,
/// with the exe path quoted.
pub fn apply_launch_at_login(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch
            .enable()
            .map_err(|e| format!("开启开机启动失败: {e}"))?;
        #[cfg(target_os = "macos")]
        set_macos_service_enabled(true);
        #[cfg(windows)]
        write_windows_run_value()?;
        Ok(())
    } else {
        #[cfg(target_os = "macos")]
        set_macos_service_enabled(false);
        let current = autolaunch
            .is_enabled()
            .map_err(|e| format!("读取开机启动状态失败: {e}"))?;
        if current {
            autolaunch
                .disable()
                .map_err(|e| format!("关闭开机启动失败: {e}"))?;
        }
        Ok(())
    }
}

const LAUNCH_AT_LOGIN_LABEL: &str = "Abyss Gazer";

/// Live OS state. macOS checks the LaunchAgent plist and whether System
/// Settings has disabled that service. Windows checks the Run key and the
/// Task Manager startup switch. A failed lookup leaves the saved value alone.
fn os_launch_at_login_enabled(app: &AppHandle) -> Result<bool, String> {
    let registered = app
        .autolaunch()
        .is_enabled()
        .map_err(|e| format!("读取开机启动状态失败: {e}"))?;
    if !registered {
        return Ok(false);
    }
    #[cfg(target_os = "macos")]
    if macos_service_disabled() {
        return Ok(false);
    }
    Ok(true)
}

#[cfg(target_os = "macos")]
fn macos_service_disabled() -> bool {
    let Some(uid) = current_uid() else {
        return false;
    };
    let domain = format!("gui/{uid}");
    if let Some(output) = command_output(
        Command::new("launchctl").args(["print-disabled", &domain]),
        Duration::from_millis(800),
    ) {
        if output.status.success()
            && service_marked_disabled(
                &String::from_utf8_lossy(&output.stdout),
                LAUNCH_AT_LOGIN_LABEL,
            )
        {
            return true;
        }
    }
    let target = format!("{domain}/{LAUNCH_AT_LOGIN_LABEL}");
    if let Some(output) = command_output(
        Command::new("launchctl").args(["print", &target]),
        Duration::from_millis(800),
    ) {
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if text.contains("state = disabled") {
            return true;
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn set_macos_service_enabled(enabled: bool) {
    let Some(uid) = current_uid() else {
        return;
    };
    let action = if enabled { "enable" } else { "disable" };
    let target = format!("gui/{uid}/{LAUNCH_AT_LOGIN_LABEL}");
    let _ = command_output(
        Command::new("launchctl").args([action, &target]),
        Duration::from_millis(800),
    );
}

#[cfg(target_os = "macos")]
fn current_uid() -> Option<u32> {
    let output = command_output(Command::new("id").arg("-u"), Duration::from_millis(500))?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .ok()
}

fn command_output(cmd: &mut Command, timeout: Duration) -> Option<std::process::Output> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
}

fn service_marked_disabled(text: &str, label: &str) -> bool {
    let needle = format!("\"{label}\"");
    for line in text.lines() {
        if !line.contains(&needle) {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.contains("=> false") || lower.contains("=> enabled") {
            return false;
        }
        if lower.contains("=> true") || lower.contains("=> disabled") {
            return true;
        }
    }
    false
}

/// The autostart plugin writes the exe path unquoted. Paths that contain spaces
/// (this app's install directory does) are split by Windows, so rewrite the value.
#[cfg(windows)]
fn write_windows_run_value() -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let exe = std::env::current_exe().map_err(|e| format!("读取程序路径失败: {e}"))?;
    let command = format!("\"{}\"", exe.display());
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey_with_flags(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    )
    .map_err(|e| format!("打开启动项注册表失败: {e}"))?
    .set_value("Abyss Gazer", &command)
    .map_err(|e| format!("写入开机启动失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_system_settings(app: AppHandle) -> Result<SystemSettings, String> {
    let mut settings = read_system_settings(&app)?;
    if let Ok(enabled) = os_launch_at_login_enabled(&app) {
        if settings.launch_at_login != enabled {
            settings.launch_at_login = enabled;
            let _ = write_system_settings(&app, &settings);
        }
    }
    Ok(settings)
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
pub async fn set_system_settings(
    app: AppHandle,
    settings: SystemSettings,
) -> Result<SystemSettings, String> {
    let normalized = normalize_system_settings(settings);
    let previous = read_system_settings(&app)?;
    if previous.launch_at_login != normalized.launch_at_login {
        let enabled = normalized.launch_at_login;
        let app_for_login = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            apply_launch_at_login(&app_for_login, enabled)
        })
        .await
        .map_err(|e| format!("开机启动失败: {e}"))??;
    }
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
pub async fn run_data_sync(app: AppHandle, db: State<'_, DbState>) -> Result<(), String> {
    let settings = read_system_settings(&app)?;
    if !settings.sync_enabled {
        return Ok(());
    }

    let method = settings.sync_method;
    let message = settings.git_commit_message.clone();
    let backup = settings.local_backup_dir.clone();
    let db_path = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let db_path = db.db_path.lock().map_err(|e| e.to_string())?;
        checkpoint_db(&conn)?;
        db_path.clone()
    };

    let app_for_sync = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let Ok(_gate) = SYNC_GATE.try_lock() else {
            return Ok(());
        };
        match method {
            SyncMethod::Local => {
                let backup = backup.as_deref().unwrap_or("");
                sync_local(&db_path, backup)
            }
            SyncMethod::Git => {
                let data_dir = resolve_active_data_dir(&app_for_sync)?;
                sync_git(&data_dir, &message)
            }
        }
    })
    .await
    .map_err(|e| format!("同步任务失败: {e}"))?;

    if let Err(err) = result {
        let _ = disable_sync(&app);
        return Err(err);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::service_marked_disabled;

    #[test]
    fn disabled_launch_agent_lines() {
        assert!(service_marked_disabled(
            "disabled services = {\n\t\"Abyss Gazer\" => disabled\n}\n",
            "Abyss Gazer",
        ));
        assert!(service_marked_disabled(
            "\t\"Abyss Gazer\" => true\n",
            "Abyss Gazer",
        ));
        assert!(!service_marked_disabled(
            "\t\"Abyss Gazer\" => false\n",
            "Abyss Gazer",
        ));
        assert!(!service_marked_disabled(
            "\t\"Abyss Gazer\" => enabled\n",
            "Abyss Gazer",
        ));
        assert!(!service_marked_disabled(
            "\t\"com.example.Abyss Gazer Helper\" => disabled\n",
            "Abyss Gazer",
        ));
    }
}
