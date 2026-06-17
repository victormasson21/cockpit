//! settings.rs — config data types and their defaults; the source of truth for what gets persisted.
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;

// A single tile instance as stored in cockpit.json (id + type + opaque per-tile config).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TileInstance {
    pub id: String,
    #[serde(rename = "type")]
    pub tile_type: String,
    pub config: serde_json::Value,
}

// User-facing display preferences (theme + which view opens on launch).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preferences {
    pub theme: String,
    #[serde(rename = "defaultView")]
    pub default_view: String,
}

// Portable, user-meaningful config (which tiles exist + preferences). Persisted to cockpit.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CockpitConfig {
    pub version: u32,
    pub tiles: Vec<TileInstance>,
    pub preferences: Preferences,
}

// High-churn dockview geometry per named view. Persisted to layout.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutConfig {
    pub version: u32,
    pub views: serde_json::Map<String, serde_json::Value>,
}

impl Default for CockpitConfig {
    fn default() -> Self {
        CockpitConfig {
            version: 1,
            tiles: vec![
                TileInstance { id: "clock-1".into(), tile_type: "clock".into(), config: serde_json::json!({}) },
                TileInstance { id: "notes-1".into(), tile_type: "notes".into(), config: serde_json::json!({ "text": "" }) },
            ],
            preferences: Preferences { theme: "system".into(), default_view: "main".into() },
        }
    }
}

impl Default for LayoutConfig {
    fn default() -> Self {
        LayoutConfig { version: 1, views: serde_json::Map::new() }
    }
}

// Crash-safe write: write to a temp file, fsync, then atomically rename over the target.
pub fn atomic_write(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

// Load user config; missing -> write+return defaults; malformed -> back up to .bak and return defaults (never silently overwrite the user's file).
pub fn load_cockpit(dir: &Path) -> CockpitConfig {
    let path = dir.join("cockpit.json");
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<CockpitConfig>(&text) {
            Ok(cfg) => cfg,
            Err(_) => {
                let _ = fs::rename(&path, dir.join("cockpit.json.bak"));
                let cfg = CockpitConfig::default();
                let _ = atomic_write(&path, &serde_json::to_string_pretty(&cfg).unwrap());
                cfg
            }
        },
        Err(_) => {
            let cfg = CockpitConfig::default();
            let _ = fs::create_dir_all(dir);
            let _ = atomic_write(&path, &serde_json::to_string_pretty(&cfg).unwrap());
            cfg
        }
    }
}

// Load disposable layout geometry; missing or corrupt -> defaults (no backup; it's regenerated at runtime).
pub fn load_layout(dir: &Path) -> LayoutConfig {
    let path = dir.join("layout.json");
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<LayoutConfig>(&text).unwrap_or_default(),
        Err(_) => LayoutConfig::default(),
    }
}

// Persist both config files atomically (creating the dir if needed).
pub fn save_all(dir: &Path, cockpit: &CockpitConfig, layout: &LayoutConfig) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    atomic_write(&dir.join("cockpit.json"), &serde_json::to_string_pretty(cockpit).unwrap())?;
    atomic_write(&dir.join("layout.json"), &serde_json::to_string_pretty(layout).unwrap())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cockpit_default_has_two_stub_tiles() {
        let c = CockpitConfig::default();
        assert_eq!(c.version, 1);
        assert_eq!(c.tiles.len(), 2);
        assert_eq!(c.tiles[0].tile_type, "clock");
        assert_eq!(c.tiles[1].config, serde_json::json!({ "text": "" }));
        assert_eq!(c.preferences.theme, "system");
        assert_eq!(c.preferences.default_view, "main");
    }

    #[test]
    fn atomic_write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cockpit.json");
        let cfg = CockpitConfig::default();
        let json = serde_json::to_string_pretty(&cfg).unwrap();
        atomic_write(&path, &json).unwrap();
        let read = std::fs::read_to_string(&path).unwrap();
        let parsed: CockpitConfig = serde_json::from_str(&read).unwrap();
        assert_eq!(parsed, cfg);
    }

    #[test]
    fn load_cockpit_missing_returns_default_and_writes_it() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load_cockpit(dir.path());
        assert_eq!(cfg, CockpitConfig::default());
        assert!(dir.path().join("cockpit.json").exists());
    }

    #[test]
    fn load_cockpit_malformed_backs_up_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cockpit.json"), "{ not json").unwrap();
        let cfg = load_cockpit(dir.path());
        assert_eq!(cfg, CockpitConfig::default());
        assert!(dir.path().join("cockpit.json.bak").exists());
    }
}
