use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager};

pub const TRAY_ID: &str = "pomodoro-timer";

fn focus_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn build_tray(
    app: &AppHandle,
    title: &str,
    tooltip: &str,
) -> Result<tauri::tray::TrayIcon, String> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .title(title)
        .tooltip(tooltip)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app).map_err(|e| e.to_string())
}

pub fn install_pomodoro_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    build_tray(app.handle(), "🍅 25:00", "番茄钟")?;
    Ok(())
}

fn apply_tray(app: &AppHandle, title: &str, tooltip: &str) -> Result<(), String> {
    if let Some(existing) = app.tray_by_id(TRAY_ID) {
        let ok = existing.set_title(Some(title)).is_ok()
            && existing.set_tooltip(Some(tooltip)).is_ok()
            && existing.set_visible(true).is_ok();
        if ok {
            return Ok(());
        }
        let _ = app.remove_tray_by_id(TRAY_ID);
    }
    build_tray(app, title, tooltip)?;
    Ok(())
}

#[tauri::command]
pub fn set_pomodoro_tray(
    app: AppHandle,
    title: String,
    tooltip: String,
    window_title: String,
    badge: String,
) -> Result<(), String> {
    apply_tray(&app, &title, &tooltip)?;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_title(&window_title);
        #[cfg(target_os = "macos")]
        {
            let _ = win.set_badge_label(Some(badge));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = badge;
        }
    }
    Ok(())
}
