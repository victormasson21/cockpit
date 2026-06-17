//! commands.rs — Tauri IPC commands bridging the frontend to the settings persistence layer.
use crate::settings::{load_cockpit, load_layout, save_all, CockpitConfig, LayoutConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// The full settings payload exchanged with the frontend (both config files together).
#[derive(Serialize, Deserialize)]
pub struct Settings {
    pub cockpit: CockpitConfig,
    pub layout: LayoutConfig,
}

// Resolve the per-app OS config directory (e.g. ~/Library/Application Support/com.cockpit.app).
fn config_dir(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    app.path().app_config_dir().expect("no app config dir")
}

// Load both config files at startup.
#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Settings {
    let dir = config_dir(&app);
    Settings { cockpit: load_cockpit(&dir), layout: load_layout(&dir) }
}

// Persist both config files (called debounced from the frontend).
#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let dir = config_dir(&app);
    save_all(&dir, &settings.cockpit, &settings.layout).map_err(|e| e.to_string())
}
