# Slack tile + auth manager — Implementation Plan (sub-project 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first provider+panel integration — a Slack unread-messages tile in the Cockpit view — backed by macOS Keychain token storage, browser OAuth, and a background polling Slack provider.

**Architecture:** A Rust provider (`slack.rs`) owns OAuth + a Keychain-stored user token + a background polling thread that emits a `slack://unread` event stream; a React panel (`SlackTile`) renders it. A generic `keychain.rs` token store and an `auth.rs` connections registry are the reusable seam later tiles copy. Mirrors the existing PTY provider (threads + `app.emit`, not async).

**Tech Stack:** Rust (Tauri v2, `ureq` blocking HTTP, `tiny_http` loopback OAuth callback, `keyring` v3 macOS-native, `urlencoding`), React 19 + TypeScript, Vitest (pure-function tests), `cargo test`.

## Global Constraints

- **Lean & native first** — prefer the smallest dependency that works; blocking HTTP via threads to match `pty.rs` (no new async runtime). Copy these dep choices verbatim: `ureq = { version = "2", features = ["json"] }`, `tiny_http = "0.12"`, `keyring = { version = "3", features = ["apple-native"] }`, `urlencoding = "2"`.
- **Secrets never touch JSON** — the `xoxp` user token and the Slack app `client_secret` live in macOS Keychain only. `cockpit.json` stores only `clientId` and `watchedChannelIds`.
- **Back-compat** — every new serde field on `CockpitConfig` is `#[serde(default)]`; existing `cockpit.json` files must still load (there are existing tests asserting this — keep them green).
- **File-top + block comments** — every new file starts with a one-line role comment; each significant function/wiring point gets a concise intent comment (project convention in `CLAUDE.md`).
- **Frontend tests are pure-function only** — the Vitest env is `node` with no DOM/component-render setup. Test pure logic (time formatting, sorting, selection); verify component rendering via GUI acceptance.
- **Provider shape = PTY pattern** — Tauri-managed `Mutex` state struct; `#[tauri::command]` functions; output via `app.emit("slack://unread", payload)`; background work on a `std::thread`.
- **Keychain service constant:** `SLACK_KEYCHAIN_SERVICE = "com.cockpit.app.slack"`; accounts: `"user_token"`, `"client_secret"`.
- **Event name:** `slack://unread`. **Connect event:** `slack://connected`.
- **OAuth scopes (user token):** `channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,users:read`.

**Test commands:**
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml <name>`
- JS (one file): `npx vitest run <path>` · all: `npm test`
- Builds: `cargo build --manifest-path src-tauri/Cargo.toml` · `npm run build`

---

## File Structure

**Rust (`src-tauri/src/`)**
- Create `keychain.rs` — generic Keychain token store: `TokenStore` trait + `KeyringStore` (real) + `MemoryStore` (test).
- Create `slack.rs` — Slack provider: pure parse/URL fns, `SlackManager` state, OAuth loopback, poll thread, commands.
- Create `auth.rs` — connections registry: `list_connections` command.
- Modify `settings.rs` — add `Integrations`/`SlackIntegration` to `CockpitConfig`.
- Modify `lib.rs` — register module, manager state, commands.
- Modify `Cargo.toml` — add deps.

**Frontend (`src/`)**
- Create `src/tiles/slack/types.ts` — TS shapes mirroring Rust.
- Create `src/tiles/slack/api.ts` — typed invoke wrappers.
- Create `src/tiles/slack/time.ts` (+ `time.test.ts`) — relative-time formatter.
- Create `src/tiles/slack/rows.ts` (+ `rows.test.ts`) — snapshot sorting/selection helpers.
- Create `src/tiles/slack/SlackTile.tsx` — the panel.
- Create `src/tiles/slack/SlackConnections.tsx` — Settings "Connections" section body.
- Create `src/views/CockpitView.css` additions / `src/tiles/slack/slack.css` — tile styling.
- Modify `src/views/CockpitView.tsx` — left `TileColumn` rendering `SlackTile`.
- Modify `src/views/SettingsModal.tsx` — render `SlackConnections`.
- Modify `src/settings/types.ts` — add `Integrations`/`SlackIntegration` to `CockpitConfig`.
- Modify `src/settings/store.ts` — `setSlackClientId`, `setSlackWatched` setters.

---

## Task 1: Keychain token store (`keychain.rs`)

**Files:**
- Create: `src-tauri/src/keychain.rs`
- Modify: `src-tauri/Cargo.toml` (add `keyring`)
- Modify: `src-tauri/src/lib.rs:1-6` (add `mod keychain;`)
- Test: inline `#[cfg(test)]` in `keychain.rs`

**Interfaces:**
- Produces:
  - `trait TokenStore { fn set(&self, account: &str, secret: &str) -> Result<(), String>; fn get(&self, account: &str) -> Result<Option<String>, String>; fn delete(&self, account: &str) -> Result<(), String>; }`
  - `struct KeyringStore { service: String }` impl `TokenStore` (real macOS Keychain).
  - `struct MemoryStore { map: Mutex<HashMap<String,String>> }` impl `TokenStore` (tests + any non-macOS fallback).

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml` under `[dependencies]` add:
```toml
keyring = { version = "3", features = ["apple-native"] }
```

- [ ] **Step 2: Write the file with the trait + both impls + failing test**

Create `src-tauri/src/keychain.rs`:
```rust
//! keychain.rs — generic secure token store; provider-agnostic so every integration reuses it.
use std::collections::HashMap;
use std::sync::Mutex;

// One secret store scoped to a service name; accounts are arbitrary keys (e.g. "user_token").
pub trait TokenStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

// Real macOS Keychain backing via the `keyring` crate.
pub struct KeyringStore {
    pub service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }
    fn entry(&self, account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, account).map_err(|e| e.to_string())
    }
}

impl TokenStore for KeyringStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.entry(account)?.set_password(secret).map_err(|e| e.to_string())
    }
    // Missing entry is a normal "not set yet" state, not an error.
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match self.entry(account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// In-memory store for unit tests (and a safe fallback off macOS).
#[derive(Default)]
pub struct MemoryStore {
    map: Mutex<HashMap<String, String>>,
}

impl TokenStore for MemoryStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.map.lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.map.lock().unwrap().get(account).cloned())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.map.lock().unwrap().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_set_get_delete_round_trip() {
        let s = MemoryStore::default();
        assert_eq!(s.get("user_token").unwrap(), None);
        s.set("user_token", "xoxp-abc").unwrap();
        assert_eq!(s.get("user_token").unwrap(), Some("xoxp-abc".into()));
        s.delete("user_token").unwrap();
        assert_eq!(s.get("user_token").unwrap(), None);
    }

    #[test]
    fn delete_missing_is_ok() {
        let s = MemoryStore::default();
        assert!(s.delete("nope").is_ok());
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add `mod keychain;` to the module list (alphabetical, after `mod github;`).

- [ ] **Step 4: Run the tests — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml keychain`
Expected: 2 passed. (If `keyring` fails to compile, confirm the `apple-native` feature is present.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/keychain.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(slack): generic Keychain token store"
```

---

## Task 2: Config — Slack integration fields

**Files:**
- Modify: `src-tauri/src/settings.rs` (add structs to `CockpitConfig`)
- Modify: `src/settings/types.ts`
- Test: inline `#[cfg(test)]` in `settings.rs`

**Interfaces:**
- Produces (Rust): `struct SlackIntegration { client_id: Option<String>, watched_channel_ids: Vec<String> }`, `struct Integrations { slack: Option<SlackIntegration> }`, field `CockpitConfig.integrations: Integrations`.
- Produces (TS): `interface SlackIntegration { clientId?: string; watchedChannelIds: string[] }`, `interface Integrations { slack?: SlackIntegration }`, field `CockpitConfig.integrations?: Integrations`.

- [ ] **Step 1: Write the failing back-compat test**

In `src-tauri/src/settings.rs` `#[cfg(test)] mod tests`, add:
```rust
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
```

- [ ] **Step 2: Run — expect FAIL (no `integrations` field)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: compile error / FAIL — `CockpitConfig` has no field `integrations`.

- [ ] **Step 3: Add the structs and field**

In `src-tauri/src/settings.rs`, before `CockpitConfig`:
```rust
// Per-integration persisted config (non-secret only). Slack secrets live in Keychain, never here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SlackIntegration {
    #[serde(rename = "clientId", default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(rename = "watchedChannelIds", default)]
    pub watched_channel_ids: Vec<String>,
}

// Container so future tiles add sibling fields without touching CockpitConfig's shape twice.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Integrations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slack: Option<SlackIntegration>,
}
```
Then add to `CockpitConfig` (after `known_repos`):
```rust
    #[serde(default)]
    pub integrations: Integrations,
```
And in `impl Default for CockpitConfig`, add `integrations: Integrations::default(),`.

- [ ] **Step 4: Mirror in TypeScript**

In `src/settings/types.ts`, add before `CockpitConfig`:
```ts
export interface SlackIntegration { clientId?: string; watchedChannelIds: string[] }
export interface Integrations { slack?: SlackIntegration }
```
Add to `CockpitConfig`: `integrations?: Integrations;`
Update the store default in `src/settings/store.ts` line 43 `cockpit:` literal to include `integrations: {}`.

- [ ] **Step 5: Run — expect PASS, and build TS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: all settings tests pass (including the existing back-compat ones).
Run: `npm run build`
Expected: type-checks clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/settings.rs src/settings/types.ts src/settings/store.ts
git commit -m "feat(slack): persist clientId + watched channels in cockpit.json"
```

---

## Task 3: Slack pure functions (URL build + callback parse + snapshot parse)

**Files:**
- Create: `src-tauri/src/slack.rs` (pure fns + types only this task)
- Modify: `src-tauri/Cargo.toml` (add `ureq`, `tiny_http`, `urlencoding`)
- Modify: `src-tauri/src/lib.rs` (add `mod slack;`)
- Test: inline `#[cfg(test)]` in `slack.rs`

**Interfaces:**
- Produces:
  - `const SLACK_KEYCHAIN_SERVICE: &str`, `const SCOPES: &str`, `const SLACK_KEYCHAIN_SERVICE` accounts.
  - `struct UnreadConversation { id, kind, name, avatar_url: Option<String>, unread_count: u32, latest_text: String, latest_ts: String }` (serde camelCase).
  - `struct SlackSnapshot { connected: bool, error: Option<String>, conversations: Vec<UnreadConversation> }`.
  - `fn authorize_url(client_id: &str, redirect_uri: &str) -> String`
  - `fn parse_callback_code(query: &str) -> Result<String, String>`
  - `fn conversation_kind(slack_type: &str) -> &'static str`
  - `fn parse_conversation(info: &serde_json::Value, latest: &serde_json::Value) -> Option<UnreadConversation>`

- [ ] **Step 1: Add deps**

In `src-tauri/Cargo.toml` `[dependencies]`:
```toml
ureq = { version = "2", features = ["json"] }
tiny_http = "0.12"
urlencoding = "2"
```

- [ ] **Step 2: Write the file with types, pure fns, and failing tests**

Create `src-tauri/src/slack.rs`:
```rust
//! slack.rs — Slack provider: OAuth + Keychain user token + background unread polling, emitted as a slack://unread event stream.
use serde::{Deserialize, Serialize};

pub const SLACK_KEYCHAIN_SERVICE: &str = "com.cockpit.app.slack";
pub const ACCOUNT_TOKEN: &str = "user_token";
pub const ACCOUNT_SECRET: &str = "client_secret";
// User-token scopes needed to read unread state across channels, DMs and group DMs.
pub const SCOPES: &str = "channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,users:read";

// One unread row as rendered by the tile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnreadConversation {
    pub id: String,
    pub kind: String, // "channel" | "im" | "mpim"
    pub name: String,
    #[serde(rename = "avatarUrl", skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(rename = "unreadCount")]
    pub unread_count: u32,
    #[serde(rename = "latestText")]
    pub latest_text: String,
    #[serde(rename = "latestTs")]
    pub latest_ts: String,
}

// The full payload pushed on slack://unread (and returned by slack_snapshot).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SlackSnapshot {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub conversations: Vec<UnreadConversation>,
}

// Build the Slack OAuth authorize URL (user scopes go in `user_scope`).
pub fn authorize_url(client_id: &str, redirect_uri: &str) -> String {
    format!(
        "https://slack.com/oauth/v2/authorize?client_id={}&user_scope={}&redirect_uri={}",
        urlencoding::encode(client_id),
        urlencoding::encode(SCOPES),
        urlencoding::encode(redirect_uri),
    )
}

// Pull the `code` out of the loopback redirect's query string; surface an OAuth `error` if present.
pub fn parse_callback_code(query: &str) -> Result<String, String> {
    let q = query.trim_start_matches('?');
    let mut code: Option<String> = None;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        match k {
            "code" => code = Some(urlencoding::decode(v).map(|c| c.into_owned()).unwrap_or_default()),
            "error" => return Err(format!("slack returned error: {v}")),
            _ => {}
        }
    }
    code.filter(|c| !c.is_empty()).ok_or_else(|| "no code in callback".into())
}

// Map a Slack conversation `is_*`/type marker to our row kind.
pub fn conversation_kind(slack_type: &str) -> &'static str {
    match slack_type {
        "im" => "im",
        "mpim" => "mpim",
        _ => "channel",
    }
}

// Build a row from a conversations.info object + its latest message object.
// NOTE: field paths reflect documented Slack shapes; the live smoke (Task 10) confirms/adjusts them.
pub fn parse_conversation(info: &serde_json::Value, latest: &serde_json::Value) -> Option<UnreadConversation> {
    let id = info.get("id")?.as_str()?.to_string();
    let unread_count = info.get("unread_count_display").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let kind = if info.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false) {
        "im"
    } else if info.get("is_mpim").and_then(|v| v.as_bool()).unwrap_or(false) {
        "mpim"
    } else {
        "channel"
    };
    // Channel name from `name`; DM name resolved later via users.info (Task 5) — fall back to id here.
    let name = info.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
    let latest_text = latest.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let latest_ts = latest.get("ts").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Some(UnreadConversation {
        id,
        kind: kind.to_string(),
        name,
        avatar_url: None,
        unread_count,
        latest_text,
        latest_ts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn authorize_url_includes_client_scopes_and_redirect() {
        let u = authorize_url("123.456", "http://localhost:9001/callback");
        assert!(u.starts_with("https://slack.com/oauth/v2/authorize?"));
        assert!(u.contains("client_id=123.456"));
        assert!(u.contains("user_scope=channels%3Aread")); // scopes are url-encoded
        assert!(u.contains("redirect_uri=http%3A%2F%2Flocalhost%3A9001%2Fcallback"));
    }

    #[test]
    fn parse_callback_extracts_code() {
        assert_eq!(parse_callback_code("?code=abc123&state=x").unwrap(), "abc123");
    }

    #[test]
    fn parse_callback_surfaces_error() {
        assert!(parse_callback_code("?error=access_denied").is_err());
    }

    #[test]
    fn parse_callback_missing_code_errors() {
        assert!(parse_callback_code("?state=only").is_err());
    }

    #[test]
    fn parse_conversation_builds_channel_row() {
        let info = json!({ "id": "C1", "name": "incidents", "unread_count_display": 3 });
        let latest = json!({ "text": "deploy blocked", "ts": "1700000000.000100" });
        let row = parse_conversation(&info, &latest).unwrap();
        assert_eq!(row.id, "C1");
        assert_eq!(row.kind, "channel");
        assert_eq!(row.name, "incidents");
        assert_eq!(row.unread_count, 3);
        assert_eq!(row.latest_text, "deploy blocked");
        assert_eq!(row.latest_ts, "1700000000.000100");
    }

    #[test]
    fn parse_conversation_marks_im_kind() {
        let info = json!({ "id": "D9", "is_im": true, "unread_count_display": 1 });
        let latest = json!({ "text": "hi", "ts": "1700000000.000200" });
        let row = parse_conversation(&info, &latest).unwrap();
        assert_eq!(row.kind, "im");
        assert_eq!(row.name, "D9"); // DM name resolved later; falls back to id
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add `mod slack;` (after `mod settings;`).

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(slack): pure OAuth-url, callback-parse, and snapshot-parse helpers"
```

---

## Task 4: Slack manager state + Web API client glue

**Files:**
- Modify: `src-tauri/src/slack.rs` (add `SlackManager`, HTTP helpers, `select_watched`)
- Test: inline tests for `select_watched`

**Interfaces:**
- Consumes: `crate::keychain::{TokenStore, KeyringStore}`, the pure fns + types from Task 3.
- Produces:
  - `struct SlackState { client_id: Option<String>, watched: Vec<String>, connected: bool, user_name: Option<String>, last: SlackSnapshot }`
  - `struct SlackManager { state: Mutex<SlackState>, store: Box<dyn TokenStore>, stop: Arc<AtomicBool> }` with `Default` building a `KeyringStore`.
  - `fn select_watched(all: &[(String,String)], watched: &[String]) -> Vec<String>` (filter helper, pure).
  - `fn api_get(token: &str, method: &str, params: &[(&str,&str)]) -> Result<serde_json::Value, String>` (ureq GET to `https://slack.com/api/<method>`).
  - `fn exchange_code(client_id: &str, client_secret: &str, code: &str, redirect_uri: &str) -> Result<(String,String), String>` returns `(user_token, user_name)`.

- [ ] **Step 1: Write the failing test for `select_watched`**

Add to `slack.rs` tests:
```rust
#[test]
fn select_watched_keeps_only_watched_ids_in_watched_order() {
    let all = vec![("C1".to_string(), "a".into()), ("C2".into(), "b".into()), ("D3".into(), "c".into())];
    assert_eq!(select_watched(&all, &["D3".into(), "C1".into()]), vec!["D3".to_string(), "C1".into()]);
    assert_eq!(select_watched(&all, &["CX".into()]), Vec::<String>::new());
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::select_watched`
Expected: FAIL — `select_watched` not found.

- [ ] **Step 3: Add state, manager, HTTP helpers, and `select_watched`**

Add to the top of `slack.rs` (imports):
```rust
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use crate::keychain::{KeyringStore, TokenStore};
```
Add after the pure fns:
```rust
// Keep only the watched ids, in the order the user listed them (pure → unit-tested).
pub fn select_watched(all: &[(String, String)], watched: &[String]) -> Vec<String> {
    let have: std::collections::HashSet<&str> = all.iter().map(|(id, _)| id.as_str()).collect();
    watched.iter().filter(|w| have.contains(w.as_str())).cloned().collect()
}

// Session state for the provider. Token + secret are NOT held here — they live in Keychain.
pub struct SlackState {
    pub client_id: Option<String>,
    pub watched: Vec<String>,
    pub connected: bool,
    pub user_name: Option<String>,
    pub last: SlackSnapshot,
}

impl Default for SlackState {
    fn default() -> Self {
        Self { client_id: None, watched: vec![], connected: false, user_name: None, last: SlackSnapshot::default() }
    }
}

// Tauri-managed provider handle (mirrors PtyManager).
pub struct SlackManager {
    pub state: Mutex<SlackState>,
    pub store: Box<dyn TokenStore>,
    pub stop: Arc<AtomicBool>,
}

impl Default for SlackManager {
    fn default() -> Self {
        Self {
            state: Mutex::new(SlackState::default()),
            store: Box::new(KeyringStore::new(SLACK_KEYCHAIN_SERVICE)),
            stop: Arc::new(AtomicBool::new(false)),
        }
    }
}

// One authenticated GET to the Slack Web API; treats `ok:false` as an error.
pub fn api_get(token: &str, method: &str, params: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let mut req = ureq::get(&format!("https://slack.com/api/{method}"))
        .set("Authorization", &format!("Bearer {token}"));
    for (k, v) in params {
        req = req.query(k, v);
    }
    let resp: serde_json::Value = req.call().map_err(|e| e.to_string())?.into_json().map_err(|e| e.to_string())?;
    if resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(resp)
    } else {
        Err(resp.get("error").and_then(|v| v.as_str()).unwrap_or("slack api error").to_string())
    }
}

// Exchange an OAuth code for the user token; returns (user_token, user_name-ish display).
pub fn exchange_code(client_id: &str, client_secret: &str, code: &str, redirect_uri: &str) -> Result<(String, String), String> {
    let resp: serde_json::Value = ureq::post("https://slack.com/api/oauth.v2.access")
        .send_form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("redirect_uri", redirect_uri),
        ])
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    if !resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err(resp.get("error").and_then(|v| v.as_str()).unwrap_or("oauth failed").to_string());
    }
    let token = resp.get("authed_user").and_then(|u| u.get("access_token")).and_then(|v| v.as_str())
        .ok_or("no user access_token in oauth response")?.to_string();
    let user_id = resp.get("authed_user").and_then(|u| u.get("id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok((token, user_id))
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::`
Expected: 7 passed (previous 6 + `select_watched`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack.rs
git commit -m "feat(slack): provider state, Web API client, OAuth code exchange"
```

---

## Task 5: Commands — credentials, connect (loopback OAuth), poll loop, snapshot

**Files:**
- Modify: `src-tauri/src/slack.rs` (add `#[tauri::command]` fns + poll loop)
- Modify: `src-tauri/src/lib.rs` (manage `SlackManager`, register commands)

**Interfaces:**
- Consumes: everything from Tasks 3–4; `tauri::{AppHandle, Emitter, State}`.
- Produces commands:
  - `slack_set_credentials(manager, client_id: String, client_secret: Option<String>) -> Result<(), String>`
  - `slack_set_watched(app, manager, ids: Vec<String>) -> Result<(), String>`
  - `slack_connect(app, manager) -> Result<String, String>` (returns authorize_url; spawns loopback thread)
  - `slack_disconnect(manager) -> Result<(), String>`
  - `slack_status(manager) -> SlackStatus` where `struct SlackStatus { connected: bool, user_name: Option<String>, has_credentials: bool }`
  - `slack_snapshot(manager) -> SlackSnapshot`
  - `slack_refresh(app, manager) -> Result<(), String>`
  - `slack_list_conversations(manager) -> Result<Vec<ConversationMeta>, String>` where `struct ConversationMeta { id: String, name: String, kind: String }`
  - `fn poll_once(token, watched) -> SlackSnapshot` and `fn start_polling(app, manager)` (thread).

> This task is I/O-heavy (browser + sockets), so it is verified by compile + the Task 10 live smoke rather than unit tests — matching the project's deduce-flow convention. Keep the pure pieces (Tasks 3–4) carrying the test weight.

- [ ] **Step 1: Add the command + helper code**

Append to `src-tauri/src/slack.rs`:
```rust
use tauri::{AppHandle, Emitter, State};
use std::sync::atomic::Ordering;

// Lightweight status for the Settings UI (does the app know creds? is a token live?).
#[derive(Debug, Clone, Serialize)]
pub struct SlackStatus {
    pub connected: bool,
    #[serde(rename = "userName", skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    #[serde(rename = "hasCredentials")]
    pub has_credentials: bool,
}

// One row for the watched-channels picker.
#[derive(Debug, Clone, Serialize)]
pub struct ConversationMeta {
    pub id: String,
    pub name: String,
    pub kind: String,
}

const REDIRECT_PORT_RANGE: std::ops::Range<u16> = 9000..9010;

// Store client_id in session state; persist client_secret to Keychain when provided.
#[tauri::command]
pub fn slack_set_credentials(manager: State<SlackManager>, client_id: String, client_secret: Option<String>) -> Result<(), String> {
    if let Some(secret) = client_secret.filter(|s| !s.is_empty()) {
        manager.store.set(ACCOUNT_SECRET, &secret)?;
    }
    manager.state.lock().unwrap().client_id = Some(client_id);
    Ok(())
}

// Update the watched set and immediately re-poll so the tile reflects the new selection.
#[tauri::command]
pub fn slack_set_watched(app: AppHandle, manager: State<SlackManager>, ids: Vec<String>) -> Result<(), String> {
    manager.state.lock().unwrap().watched = ids;
    refresh_now(&app, &manager);
    Ok(())
}

#[tauri::command]
pub fn slack_status(manager: State<SlackManager>) -> SlackStatus {
    let st = manager.state.lock().unwrap();
    let has_credentials = st.client_id.is_some() && manager.store.get(ACCOUNT_SECRET).ok().flatten().is_some();
    SlackStatus { connected: st.connected, user_name: st.user_name.clone(), has_credentials }
}

#[tauri::command]
pub fn slack_snapshot(manager: State<SlackManager>) -> SlackSnapshot {
    manager.state.lock().unwrap().last.clone()
}

// List the user's conversations for the picker (names resolved best-effort).
#[tauri::command]
pub fn slack_list_conversations(manager: State<SlackManager>) -> Result<Vec<ConversationMeta>, String> {
    let token = manager.store.get(ACCOUNT_TOKEN)?.ok_or("not connected")?;
    let resp = api_get(&token, "users.conversations", &[("types", "public_channel,private_channel,im,mpim"), ("limit", "200")])?;
    let mut out = vec![];
    if let Some(arr) = resp.get("channels").and_then(|v| v.as_array()) {
        for c in arr {
            let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let kind = if c.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false) { "im" }
                else if c.get("is_mpim").and_then(|v| v.as_bool()).unwrap_or(false) { "mpim" }
                else { "channel" };
            let name = c.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
            out.push(ConversationMeta { id, name, kind: kind.to_string() });
        }
    }
    Ok(out)
}

// Forget the token + secret, stop polling, and mark disconnected.
#[tauri::command]
pub fn slack_disconnect(manager: State<SlackManager>) -> Result<(), String> {
    manager.stop.store(true, Ordering::SeqCst);
    manager.store.delete(ACCOUNT_TOKEN).ok();
    let mut st = manager.state.lock().unwrap();
    st.connected = false;
    st.user_name = None;
    st.last = SlackSnapshot::default();
    Ok(())
}

// Start OAuth: bind a loopback callback server, return the authorize URL for the frontend to open.
#[tauri::command]
pub fn slack_connect(app: AppHandle, manager: State<SlackManager>) -> Result<String, String> {
    let client_id = manager.state.lock().unwrap().client_id.clone().ok_or("set client_id first")?;
    let client_secret = manager.store.get(ACCOUNT_SECRET)?.ok_or("set client_secret first")?;
    // Bind the first free port in our small range so the redirect_uri is predictable for the Slack app config.
    let server = REDIRECT_PORT_RANGE
        .filter_map(|p| tiny_http::Server::http(("127.0.0.1", p)).ok().map(|s| (p, s)))
        .next()
        .ok_or("no free loopback port in 9000-9009")?;
    let (port, server) = server;
    let redirect_uri = format!("http://localhost:{port}/callback");
    let url = authorize_url(&client_id, &redirect_uri);

    // Background thread: wait for the redirect, exchange the code, store token, start polling.
    let app2 = app.clone();
    std::thread::spawn(move || {
        // ~2 min budget: tiny_http recv_timeout loop.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while std::time::Instant::now() < deadline {
            match server.recv_timeout(std::time::Duration::from_secs(2)) {
                Ok(Some(req)) => {
                    let code = parse_callback_code(req.url());
                    let body = match &code {
                        Ok(_) => "Connected to Slack. You can close this tab.",
                        Err(_) => "Slack connection failed. You can close this tab.",
                    };
                    let _ = req.respond(tiny_http::Response::from_string(body));
                    if let Ok(code) = code {
                        finish_connect(&app2, &client_id, &client_secret, &code, &redirect_uri);
                    }
                    return;
                }
                Ok(None) => continue,
                Err(_) => return,
            }
        }
    });
    Ok(url)
}

// Exchange code → token, persist, hydrate state, emit slack://connected, start polling.
fn finish_connect(app: &AppHandle, client_id: &str, client_secret: &str, code: &str, redirect_uri: &str) {
    let manager = app.state::<SlackManager>();
    match exchange_code(client_id, client_secret, code, redirect_uri) {
        Ok((token, user_id)) => {
            if manager.store.set(ACCOUNT_TOKEN, &token).is_err() {
                let _ = app.emit("slack://connected", serde_json::json!({ "connected": false, "error": "keychain write failed" }));
                return;
            }
            {
                let mut st = manager.state.lock().unwrap();
                st.connected = true;
                st.user_name = Some(user_id.clone());
            }
            let _ = app.emit("slack://connected", serde_json::json!({ "connected": true, "userName": user_id }));
            start_polling(app.clone());
        }
        Err(e) => {
            let _ = app.emit("slack://connected", serde_json::json!({ "connected": false, "error": e }));
        }
    }
}

// Force a one-shot poll (used by slack_refresh / slack_set_watched / on-focus).
fn refresh_now(app: &AppHandle, manager: &SlackManager) {
    let token = match manager.store.get(ACCOUNT_TOKEN) { Ok(Some(t)) => t, _ => return };
    let watched = manager.state.lock().unwrap().watched.clone();
    let snap = poll_once(&token, &watched);
    manager.state.lock().unwrap().last = snap.clone();
    let _ = app.emit("slack://unread", snap);
}

#[tauri::command]
pub fn slack_refresh(app: AppHandle, manager: State<SlackManager>) -> Result<(), String> {
    refresh_now(&app, &manager);
    Ok(())
}

// Poll each watched conversation: info (unread + name) + history (latest message).
pub fn poll_once(token: &str, watched: &[String]) -> SlackSnapshot {
    let mut conversations = vec![];
    let mut error = None;
    for id in watched {
        let info = match api_get(token, "conversations.info", &[("channel", id)]) {
            Ok(v) => v.get("channel").cloned().unwrap_or(serde_json::Value::Null),
            Err(e) => { error = Some(e); continue; }
        };
        let latest = api_get(token, "conversations.history", &[("channel", id), ("limit", "1")])
            .ok()
            .and_then(|v| v.get("messages").and_then(|m| m.as_array()).and_then(|a| a.first().cloned()))
            .unwrap_or(serde_json::Value::Null);
        if let Some(row) = parse_conversation(&info, &latest) {
            if row.unread_count > 0 {
                conversations.push(row);
            }
        }
    }
    // Newest first by Slack ts (string compare is correct for fixed-width epoch.micros).
    conversations.sort_by(|a, b| b.latest_ts.cmp(&a.latest_ts));
    SlackSnapshot { connected: true, error, conversations }
}

// Background poll loop: every 30s while a token exists and stop isn't set.
pub fn start_polling(app: AppHandle) {
    let manager = app.state::<SlackManager>();
    manager.stop.store(false, Ordering::SeqCst);
    let stop = manager.stop.clone();
    std::thread::spawn(move || {
        loop {
            if stop.load(Ordering::SeqCst) { return; }
            let manager = app.state::<SlackManager>();
            refresh_now(&app, &manager);
            for _ in 0..30 {
                if stop.load(Ordering::SeqCst) { return; }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    });
}

// Hydrate the provider from persisted config at startup; start polling if a token already exists.
#[tauri::command]
pub fn slack_init(app: AppHandle, manager: State<SlackManager>, client_id: Option<String>, watched_channel_ids: Vec<String>) -> Result<(), String> {
    {
        let mut st = manager.state.lock().unwrap();
        st.client_id = client_id;
        st.watched = watched_channel_ids;
    }
    if manager.store.get(ACCOUNT_TOKEN)?.is_some() {
        manager.state.lock().unwrap().connected = true;
        start_polling(app.clone());
    }
    Ok(())
}
```

- [ ] **Step 2: Register the manager + commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add `.manage(slack::SlackManager::default())` after the existing `.manage(...)`, and add to `generate_handler!`:
```rust
            slack::slack_set_credentials,
            slack::slack_set_watched,
            slack::slack_connect,
            slack::slack_disconnect,
            slack::slack_status,
            slack::slack_snapshot,
            slack::slack_refresh,
            slack::slack_list_conversations,
            slack::slack_init,
```

- [ ] **Step 3: Build — expect clean compile**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles. Fix any borrow/type errors (common: `app.state::<SlackManager>()` needs `use tauri::Manager;` — add it to the imports if the compiler asks).

- [ ] **Step 4: Run the full Rust test suite — expect green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack.rs src-tauri/src/lib.rs
git commit -m "feat(slack): OAuth connect, poll loop, and provider commands"
```

---

## Task 6: Connections registry (`auth.rs`)

**Files:**
- Create: `src-tauri/src/auth.rs`
- Modify: `src-tauri/src/lib.rs` (`mod auth;` + register `auth::list_connections`)
- Test: inline test

**Interfaces:**
- Consumes: `SlackManager`, `slack_status` logic.
- Produces: `struct Connection { service: String, connected: bool, label: String }`, command `list_connections(manager: State<SlackManager>) -> Vec<Connection>`.

- [ ] **Step 1: Write the file + test**

Create `src-tauri/src/auth.rs`:
```rust
//! auth.rs — connections registry: one row per integration's auth status. Backs the Settings "Connections" section.
use serde::Serialize;
use tauri::State;
use crate::slack::SlackManager;

// One service's connection status for the Settings UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Connection {
    pub service: String,
    pub connected: bool,
    pub label: String,
}

// Build the label shown beside a service ("Connected as <user>" / "Not connected").
pub fn connection_label(connected: bool, user: Option<&str>) -> String {
    match (connected, user) {
        (true, Some(u)) if !u.is_empty() => format!("Connected as {u}"),
        (true, _) => "Connected".into(),
        (false, _) => "Not connected".into(),
    }
}

// The full registry. One entry (Slack) today; later tiles push more rows.
#[tauri::command]
pub fn list_connections(manager: State<SlackManager>) -> Vec<Connection> {
    let st = manager.state.lock().unwrap();
    vec![Connection {
        service: "slack".into(),
        connected: st.connected,
        label: connection_label(st.connected, st.user_name.as_deref()),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_reflects_state() {
        assert_eq!(connection_label(true, Some("U123")), "Connected as U123");
        assert_eq!(connection_label(true, None), "Connected");
        assert_eq!(connection_label(false, None), "Not connected");
    }
}
```

- [ ] **Step 2: Register**

In `lib.rs`: add `mod auth;` and `auth::list_connections,` to the handler list.

- [ ] **Step 3: Run — expect PASS + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml auth::`
Expected: 1 passed.
Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/auth.rs src-tauri/src/lib.rs
git commit -m "feat(slack): connections registry for the Settings auth section"
```

---

## Task 7: Frontend types + API wrappers

**Files:**
- Create: `src/tiles/slack/types.ts`
- Create: `src/tiles/slack/api.ts`

**Interfaces:**
- Produces (types): `SlackConversation`, `SlackSnapshot`, `SlackStatus`, `ConversationMeta`.
- Produces (api): `slackStatus`, `slackConnect`, `slackDisconnect`, `slackSetCredentials`, `slackSetWatched`, `slackListConversations`, `slackSnapshot`, `slackRefresh`, `slackInit`.

- [ ] **Step 1: Write the types**

Create `src/tiles/slack/types.ts`:
```ts
// types.ts — TS shapes mirroring the Rust slack provider payloads.
export interface SlackConversation {
  id: string;
  kind: "channel" | "im" | "mpim";
  name: string;
  avatarUrl?: string;
  unreadCount: number;
  latestText: string;
  latestTs: string;
}
export interface SlackSnapshot {
  connected: boolean;
  error?: string;
  conversations: SlackConversation[];
}
export interface SlackStatus {
  connected: boolean;
  userName?: string;
  hasCredentials: boolean;
}
export interface ConversationMeta {
  id: string;
  name: string;
  kind: "channel" | "im" | "mpim";
}
```

- [ ] **Step 2: Write the API wrappers**

Create `src/tiles/slack/api.ts`:
```ts
// api.ts — typed wrappers over the Slack provider IPC commands.
import { invoke } from "@tauri-apps/api/core";
import type { SlackSnapshot, SlackStatus, ConversationMeta } from "./types";

export const slackStatus = () => invoke<SlackStatus>("slack_status");
export const slackSnapshot = () => invoke<SlackSnapshot>("slack_snapshot");
export const slackConnect = () => invoke<string>("slack_connect"); // returns authorize URL
export const slackDisconnect = () => invoke<void>("slack_disconnect");
export const slackRefresh = () => invoke<void>("slack_refresh");
export const slackListConversations = () => invoke<ConversationMeta[]>("slack_list_conversations");
export const slackSetWatched = (ids: string[]) => invoke<void>("slack_set_watched", { ids });
export const slackSetCredentials = (clientId: string, clientSecret?: string) =>
  invoke<void>("slack_set_credentials", { clientId, clientSecret: clientSecret ?? null });
export const slackInit = (clientId: string | undefined, watchedChannelIds: string[]) =>
  invoke<void>("slack_init", { clientId: clientId ?? null, watchedChannelIds });
```

- [ ] **Step 3: Build — expect clean**

Run: `npm run build`
Expected: type-checks clean.

- [ ] **Step 4: Commit**

```bash
git add src/tiles/slack/types.ts src/tiles/slack/api.ts
git commit -m "feat(slack): frontend types + IPC wrappers"
```

---

## Task 8: Pure UI helpers — relative time + row sort

**Files:**
- Create: `src/tiles/slack/time.ts`
- Create: `src/tiles/slack/time.test.ts`
- Create: `src/tiles/slack/rows.ts`
- Create: `src/tiles/slack/rows.test.ts`

**Interfaces:**
- Produces: `relativeTime(tsSeconds: number, nowMs: number): string`, `sortByRecency(convs: SlackConversation[]): SlackConversation[]`.

- [ ] **Step 1: Write failing time tests**

Create `src/tiles/slack/time.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { relativeTime } from "./time";

const NOW = 1_700_000_000_000; // ms

describe("relativeTime", () => {
  it("shows seconds under a minute as 'now'", () => {
    expect(relativeTime(1_700_000_000 - 5, NOW)).toBe("now");
  });
  it("shows minutes", () => {
    expect(relativeTime(1_700_000_000 - 120, NOW)).toBe("2m");
  });
  it("shows hours", () => {
    expect(relativeTime(1_700_000_000 - 3 * 3600, NOW)).toBe("3h");
  });
  it("shows days", () => {
    expect(relativeTime(1_700_000_000 - 2 * 86400, NOW)).toBe("2d");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/tiles/slack/time.test.ts`
Expected: FAIL — cannot find `./time`.

- [ ] **Step 3: Implement `time.ts`**

Create `src/tiles/slack/time.ts`:
```ts
// time.ts — compact relative-time label for Slack rows (Slack ts is epoch seconds, possibly fractional).
export function relativeTime(tsSeconds: number, nowMs: number): string {
  const deltaSec = Math.max(0, Math.floor(nowMs / 1000 - tsSeconds));
  if (deltaSec < 60) return "now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  return `${Math.floor(deltaSec / 86400)}d`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/tiles/slack/time.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write failing rows test + implement**

Create `src/tiles/slack/rows.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sortByRecency } from "./rows";
import type { SlackConversation } from "./types";

const c = (id: string, ts: string): SlackConversation => ({
  id, kind: "channel", name: id, unreadCount: 1, latestText: "", latestTs: ts,
});

describe("sortByRecency", () => {
  it("orders newest ts first without mutating input", () => {
    const input = [c("a", "100.1"), c("b", "300.2"), c("d", "200.0")];
    const out = sortByRecency(input);
    expect(out.map((x) => x.id)).toEqual(["b", "d", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "d"]); // input untouched
  });
});
```
Create `src/tiles/slack/rows.ts`:
```ts
// rows.ts — pure ordering helpers for the Slack tile.
import type { SlackConversation } from "./types";

// Newest first by Slack ts. Copy first so React state isn't mutated in place.
export function sortByRecency(convs: SlackConversation[]): SlackConversation[] {
  return [...convs].sort((a, b) => b.latestTs.localeCompare(a.latestTs));
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `npx vitest run src/tiles/slack/rows.test.ts`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add src/tiles/slack/time.ts src/tiles/slack/time.test.ts src/tiles/slack/rows.ts src/tiles/slack/rows.test.ts
git commit -m "feat(slack): pure relative-time + row-sort helpers (tested)"
```

---

## Task 9: SlackTile component + Cockpit tile column

**Files:**
- Create: `src/tiles/slack/SlackTile.tsx`
- Create: `src/tiles/slack/slack.css`
- Modify: `src/views/CockpitView.tsx`
- Modify: `src/views/CockpitView.css` (or import slack.css)

**Interfaces:**
- Consumes: `slackSnapshot`, `slackRefresh` (Task 7), `relativeTime`/`sortByRecency` (Task 8), `listen` for `slack://unread` + `slack://connected`, `openUrl`.
- Produces: `<SlackTile />`, a left `TileColumn` in `CockpitView`.

- [ ] **Step 1: Write `SlackTile.tsx`**

Create `src/tiles/slack/SlackTile.tsx`:
```tsx
// SlackTile.tsx — read-only Slack unread panel: first paint from slack_snapshot, live updates via slack://unread.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { slackSnapshot, slackRefresh } from "./api";
import type { SlackSnapshot } from "./types";
import { relativeTime } from "./time";
import { sortByRecency } from "./rows";
import "./slack.css";

export function SlackTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [snap, setSnap] = useState<SlackSnapshot>({ connected: false, conversations: [] });

  useEffect(() => {
    let un: (() => void) | undefined;
    slackSnapshot().then(setSnap).catch(() => {});
    listen<SlackSnapshot>("slack://unread", (e) => setSnap(e.payload)).then((u) => (un = u));
    // Refresh when the window regains focus so the tile feels live between polls.
    const onFocus = () => slackRefresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { un?.(); window.removeEventListener("focus", onFocus); };
  }, []);

  const rows = sortByRecency(snap.conversations);
  const now = Date.now();

  return (
    <section className="slack-tile">
      <header className="slack-tile__head">
        <span className="slack-tile__title">SLACK</span>
        <button className="slack-tile__gear" aria-label="slack settings" onClick={onOpenSettings}>⚙</button>
      </header>
      {!snap.connected ? (
        <button className="slack-tile__cta" onClick={onOpenSettings}>Connect Slack in Settings</button>
      ) : rows.length === 0 ? (
        <div className="slack-tile__empty">{snap.error ? `⚠ ${snap.error}` : "All caught up"}</div>
      ) : (
        <ul className="slack-tile__list">
          {rows.map((c) => (
            <li key={c.id} className="slack-tile__row" onClick={() => openUrl(`slack://channel?id=${c.id}`)}>
              <span className="slack-tile__icon">{c.kind === "channel" ? "#" : "@"}</span>
              <span className="slack-tile__body">
                <span className="slack-tile__name">{c.name}</span>
                <span className="slack-tile__preview">{c.latestText}</span>
              </span>
              <span className="slack-tile__meta">
                <span className="slack-tile__time">{relativeTime(Number(c.latestTs), now)}</span>
                <span className="slack-tile__badge">{c.unreadCount}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Write `slack.css`**

Create `src/tiles/slack/slack.css` (use existing theme tokens; keep it plain per CLAUDE.md — iterate on polish later):
```css
/* slack.css — minimal styling for the Slack unread tile, over the shared theme tokens. */
.slack-tile { display: flex; flex-direction: column; background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; }
.slack-tile__head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); }
.slack-tile__title { font-size: 11px; letter-spacing: 0.08em; opacity: 0.7; }
.slack-tile__gear { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.6; }
.slack-tile__list { list-style: none; margin: 0; padding: 0; }
.slack-tile__row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border-subtle); }
.slack-tile__row:hover { background: var(--surface-2); }
.slack-tile__icon { width: 16px; text-align: center; opacity: 0.6; }
.slack-tile__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.slack-tile__name { font-size: 12px; font-weight: 600; }
.slack-tile__preview { font-size: 11px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slack-tile__meta { display: flex; align-items: center; gap: 6px; }
.slack-tile__time { font-size: 10px; opacity: 0.5; }
.slack-tile__badge { font-size: 10px; background: var(--accent, #4f8); color: #000; border-radius: 8px; padding: 0 6px; min-width: 16px; text-align: center; }
.slack-tile__cta, .slack-tile__empty { padding: 14px 10px; font-size: 12px; opacity: 0.7; text-align: center; background: none; border: none; cursor: pointer; color: inherit; }
```
> If a token name (`--surface-1`, `--accent`, etc.) doesn't exist in `src/theme/tokens.css`, substitute the nearest existing token — check that file first.

- [ ] **Step 3: Wire the tile column into CockpitView**

Replace `src/views/CockpitView.tsx` body so the left column hosts the Slack tile. The Settings modal is owned by `App.tsx`, so expose an `onOpenSettings` prop:
```tsx
// CockpitView.tsx — dashboard view: left TILES column (Slack today) + center placeholder. Worktree column lands later.
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
      </aside>
      <div className="cockpit-view__center">
        <div className="cockpit-view__card">
          <h2>Cockpit</h2>
          <p>To-do / timer / tickets land here in a later sub-project.</p>
        </div>
      </div>
    </div>
  );
}
```
In `src/App.tsx` line 79, pass the prop: `{view === "cockpit" && <CockpitView onOpenSettings={() => setSettingsOpen(true)} />}`.
Add layout CSS to `src/views/CockpitView.css`:
```css
.cockpit-view { display: flex; gap: 12px; padding: 12px; height: 100%; box-sizing: border-box; }
.cockpit-view__tiles { width: 280px; flex: 0 0 280px; display: flex; flex-direction: column; gap: 10px; }
.cockpit-view__tiles-label { font-size: 11px; letter-spacing: 0.08em; opacity: 0.5; }
.cockpit-view__center { flex: 1; }
```

- [ ] **Step 4: Build — expect clean**

Run: `npm run build`
Expected: type-checks + bundles clean.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/slack/SlackTile.tsx src/tiles/slack/slack.css src/views/CockpitView.tsx src/views/CockpitView.css src/App.tsx
git commit -m "feat(slack): SlackTile panel + Cockpit-view tile column"
```

---

## Task 10: Settings "Connections" section + startup hydration + live acceptance

**Files:**
- Create: `src/tiles/slack/SlackConnections.tsx`
- Modify: `src/views/SettingsModal.tsx`
- Modify: `src/settings/store.ts` (add `setSlackClientId`, `setSlackWatched`)
- Modify: `src/App.tsx` (call `slackInit` after settings load)

**Interfaces:**
- Consumes: all Task 7 api fns; store config from Task 2.
- Produces: `<SlackConnections />`, store actions `setSlackClientId(id)`, `setSlackWatched(ids)`.

- [ ] **Step 1: Add store actions**

In `src/settings/store.ts`, add to the interface and implementation (functional updaters, mirroring `setRepoHost`):
```ts
  setSlackClientId: (clientId: string) => void;
  setSlackWatched: (ids: string[]) => void;
```
```ts
  setSlackClientId: (clientId) =>
    get().setCockpit((c) => ({ ...c, integrations: { ...c.integrations, slack: { ...c.integrations?.slack, watchedChannelIds: c.integrations?.slack?.watchedChannelIds ?? [], clientId } } })),
  setSlackWatched: (ids) =>
    get().setCockpit((c) => ({ ...c, integrations: { ...c.integrations, slack: { ...c.integrations?.slack, clientId: c.integrations?.slack?.clientId, watchedChannelIds: ids } } })),
```

- [ ] **Step 2: Write `SlackConnections.tsx`**

Create `src/tiles/slack/SlackConnections.tsx`:
```tsx
// SlackConnections.tsx — Settings section: enter Slack app credentials, connect/disconnect, pick watched channels.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettings } from "../../settings/store";
import { slackStatus, slackConnect, slackDisconnect, slackSetCredentials, slackListConversations, slackSetWatched } from "./api";
import type { SlackStatus, ConversationMeta } from "./types";

export function SlackConnections() {
  const { cockpit, setSlackClientId, setSlackWatched } = useSettings();
  const slack = cockpit.integrations?.slack;
  const [status, setStatus] = useState<SlackStatus>({ connected: false, hasCredentials: false });
  const [clientId, setClientId] = useState(slack?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [convs, setConvs] = useState<ConversationMeta[]>([]);

  useEffect(() => {
    slackStatus().then(setStatus).catch(() => {});
    const p = listen<SlackStatus>("slack://connected", () => slackStatus().then(setStatus).catch(() => {}));
    return () => { p.then((u) => u()); };
  }, []);

  // Load the conversation list for the picker once connected.
  useEffect(() => {
    if (status.connected) slackListConversations().then(setConvs).catch(() => {});
  }, [status.connected]);

  const saveCreds = async () => {
    await slackSetCredentials(clientId.trim(), clientSecret.trim() || undefined);
    setSlackClientId(clientId.trim());
    setClientSecret("");
    setStatus(await slackStatus());
  };
  const connect = async () => { const url = await slackConnect(); await openUrl(url); };
  const disconnect = async () => { await slackDisconnect(); setStatus(await slackStatus()); };

  const toggleWatch = async (id: string) => {
    const current = slack?.watchedChannelIds ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setSlackWatched(next);
    await slackSetWatched(next);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong style={{ fontSize: 13 }}>Connections — Slack</strong>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{status.connected ? "Connected" : "Not connected"}</div>
      <input placeholder="Slack app client id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <input placeholder="Slack app client secret (stored in Keychain)" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={saveCreds} disabled={!clientId.trim()}>Save credentials</button>
        {status.connected
          ? <button onClick={disconnect}>Disconnect</button>
          : <button onClick={connect} disabled={!status.hasCredentials}>Connect Slack</button>}
      </div>
      {status.connected && (
        <div style={{ display: "grid", gap: 4, maxHeight: 200, overflow: "auto", borderTop: "1px solid var(--border-subtle)", paddingTop: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Watched channels</span>
          {convs.map((c) => (
            <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" checked={(slack?.watchedChannelIds ?? []).includes(c.id)} onChange={() => toggleWatch(c.id)} />
              {c.kind === "channel" ? "#" : "@"} {c.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it in SettingsModal**

In `src/views/SettingsModal.tsx`, import `SlackConnections` and render it inside the modal's grid, above or below "Known repos", separated by a divider:
```tsx
import { SlackConnections } from "../tiles/slack/SlackConnections";
```
Add at the top of the `<div style={{ display: "grid", gap: 12 }}>`:
```tsx
        <SlackConnections />
        <hr style={{ width: "100%", border: "none", borderTop: "1px solid var(--border-subtle)" }} />
```

- [ ] **Step 4: Hydrate the provider at startup**

In `src/App.tsx`, in the `loadSettings().then((s) => { ... })` callback (around line 36), after `init(s)`, add:
```tsx
        const slack = s.cockpit.integrations?.slack;
        slackInit(slack?.clientId, slack?.watchedChannelIds ?? []).catch(() => {});
```
And import: `import { slackInit } from "./tiles/slack/api";`

- [ ] **Step 5: Build + full test suite — expect green**

Run: `npm run build`
Expected: clean.
Run: `npm test`
Expected: all JS tests pass.
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tiles/slack/SlackConnections.tsx src/views/SettingsModal.tsx src/settings/store.ts src/App.tsx
git commit -m "feat(slack): Settings connections section + startup hydration"
```

- [ ] **Step 7: Live smoke — pin the unread endpoint (manual)**

Prereq: register a Slack app (User Token Scopes = the `SCOPES` list), set its OAuth redirect URL to `http://localhost:9000/callback` (and 9001–9009 as spares), note client id + secret.

1. `npm run tauri dev`.
2. Open Settings → enter client id + secret → Save credentials → Connect Slack → authorize in the browser.
3. Confirm the loopback page says "Connected", and Settings flips to "Connected".
4. Tick a channel you have unread messages in; confirm the Slack tile shows it with the right unread count + latest-message preview + relative time.
5. **If unread counts are wrong or zero:** the `conversations.info` field path is the suspect. Verify against a real response (`curl -s -H "Authorization: Bearer <token>" "https://slack.com/api/conversations.info?channel=<id>"`). Adjust `parse_conversation` / `poll_once` field paths, then re-run. Record the confirmed endpoint+fields in `CLAUDE.md` "As-built notes" (same as the deduce-flow MCP pinning).
6. Click a row → confirm it opens the channel in Slack.
7. Disconnect → confirm the tile returns to the "Connect Slack in Settings" CTA and the token is gone (reconnect requires re-auth).

- [ ] **Step 8: Commit any endpoint fixes + update docs**

```bash
git add -A
git commit -m "fix(slack): pin unread endpoint fields from live smoke"
```
Update `CLAUDE.md` "As-built notes" + flip `docs/ROADMAP.md` SP4 to done (move the entry to CLAUDE.md "Status").

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- Keychain token store → Task 1. ✅
- Slack provider (OAuth, Web API, poll loop, event stream) → Tasks 3,4,5. ✅
- Connections registry → Task 6. ✅
- Cockpit left tile host (Slack-only) → Task 9. ✅
- SlackTile render states (rows/empty/disconnected/error) → Task 9 (`SlackTile` branches). ✅
- Settings "Connections" (connect/disconnect, credentials, watched picker) → Task 10. ✅
- Config (`integrations.slack`, secrets in Keychain only) → Task 2 (config) + Task 1/5 (Keychain). ✅
- OAuth browser/loopback flow → Task 5 (`slack_connect`/`finish_connect`). ✅
- Data flow (snapshot first paint + `slack://unread`) → Tasks 5,9. ✅
- Error handling (not-connected CTA, poll error keeps last snapshot, disconnect) → Tasks 5 (`poll_once` error field, `slack_disconnect`), 9 (UI branches). ✅
- Testing (Rust pure-fn units, JS pure-fn units, live smoke) → Tasks 1,3,4,6,8,10. ✅
- Unread-endpoint pin by live smoke → Task 10 step 7. ✅

**2. Placeholder scan:** No "TBD"/"handle edge cases" left abstract — error handling is concrete (`error` field threaded through `poll_once` → snapshot → tile; disconnect resets state). The single deliberate unknown (exact Slack unread field path) is bounded with a concrete verification + curl in Task 10. ✅

**3. Type consistency:** `SlackSnapshot`/`UnreadConversation`/`SlackStatus`/`ConversationMeta` field names match across Rust serde (`#[serde(rename)]`) and TS (`src/tiles/slack/types.ts`). Command names match between `lib.rs` handler registration, Rust `#[tauri::command]` fns, and `api.ts` invoke strings (`slack_set_credentials`, `slack_set_watched`, `slack_connect`, `slack_disconnect`, `slack_status`, `slack_snapshot`, `slack_refresh`, `slack_list_conversations`, `slack_init`, `list_connections`). Store actions `setSlackClientId`/`setSlackWatched` match between interface + impl + `SlackConnections` usage. ✅

> One known caveat for the implementer: `list_connections` is registered (Task 6) but its frontend consumer is deferred — `SlackConnections` reads `slack_status` directly for the single-service case. `list_connections` exists as the seam SP5 will consume when there are 2+ services. This is intentional, not a gap.
