//! slack.rs — Slack provider: OAuth + Keychain user token + background unread polling, emitted as a slack://unread event stream.
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use crate::keychain::{KeyringStore, TokenStore};

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
    // Detect raw kind marker from JSON booleans, then map through conversation_kind for consistent handling.
    let raw = if info.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false) {
        "im"
    } else if info.get("is_mpim").and_then(|v| v.as_bool()).unwrap_or(false) {
        "mpim"
    } else {
        "channel"
    };
    let kind = conversation_kind(raw);
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

    #[test]
    fn conversation_kind_maps_mpim() {
        assert_eq!(conversation_kind("mpim"), "mpim");
        assert_eq!(conversation_kind("im"), "im");
        assert_eq!(conversation_kind("public_channel"), "channel");
        assert_eq!(conversation_kind("unknown"), "channel");
    }

    #[test]
    fn parse_conversation_marks_mpim_kind() {
        let info = json!({ "id": "G7", "is_mpim": true, "unread_count_display": 2 });
        let latest = json!({ "text": "x", "ts": "1700000000.000300" });
        let row = parse_conversation(&info, &latest).unwrap();
        assert_eq!(row.kind, "mpim");
    }

    #[test]
    fn select_watched_keeps_only_watched_ids_in_watched_order() {
        let all = vec![("C1".to_string(), "a".into()), ("C2".into(), "b".into()), ("D3".into(), "c".into())];
        assert_eq!(select_watched(&all, &["D3".into(), "C1".into()]), vec!["D3".to_string(), "C1".into()]);
        assert_eq!(select_watched(&all, &["CX".into()]), Vec::<String>::new());
    }
}
