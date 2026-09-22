mod commands;
mod db;
mod system_config;

use commands::tray::install_pomodoro_tray;
use db::{get_db_path, init_db, DbState};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let (conn, db_path) = init_db(app.handle())?;
            app.manage(DbState {
                conn: Mutex::new(conn),
                db_path: Mutex::new(db_path),
            });
            install_pomodoro_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tasks::list_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::reorder_task,
            commands::tasks::delete_task,
            commands::tasks::get_task,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::delete_category,
            commands::checkins::list_habit_checkins,
            commands::checkins::list_habit_checkin_items,
            commands::checkins::save_habit_checkin,
            commands::checkins::toggle_habit_checkin,
            commands::pomodoro::record_pomodoro_session,
            commands::pomodoro::count_today_focus_sessions,
            commands::pomodoro::count_focus_sessions_since,
            commands::pomodoro::count_focus_sessions_total_since,
            commands::pomodoro::list_focus_counts_since,
            commands::pomodoro::list_first_completed_focus_starts,
            commands::pomodoro::list_pomodoro_sessions_in_range,
            commands::settings::get_pomodoro_settings,
            commands::settings::set_pomodoro_settings,
            commands::settings::read_sound_file,
            commands::sync::get_system_settings,
            commands::sync::set_system_settings,
            commands::sync::get_default_data_dir,
            commands::sync::get_active_data_dir,
            commands::sync::set_data_directory,
            commands::sync::run_data_sync,
            commands::holidays::read_cn_holidays_cache,
            commands::holidays::write_cn_holidays_cache,
            commands::tray::set_pomodoro_tray,
            get_db_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
