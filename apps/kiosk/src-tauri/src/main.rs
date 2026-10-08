//! MedSim Lab station kiosk shell (PRD §12, R-09).
//!
//! Opens the lab server's /station page full screen, undecorated and always on top,
//! refuses to close unless the proctor PIN is entered through the web app's
//! "Exit kiosk mode" dialog (which calls the `exit_kiosk` command).
//!
//! Runtime configuration (environment variables):
//!   MEDSIM_STATION_URL   station page URL (default: the URL in tauri.conf.json)
//!   MEDSIM_STATION_ID    station id appended as ?station=<id>
//!   MEDSIM_PROCTOR_PIN   proctor exit PIN (default 2468; keep in sync with VITE_PROCTOR_PIN)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, WindowEvent};

static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);

fn proctor_pin() -> String {
    std::env::var("MEDSIM_PROCTOR_PIN").unwrap_or_else(|_| "2468".to_string())
}

/// Constant-time-ish comparison so the PIN cannot be probed by timing.
fn pin_matches(input: &str, expected: &str) -> bool {
    let (a, b) = (input.as_bytes(), expected.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0 && !expected.is_empty()
}

#[tauri::command]
fn exit_kiosk(app: tauri::AppHandle, pin: String) -> bool {
    if !pin_matches(&pin, &proctor_pin()) {
        return false;
    }
    EXIT_ALLOWED.store(true, Ordering::SeqCst);
    app.exit(0);
    true
}

fn station_url() -> Option<tauri::Url> {
    let base = std::env::var("MEDSIM_STATION_URL").ok()?;
    let mut url = tauri::Url::parse(&base).ok()?;
    if let Ok(id) = std::env::var("MEDSIM_STATION_ID") {
        url.query_pairs_mut().append_pair("station", &id);
    }
    Some(url)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![exit_kiosk])
        .setup(|app| {
            if let Some(win) = app.get_webview_window("station") {
                if let Some(url) = station_url() {
                    let _ = win.navigate(url);
                }
                let _ = win.set_fullscreen(true);
                let _ = win.set_always_on_top(true);
                let _ = win.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Alt+F4 / window manager close: refused unless the proctor PIN was entered.
            WindowEvent::CloseRequested { api, .. } if !EXIT_ALLOWED.load(Ordering::SeqCst) => {
                api.prevent_close();
            }
            // Keep the station in front if focus is stolen.
            WindowEvent::Focused(false) if !EXIT_ALLOWED.load(Ordering::SeqCst) => {
                let _ = window.set_focus();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running MedSim Lab kiosk");
}
