pub mod categories;
pub mod directory;
pub mod checkins;
pub mod holidays;
pub mod pomodoro;
pub mod settings;
pub mod sync;
pub mod tasks;

#[cfg(desktop)]
#[path = "tray.rs"]
pub mod tray;

#[cfg(mobile)]
#[path = "tray_mobile.rs"]
pub mod tray;
