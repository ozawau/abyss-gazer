use tauri::{AppHandle, Manager};

/// Phones have no menu-bar tray. Keep the command so the timer still updates
/// the window title, and ignore the tray-only fields.
#[tauri::command]
pub fn set_pomodoro_tray(
    app: AppHandle,
    title: String,
    tooltip: String,
    window_title: String,
    badge: String,
) -> Result<(), String> {
    let _ = (title, tooltip, badge);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_title(&window_title);
    }
    Ok(())
}
