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

// Local dev server for a worktree: command to start it + the address it serves on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HostConfig {
    #[serde(rename = "startCmd")]
    pub start_cmd: String,
    pub address: String,
}

// A repo the deduce agent may target, plus optional user-saved host default (start cmd + address) for fields git/the agent can't reliably supply.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KnownRepo {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<HostConfig>,
}

// Accept both a bare string (legacy / hand-edited config) and the full object form so old cockpit.json files still load.
impl<'de> Deserialize<'de> for KnownRepo {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Path(String),
            Full {
                path: String,
                #[serde(default)]
                host: Option<HostConfig>,
            },
        }
        Ok(match Repr::deserialize(d)? {
            Repr::Path(path) => KnownRepo { path, host: None },
            Repr::Full { path, host } => KnownRepo { path, host },
        })
    }
}

// A user-editable useful link attached to a worktree (ticket / design / preview).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorktreeLink {
    pub label: String,
    pub url: String,
}

// A worktree: a name + git location (repo/branch/worktree) + local host + links + status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Worktree {
    pub id: String,
    pub name: String,
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    pub branch: String,
    #[serde(rename = "worktreePath")]
    pub worktree_path: String,
    pub host: HostConfig,
    pub links: Vec<WorktreeLink>,
    pub status: String,
    // The deduce prompt that created this worktree (auto-sent to Claude once; kept copyable). Absent for manual/checkout worktrees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

// Per-integration persisted config (non-secret only). Slack secrets live in Keychain, never here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SlackIntegration {
    #[serde(rename = "clientId", default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(rename = "watchedChannelIds", default)]
    pub watched_channel_ids: Vec<String>,
}

// One captured PR review request (resolved at fetch time; render-ready). id = the Slack message ts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrReviewItem {
    pub id: String,
    pub url: String,
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub ts: String,
    // Ship/Show/Ask marker parsed from the message text ("SHIP" | "SHOW" | "ASK").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

// PR Reviews tile config + state: watched channel, fetch cursor, and the user-curated item list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrReviewsIntegration {
    #[serde(rename = "channelId", default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(rename = "lastSeenTs", default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ts: Option<String>,
    #[serde(default)]
    pub items: Vec<PrReviewItem>,
}

// Container so future tiles add sibling fields without touching CockpitConfig's shape twice.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Integrations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slack: Option<SlackIntegration>,
    #[serde(rename = "prReviews", default, skip_serializing_if = "Option::is_none")]
    pub pr_reviews: Option<PrReviewsIntegration>,
}

// One to-do item: stable id + text + lifecycle state ("todo" | "in_progress" | "done"; TS narrows the domain).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub state: String,
}

// User-facing display preferences (theme + which view opens on launch + visible Worktrees/Calm panes).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preferences {
    pub theme: String,
    #[serde(rename = "defaultView")]
    pub default_view: String,
    // Visible column count for the Worktrees/Calm views (2 or 3); defaults for older files without it.
    #[serde(default = "default_panes")]
    pub panes: u32,
    // Text zoom multiplier (Cmd +/-/0); 1.0 = 100%. Defaults for older files without it.
    #[serde(default = "default_font_scale", rename = "fontScale")]
    pub font_scale: f32,
}

fn default_panes() -> u32 {
    3
}

fn default_font_scale() -> f32 {
    1.0
}

// Portable, user-meaningful config (which tiles exist + preferences). Persisted to cockpit.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CockpitConfig {
    pub version: u32,
    pub tiles: Vec<TileInstance>,
    #[serde(default)]
    pub worktrees: Vec<Worktree>,
    #[serde(default, rename = "knownRepos")]
    pub known_repos: Vec<KnownRepo>,
    #[serde(default)]
    pub integrations: Integrations,
    #[serde(default)]
    pub todos: Vec<TodoItem>,
    #[serde(default, rename = "worktreeContexts", skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub worktree_contexts: std::collections::HashMap<String, String>,
    // The Cockpit view's single right-column worktree slot (persisted; the Worktrees-view slots are session-only).
    #[serde(rename = "cockpitWorktreeId", default, skip_serializing_if = "Option::is_none")]
    pub cockpit_worktree_id: Option<String>,
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
                TileInstance { id: "worktree-1".into(), tile_type: "worktree".into(), config: serde_json::json!({}) },
            ],
            worktrees: vec![],
            known_repos: vec![],
            integrations: Integrations::default(),
            todos: vec![],
            worktree_contexts: std::collections::HashMap::new(),
            cockpit_worktree_id: None,
            preferences: Preferences { theme: "system".into(), default_view: "main".into(), panes: 3, font_scale: 1.0 },
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
// (to_string_pretty below in save paths can't fail for these String/u32/Value structs, hence the unwraps.)
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
    fn cockpit_default_includes_worktree_tile() {
        let c = CockpitConfig::default();
        assert_eq!(c.tiles.len(), 3);
        assert_eq!(c.tiles[2].tile_type, "worktree");
        assert!(c.worktrees.is_empty());
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

    // layout.json is disposable: corruption silently falls back to defaults (no backup).
    #[test]
    fn load_layout_corrupt_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("layout.json"), "{ not json").unwrap();
        assert_eq!(load_layout(dir.path()), LayoutConfig::default());
    }

    // Old files without a `worktrees` field must still deserialise cleanly (backward-compat).
    #[test]
    fn cockpit_without_worktrees_field_still_loads() {
        let json = r#"{"version":1,"tiles":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.worktrees.is_empty());
    }

    #[test]
    fn cockpit_without_known_repos_field_still_loads() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.known_repos.is_empty());
    }

    #[test]
    fn known_repos_accepts_string_or_object_entries() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"knownRepos":["/a",{"path":"/b","host":{"startCmd":"pnpm start","address":"http://localhost:2000"}}],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.known_repos.len(), 2);
        assert_eq!(cfg.known_repos[0].path, "/a");
        assert_eq!(cfg.known_repos[0].host, None);
        assert_eq!(cfg.known_repos[1].path, "/b");
        assert_eq!(cfg.known_repos[1].host.as_ref().unwrap().address, "http://localhost:2000");
    }

    #[test]
    fn known_repo_with_host_round_trips() {
        let repo = KnownRepo {
            path: "/r".into(),
            host: Some(HostConfig { start_cmd: "pnpm start".into(), address: "http://localhost:2000".into() }),
        };
        let json = serde_json::to_string(&repo).unwrap();
        let back: KnownRepo = serde_json::from_str(&json).unwrap();
        assert_eq!(back, repo);
        // host is omitted entirely when None (skip_serializing_if)
        let bare = KnownRepo { path: "/b".into(), host: None };
        assert!(!serde_json::to_string(&bare).unwrap().contains("host"));
    }

    // Pre-lazy-panes files persisted a paneOpen arrangement; the field is gone and must be
    // silently ignored on load (serde default: unknown fields are skipped), never re-written.
    #[test]
    fn worktree_ignores_legacy_pane_open() {
        let legacy = r#"{"id":"w1","name":"n","repoPath":"/r","branch":"b","worktreePath":"/w","host":{"startCmd":"","address":""},"links":[],"status":"ongoing","paneOpen":{"host":false,"git":false,"claude":true}}"#;
        let wt: Worktree = serde_json::from_str(legacy).unwrap();
        assert_eq!(wt.id, "w1");
        assert!(!serde_json::to_string(&wt).unwrap().contains("paneOpen"));
    }

    #[test]
    fn cockpit_without_integrations_field_still_loads() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.integrations.slack.is_none());
    }

    #[test]
    fn slack_integration_round_trips() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"integrations":{"slack":{"clientId":"123.456","watchedChannelIds":["C1","D2"]}},"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        let slack = cfg.integrations.slack.unwrap();
        assert_eq!(slack.client_id.as_deref(), Some("123.456"));
        assert_eq!(slack.watched_channel_ids, vec!["C1", "D2"]);
    }

    #[test]
    fn cockpit_without_pr_reviews_field_still_loads() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"integrations":{"slack":{"watchedChannelIds":[]}},"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.integrations.pr_reviews.is_none());
    }

    #[test]
    fn pr_reviews_integration_round_trips() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"integrations":{"prReviews":{"channelId":"C9","lastSeenTs":"1751.000100","items":[{"id":"1751.000200","url":"https://github.com/acme/web-app/pull/4821","repo":"web-app","number":4821,"title":"Add idempotency key to checkout","author":"Priya Shah","ts":"1751.000200","mode":"SHIP"}]}},"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        let pr = cfg.integrations.pr_reviews.clone().unwrap();
        assert_eq!(pr.channel_id.as_deref(), Some("C9"));
        assert_eq!(pr.last_seen_ts.as_deref(), Some("1751.000100"));
        assert_eq!(pr.items.len(), 1);
        assert_eq!(pr.items[0].number, 4821);
        assert_eq!(pr.items[0].mode.as_deref(), Some("SHIP"));
        // full round-trip preserves the shape; mode omitted when None
        let back = serde_json::to_string(&cfg).unwrap();
        let again: CockpitConfig = serde_json::from_str(&back).unwrap();
        assert_eq!(again.integrations.pr_reviews, cfg.integrations.pr_reviews);
        let no_mode = PrReviewItem { mode: None, ..pr.items[0].clone() };
        assert!(!serde_json::to_string(&no_mode).unwrap().contains("mode"));
    }

    #[test]
    fn cockpit_without_todos_field_still_loads() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.todos.is_empty());
    }

    #[test]
    fn todos_round_trip() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"todos":[{"id":"t1","text":"ship it","state":"in_progress"}],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.todos.len(), 1);
        assert_eq!(cfg.todos[0].id, "t1");
        assert_eq!(cfg.todos[0].text, "ship it");
        assert_eq!(cfg.todos[0].state, "in_progress");
    }

    #[test]
    fn cockpit_without_cockpit_worktree_id_still_loads() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.cockpit_worktree_id, None);
    }

    #[test]
    fn cockpit_worktree_id_round_trips() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"cockpitWorktreeId":"wt-3","preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.cockpit_worktree_id.as_deref(), Some("wt-3"));
    }

    // Back-compat: pre-prompt cockpit.json worktrees load; None is omitted; Some round-trips.
    #[test]
    fn worktree_prompt_optional_and_omitted_when_none() {
        let json = r#"{"id":"wt-1","name":"n","repoPath":"/r","branch":"b","worktreePath":"/w","host":{"startCmd":"","address":""},"links":[],"status":"ongoing"}"#;
        let wt: Worktree = serde_json::from_str(json).unwrap();
        assert_eq!(wt.prompt, None);
        assert!(!serde_json::to_string(&wt).unwrap().contains("prompt"));
        let with = Worktree { prompt: Some("fix the login bug".into()), ..wt };
        let back: Worktree = serde_json::from_str(&serde_json::to_string(&with).unwrap()).unwrap();
        assert_eq!(back.prompt.as_deref(), Some("fix the login bug"));
    }
}
