mod commands;
mod db;

use db::{init_db, DbState};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = init_db(app.handle())?;
            app.manage(DbState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tasks::list_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::get_task,
            commands::pomodoro::record_pomodoro_session,
            commands::pomodoro::count_today_focus_sessions,
            commands::pomodoro::count_focus_sessions_since,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
