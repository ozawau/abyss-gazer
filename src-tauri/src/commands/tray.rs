use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    App, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Rect,
    WebviewUrl, WebviewWindow, WindowEvent,
};

pub const TRAY_ID: &str = "pomodoro-timer";
pub const TRAY_CALENDAR_LABEL: &str = "tray-calendar";

const POPOVER_WIDTH: f64 = 312.0;
const POPOVER_HEIGHT: f64 = 468.0;
/// Ignore the blur that showing the popover itself can cause.
const SHOW_BLUR_GUARD_MS: u64 = 350;
/// A click that already dismissed the popover must not open it again.
const RECENT_CLOSE_MS: u64 = 180;

static BLUR_IGNORED_UNTIL: AtomicU64 = AtomicU64::new(0);
static CLOSED_AT: AtomicU64 = AtomicU64::new(0);
static FOCUS_TASK_TITLE: Mutex<String> = Mutex::new(String::new());

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn mark_closed() {
    CLOSED_AT.store(now_ms(), Ordering::Relaxed);
}

fn closed_recently() -> bool {
    now_ms().saturating_sub(CLOSED_AT.load(Ordering::Relaxed)) < RECENT_CLOSE_MS
}

fn guard_show_blur() {
    BLUR_IGNORED_UNTIL.store(now_ms() + SHOW_BLUR_GUARD_MS, Ordering::Relaxed);
}

fn show_blur_guarded() -> bool {
    now_ms() < BLUR_IGNORED_UNTIL.load(Ordering::Relaxed)
}

fn hide_calendar(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(TRAY_CALENDAR_LABEL) {
        let _ = window.hide();
    }
}

fn position_calendar(window: &WebviewWindow, icon: &Rect) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let _ = window.set_size(LogicalSize::new(POPOVER_WIDTH, POPOVER_HEIGHT));
    let outer = window.outer_size().unwrap_or(PhysicalSize::new(
        (POPOVER_WIDTH * scale) as u32,
        (POPOVER_HEIGHT * scale) as u32,
    ));
    let pop_w = outer.width as f64;
    let pop_h = outer.height as f64;
    let origin = icon.position.to_physical::<f64>(scale);
    let icon_size = icon.size.to_physical::<f64>(scale);
    let icon_x = origin.x;
    let icon_y = origin.y;
    let icon_w = icon_size.width.max(1.0);
    let icon_h = icon_size.height.max(1.0);

    let gap = 6.0 * scale;
    let mut x = icon_x + icon_w / 2.0 - pop_w / 2.0;
    let below = icon_y + icon_h + gap;
    let above = icon_y - gap - pop_h;

    let monitors = window.available_monitors().unwrap_or_default();
    let anchor_x = icon_x + icon_w / 2.0;
    let anchor_y = icon_y + icon_h / 2.0;
    let monitor = monitors.iter().find(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        anchor_x >= pos.x as f64
            && anchor_y >= pos.y as f64
            && anchor_x < pos.x as f64 + size.width as f64
            && anchor_y < pos.y as f64 + size.height as f64
    });

    let (work_x, work_y, work_r, work_b) = if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let left = area.position.x as f64;
        let top = area.position.y as f64;
        (
            left,
            top,
            left + area.size.width as f64,
            top + area.size.height as f64,
        )
    } else {
        (
            f64::MIN / 4.0,
            f64::MIN / 4.0,
            f64::MAX / 4.0,
            f64::MAX / 4.0,
        )
    };

    let mut y = if below + pop_h <= work_b {
        below
    } else if above >= work_y {
        above
    } else {
        below
    };
    x = x.clamp(work_x, (work_r - pop_w).max(work_x));
    y = y.clamp(work_y, (work_b - pop_h).max(work_y));
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn show_calendar(app: &AppHandle, icon: &Rect) {
    let Some(window) = ensure_calendar_window(app) else {
        return;
    };
    position_calendar(&window, icon);
    guard_show_blur();
    #[cfg(target_os = "macos")]
    install_outside_click_monitor(app);
    let _ = window.show();
    let _ = window.emit("tray-calendar-shown", ());
    present_calendar(&window);
}

fn toggle_calendar(app: &AppHandle, icon: Rect) {
    prevent_app_window_order();
    let Some(window) = ensure_calendar_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        mark_closed();
        return;
    }
    if closed_recently() {
        return;
    }
    show_calendar(app, &icon);
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
                button_state: MouseButtonState::Down,
                rect,
                ..
            } = event
            {
                toggle_calendar(tray.app_handle(), rect);
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

fn ensure_calendar_window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(TRAY_CALENDAR_LABEL) {
        return Some(window);
    }
    create_calendar_window(app).ok()
}

fn create_calendar_window(app: &AppHandle) -> Result<WebviewWindow, Box<dyn std::error::Error>> {
    let window =
        tauri::webview::WebviewWindowBuilder::new(app, TRAY_CALENDAR_LABEL, WebviewUrl::default())
            .title("日历")
            .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .accept_first_mouse(true)
            .build()?;

    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            if show_blur_guarded() {
                return;
            }
            hide_calendar(&handle);
            mark_closed();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide_calendar(&handle);
            mark_closed();
        }
        _ => {}
    });
    #[cfg(target_os = "macos")]
    configure_calendar_panel(&window);
    Ok(window)
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
    timer_active: Option<bool>,
    timer_paused: Option<bool>,
    timer_clock: Option<String>,
    timer_focus_phase: Option<bool>,
    focus_task_title: Option<String>,
) -> Result<(), String> {
    let _ = (timer_paused, timer_clock, timer_focus_phase);
    let active = timer_active.unwrap_or(false);
    store_focus_task(
        &app,
        if active {
            focus_task_title.filter(|title| !title.trim().is_empty())
        } else {
            None
        },
    );
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

fn store_focus_task(app: &AppHandle, title: Option<String>) {
    let next = title.unwrap_or_default();
    let mut current = FOCUS_TASK_TITLE
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if *current == next {
        return;
    }
    *current = next.clone();
    drop(current);
    let _ = app.emit("tray-focus-task", next);
}

#[tauri::command]
pub fn tray_focus_task() -> String {
    FOCUS_TASK_TITLE
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone()
}

#[tauri::command]
pub fn open_main_from_tray(app: AppHandle) -> Result<(), String> {
    hide_calendar(&app);
    mark_closed();
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    #[cfg(target_os = "macos")]
    activate_app();
    Ok(())
}

fn prevent_app_window_order() {
    #[cfg(target_os = "macos")]
    {
        let Some(mtm) = objc2::MainThreadMarker::new() else {
            return;
        };
        let app = objc2_app_kit::NSApplication::sharedApplication(mtm);
        app.preventWindowOrdering();
    }
}

#[cfg(target_os = "macos")]
fn activate_app() {
    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return;
    };
    let app = objc2_app_kit::NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
}

fn present_calendar(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        order_calendar_panel(window);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn install_outside_click_monitor(app: &AppHandle) {
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    if INSTALLED.swap(true, Ordering::Relaxed) {
        return;
    }

    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};

    let mask =
        NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown;
    let global_app = app.clone();
    let global_block = RcBlock::new(move |_event: NonNull<NSEvent>| {
        dismiss_calendar_if_click_outside(&global_app);
    });
    let local_app = app.clone();
    let local_block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        dismiss_calendar_if_click_outside(&local_app);
        event.as_ptr()
    });
    let global = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &*global_block);
    // The returned event stays in the queue so the click still reaches its window.
    let local =
        unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &*local_block) };
    // Monitors copy these blocks and run them for the rest of the process.
    // Dropping them from inside a click handler would free the running block.
    std::mem::forget(global_block);
    std::mem::forget(local_block);
    std::mem::forget(global);
    std::mem::forget(local);
}

#[cfg(target_os = "macos")]
fn dismiss_calendar_if_click_outside(app: &AppHandle) {
    let Some(window) = app.get_webview_window(TRAY_CALENDAR_LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) || show_blur_guarded() {
        return;
    }
    if click_inside_calendar(&window) {
        return;
    }
    hide_calendar(app);
    mark_closed();
}

#[cfg(target_os = "macos")]
fn click_inside_calendar(window: &WebviewWindow) -> bool {
    let point = objc2_app_kit::NSEvent::mouseLocation();
    let mut inside = false;
    with_ns_window(window, |ns_window| {
        let frame = ns_window.frame();
        inside = point.x >= frame.origin.x
            && point.y >= frame.origin.y
            && point.x < frame.origin.x + frame.size.width
            && point.y < frame.origin.y + frame.size.height;
    });
    inside
}

#[cfg(target_os = "macos")]
fn configure_calendar_panel(window: &WebviewWindow) {
    with_ns_window(window, |ns_window| {
        let mask = ns_window.styleMask();
        ns_window.setStyleMask(mask | objc2_app_kit::NSWindowStyleMask::NonactivatingPanel);
        ns_window.setLevel(objc2_app_kit::NSPopUpMenuWindowLevel);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setExcludedFromWindowsMenu(true);
        ns_window.setCollectionBehavior(
            objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
        );
    });
}

#[cfg(target_os = "macos")]
fn order_calendar_panel(window: &WebviewWindow) {
    with_ns_window(window, |ns_window| {
        ns_window.setLevel(objc2_app_kit::NSPopUpMenuWindowLevel);
        ns_window.orderFrontRegardless();
        ns_window.makeKeyWindow();
    });
}

#[cfg(target_os = "macos")]
fn with_ns_window(window: &WebviewWindow, f: impl FnOnce(&objc2_app_kit::NSWindow)) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    let ns_window = unsafe { &*(ptr as *const objc2_app_kit::NSWindow) };
    f(ns_window);
}
