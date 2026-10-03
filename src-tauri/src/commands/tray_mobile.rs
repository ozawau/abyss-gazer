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
    timer_active: Option<bool>,
    timer_paused: Option<bool>,
    timer_clock: Option<String>,
    timer_focus_phase: Option<bool>,
    timer_ends_at_ms: Option<i64>,
    timer_phase: Option<String>,
    auto_break_after_focus: Option<bool>,
    break_seconds_after_focus: Option<i64>,
    auto_focus_after_break: Option<bool>,
    focus_seconds_after_break: Option<i64>,
) -> Result<(), String> {
    let _ = (badge, tooltip);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_title(&window_title);
    }
    #[cfg(target_os = "android")]
    {
        let active = timer_active.unwrap_or(false);
        let paused = timer_paused.unwrap_or(false);
        let clock = timer_clock.unwrap_or_else(|| title.clone());
        let focus_phase = timer_focus_phase.unwrap_or(true);
        let ends_at_ms = timer_ends_at_ms.unwrap_or(0);
        let timer_phase = timer_phase.unwrap_or_else(|| "focus".into());
        let auto_break = auto_break_after_focus.unwrap_or(false);
        let break_seconds = break_seconds_after_focus.unwrap_or(0);
        let auto_focus = auto_focus_after_break.unwrap_or(false);
        let focus_seconds = focus_seconds_after_break.unwrap_or(0);
        crate::commands::android_jni::update_timer_notification(
            &app,
            &clock,
            focus_phase,
            active,
            paused,
            ends_at_ms,
            &timer_phase,
            auto_break,
            break_seconds,
            auto_focus,
            focus_seconds,
        )?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (
            title,
            timer_active,
            timer_paused,
            timer_clock,
            timer_focus_phase,
            timer_ends_at_ms,
            timer_phase,
            auto_break_after_focus,
            break_seconds_after_focus,
            auto_focus_after_break,
            focus_seconds_after_break,
        );
    }
    Ok(())
}
