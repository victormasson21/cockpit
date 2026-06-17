//! settings.rs — config data types and their defaults; the source of truth for what gets persisted.
use serde::{Deserialize, Serialize};

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
}
