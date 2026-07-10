//! slack.rs — Slack provider: OAuth + Keychain user token + background unread polling, emitted as a slack://unread event stream.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64};
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
    // `req.url()` is the full path+query (e.g. "/callback?code=…"); take everything after the first '?'.
    // Falls back to the whole string so a bare "?code=…" query still parses.
    let q = query.split_once('?').map(|(_, rest)| rest).unwrap_or(query);
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

// Build a row from a conversations.info object + its history messages (newest first). The caller
// fetches history with oldest=last_read, so `messages` already IS the unread set; the ts>last_read
// filter here is a defensive re-check (Slack's conversations.info gives no reliable unread count).
// `im_name` is the pre-resolved partner display name for a 1:1 DM (from users.info, cached by the
// caller); None falls back to the id. Channels/mpim ignore it and use the conversation's own `name`.
pub fn parse_conversation(info: &serde_json::Value, messages: &[serde_json::Value], im_name: Option<&str>) -> Option<UnreadConversation> {
    let id = info.get("id")?.as_str()?.to_string();
    // `last_read` is the ts of the newest message the user has read; anything after it is unread.
    // ts is fixed-width "epoch.micros" so lexicographic string comparison is correct.
    let last_read = info.get("last_read").and_then(|v| v.as_str()).unwrap_or("0");
    let unread_count = messages
        .iter()
        .filter(|m| m.get("ts").and_then(|v| v.as_str()).map(|ts| ts > last_read).unwrap_or(false))
        .count() as u32;
    // Detect raw kind marker from JSON booleans, then map through conversation_kind for consistent handling.
    let raw = if info.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false) {
        "im"
    } else if info.get("is_mpim").and_then(|v| v.as_bool()).unwrap_or(false) {
        "mpim"
    } else {
        "channel"
    };
    let kind = conversation_kind(raw);
    // 1:1 DM → resolved partner name (else id); channel/mpim → the conversation's own `name`
    // (group DMs carry Slack's synthetic "mpdm-…" name, used as-is).
    let name = if raw == "im" {
        im_name.map(|s| s.to_string()).unwrap_or_else(|| id.clone())
    } else {
        info.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string()
    };
    // Newest message (messages[0]) drives the preview text/ts.
    let latest = messages.first();
    let latest_text = latest.and_then(|m| m.get("text")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let latest_ts = latest.and_then(|m| m.get("ts")).and_then(|v| v.as_str()).unwrap_or("").to_string();
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

// Session state for the provider. Token + secret are NOT held here — they live in Keychain.
pub struct SlackState {
    pub client_id: Option<String>,
    pub watched: Vec<String>,
    pub connected: bool,
    pub user_name: Option<String>,
    pub last: SlackSnapshot,
    // In-memory cache of DM partner user-id → display name, so we resolve each partner only once.
    pub user_names: HashMap<String, String>,
}

impl Default for SlackState {
    fn default() -> Self {
        Self { client_id: None, watched: vec![], connected: false, user_name: None, last: SlackSnapshot::default(), user_names: HashMap::new() }
    }
}

// Tauri-managed provider handle (mirrors PtyManager).
pub struct SlackManager {
    pub state: Mutex<SlackState>,
    pub store: Box<dyn TokenStore>,
    // Generation counter: each new poll thread captures a generation; it exits when the counter advances.
    pub poll_gen: Arc<AtomicU64>,
}

impl Default for SlackManager {
    fn default() -> Self {
        Self {
            state: Mutex::new(SlackState::default()),
            store: Box::new(KeyringStore::new(SLACK_KEYCHAIN_SERVICE)),
            poll_gen: Arc::new(AtomicU64::new(0)),
        }
    }
}

// Shared HTTP agent with a hard per-request timeout: ureq's default has NO timeout, so a stalled
// socket (typical right after wake-from-sleep) would otherwise hang a refresh indefinitely.
fn http_agent() -> &'static ureq::Agent {
    static AGENT: std::sync::OnceLock<ureq::Agent> = std::sync::OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(15)).build())
}

// One authenticated GET to the Slack Web API; treats `ok:false` as an error.
// On a 429 (rate limited) Slack sends a Retry-After header; we wait once and retry, so a transient
// throttle becomes a brief pause instead of a dropped conversation + error banner.
pub fn api_get(token: &str, method: &str, params: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let build = || {
        let mut req = http_agent()
            .get(&format!("https://slack.com/api/{method}"))
            .set("Authorization", &format!("Bearer {token}"));
        for (k, v) in params {
            req = req.query(k, v);
        }
        req
    };
    let resp = match build().call() {
        Ok(r) => r,
        // ureq surfaces non-2xx as Error::Status; honor Retry-After on 429 and retry once.
        Err(ureq::Error::Status(429, r)) => {
            let wait = r.header("Retry-After").and_then(|s| s.parse::<u64>().ok()).unwrap_or(1).min(30);
            std::thread::sleep(std::time::Duration::from_secs(wait));
            build().call().map_err(|e| e.to_string())?
        }
        Err(e) => return Err(e.to_string()),
    };
    let resp: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    if resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(resp)
    } else {
        Err(resp.get("error").and_then(|v| v.as_str()).unwrap_or("slack api error").to_string())
    }
}

// Exchange an OAuth code for the user token; returns (user_token, user_name-ish display).
pub fn exchange_code(client_id: &str, client_secret: &str, code: &str, redirect_uri: &str) -> Result<(String, String), String> {
    let resp: serde_json::Value = http_agent()
        .post("https://slack.com/api/oauth.v2.access")
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

use tauri::{AppHandle, Emitter, Manager, State};
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

// NOTE: plain (non-async) tauri commands run INLINE ON THE MACOS MAIN THREAD (webview IPC →
// WKURLSchemeHandler → command body), so any blocking work beachballs the whole app. Every
// command below that touches the network, the Keychain, or a subprocess is `(async)` — Tauri
// then runs it on the tokio pool instead. Memory-only commands (e.g. slack_snapshot) stay sync.

// Store client_id in session state; persist client_secret to Keychain when provided.
#[tauri::command(async)]
pub fn slack_set_credentials(manager: State<SlackManager>, client_id: String, client_secret: Option<String>) -> Result<(), String> {
    if let Some(secret) = client_secret.filter(|s| !s.is_empty()) {
        manager.store.set(ACCOUNT_SECRET, &secret)?;
    }
    manager.state.lock().unwrap().client_id = Some(client_id);
    Ok(())
}

// Update the watched set and immediately re-poll so the tile reflects the new selection.
#[tauri::command(async)]
pub fn slack_set_watched(app: AppHandle, manager: State<SlackManager>, ids: Vec<String>) -> Result<(), String> {
    manager.state.lock().unwrap().watched = ids;
    refresh_now(&app, &manager);
    Ok(())
}

#[tauri::command(async)]
pub fn slack_status(manager: State<SlackManager>) -> SlackStatus {
    let st = manager.state.lock().unwrap();
    let has_credentials = st.client_id.is_some() && manager.store.get(ACCOUNT_SECRET).ok().flatten().is_some();
    SlackStatus { connected: st.connected, user_name: st.user_name.clone(), has_credentials }
}

#[tauri::command]
pub fn slack_snapshot(manager: State<SlackManager>) -> SlackSnapshot {
    manager.state.lock().unwrap().last.clone()
}

// Build a picker row from a users.conversations list object. Pure so it's unit-testable. For a 1:1
// DM the list gives the partner `user` id but no name; we resolve it from the cache (populated by
// polling) and otherwise fall back to a "@<user-id>" label — no per-DM network call at list time,
// so opening the picker never bursts. mpim/channel carry their own `name`.
pub fn list_row(c: &serde_json::Value, user_names: &HashMap<String, String>) -> Option<ConversationMeta> {
    let id = c.get("id").and_then(|v| v.as_str())?.to_string();
    let raw = if c.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false) {
        "im"
    } else if c.get("is_mpim").and_then(|v| v.as_bool()).unwrap_or(false) {
        "mpim"
    } else {
        "channel"
    };
    let name = if raw == "im" {
        let uid = c.get("user").and_then(|v| v.as_str()).unwrap_or("");
        user_names.get(uid).cloned().unwrap_or_else(|| uid.to_string())
    } else {
        c.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string()
    };
    Some(ConversationMeta { id, name, kind: raw.to_string() })
}

// List the user's channels + DMs for the picker (all opt-in). One users.conversations call, no
// per-DM lookups — DM names come from the cache, filled in as selected DMs get polled.
#[tauri::command(async)]
pub fn slack_list_conversations(manager: State<SlackManager>) -> Result<Vec<ConversationMeta>, String> {
    let token = manager.store.get(ACCOUNT_TOKEN)?.ok_or("not connected")?;
    let resp = api_get(&token, "users.conversations", &[("types", "public_channel,private_channel,im,mpim"), ("limit", "200")])?;
    let names = manager.state.lock().unwrap().user_names.clone();
    let out = resp
        .get("channels")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|c| list_row(c, &names)).collect())
        .unwrap_or_default();
    Ok(out)
}

// Forget the token + secret, stop polling, and mark disconnected.
#[tauri::command(async)]
pub fn slack_disconnect(manager: State<SlackManager>) -> Result<(), String> {
    // Bump generation to signal any live poll thread to exit; no new thread is started.
    manager.poll_gen.fetch_add(1, Ordering::SeqCst);
    manager.store.delete(ACCOUNT_TOKEN).ok();
    let mut st = manager.state.lock().unwrap();
    st.connected = false;
    st.user_name = None;
    st.last = SlackSnapshot::default();
    Ok(())
}

// Start OAuth: bind a loopback callback server, return the authorize URL for the frontend to open.
#[tauri::command(async)]
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

// Resolve a user's display name via users.info; best-effort (falls back to the id upstream).
pub fn resolve_user_name(token: &str, user_id: &str) -> Option<String> {
    let resp = api_get(token, "users.info", &[("user", user_id)]).ok()?;
    let profile = resp.get("user").and_then(|u| u.get("profile"));
    profile
        .and_then(|p| p.get("display_name"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| profile.and_then(|p| p.get("real_name")).and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
        .or_else(|| resp.get("user").and_then(|u| u.get("name")).and_then(|v| v.as_str()))
        .map(|s| s.to_string())
}

// Force a one-shot poll (used by slack_refresh / slack_set_watched / on-focus).
// Polls only the user-selected conversations (channels + DMs) — a small, bounded set — so we never
// burst past Slack's rate limits. (DMs are opt-in in the picker, not auto-discovered.)
fn refresh_now(app: &AppHandle, manager: &SlackManager) {
    let token = match manager.store.get(ACCOUNT_TOKEN) { Ok(Some(t)) => t, _ => return };
    let watched = manager.state.lock().unwrap().watched.clone();
    // Clone the name cache out, poll (network) without holding the lock, then write the grown cache back.
    let mut names = manager.state.lock().unwrap().user_names.clone();
    let snap = poll_once(&token, &watched, &mut names);
    {
        let mut st = manager.state.lock().unwrap();
        st.last = snap.clone();
        st.user_names = names;
    }
    let _ = app.emit("slack://unread", snap);
}

#[tauri::command(async)]
pub fn slack_refresh(app: AppHandle, manager: State<SlackManager>) -> Result<(), String> {
    refresh_now(&app, &manager);
    Ok(())
}

// Poll each conversation: info (unread + name) + history (latest message). For 1:1 DMs, resolve the
// partner's display name via the `user_names` cache (users.info on a miss).
pub fn poll_once(token: &str, ids: &[String], user_names: &mut HashMap<String, String>) -> SlackSnapshot {
    let mut conversations = vec![];
    let mut error = None;
    for id in ids {
        let info = match api_get(token, "conversations.info", &[("channel", id)]) {
            Ok(v) => v.get("channel").cloned().unwrap_or(serde_json::Value::Null),
            Err(e) => { error = Some(e); continue; }
        };
        // Fetch history strictly newer than last_read (oldest=last_read, inclusive=false by default).
        // This returns *exactly* the unread messages regardless of how old they are — so a message
        // marked unread far back in the DM is caught, which a fixed recent window would miss.
        let last_read = info.get("last_read").and_then(|v| v.as_str()).unwrap_or("0");
        let messages = api_get(token, "conversations.history", &[("channel", id), ("oldest", last_read), ("limit", "200")])
            .ok()
            .and_then(|v| v.get("messages").and_then(|m| m.as_array()).cloned())
            .unwrap_or_default();
        // 1:1 DM: look up (and cache) the partner's display name so the row shows a person, not a U-id.
        let im_name = if info.get("is_im").and_then(|v| v.as_bool()).unwrap_or(false) {
            info.get("user").and_then(|v| v.as_str()).and_then(|uid| {
                if let Some(n) = user_names.get(uid) {
                    Some(n.clone())
                } else if let Some(n) = resolve_user_name(token, uid) {
                    user_names.insert(uid.to_string(), n.clone());
                    Some(n)
                } else {
                    None
                }
            })
        } else {
            None
        };
        if let Some(row) = parse_conversation(&info, &messages, im_name.as_deref()) {
            if row.unread_count > 0 {
                conversations.push(row);
            }
        }
    }
    // Newest first by Slack ts (string compare is correct for fixed-width epoch.micros).
    conversations.sort_by(|a, b| b.latest_ts.cmp(&a.latest_ts));
    SlackSnapshot { connected: true, error, conversations }
}

// Background poll loop: every 30s. Each call mints a new generation; any prior poll thread sees the
// counter advance and exits, guaranteeing at most one active thread at a time.
pub fn start_polling(app: AppHandle) {
    let manager = app.state::<SlackManager>();
    let gen = manager.poll_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let poll_gen = manager.poll_gen.clone();
    std::thread::spawn(move || {
        loop {
            if poll_gen.load(Ordering::SeqCst) != gen { return; }
            let manager = app.state::<SlackManager>();
            refresh_now(&app, &manager);
            for _ in 0..30 {
                if poll_gen.load(Ordering::SeqCst) != gen { return; }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    });
}

// Hydrate the provider from persisted config at startup; start polling if a token already exists.
#[tauri::command(async)]
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
    fn parse_callback_handles_real_request_url() {
        // tiny_http's req.url() is the full path+query, not a bare query string.
        assert_eq!(
            parse_callback_code("/callback?code=13566.abc.def&state=").unwrap(),
            "13566.abc.def"
        );
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
    fn parse_conversation_counts_unread_after_last_read() {
        // 3 messages, last_read sits before all of them → all 3 unread; newest drives the preview.
        let info = json!({ "id": "C1", "name": "incidents", "last_read": "1700000000.000000" });
        let messages = vec![
            json!({ "text": "deploy blocked", "ts": "1700000000.000300" }),
            json!({ "text": "still red",      "ts": "1700000000.000200" }),
            json!({ "text": "who's on call",  "ts": "1700000000.000100" }),
        ];
        let row = parse_conversation(&info, &messages, None).unwrap();
        assert_eq!(row.id, "C1");
        assert_eq!(row.kind, "channel");
        assert_eq!(row.name, "incidents");
        assert_eq!(row.unread_count, 3);
        assert_eq!(row.latest_text, "deploy blocked");
        assert_eq!(row.latest_ts, "1700000000.000300");
    }

    #[test]
    fn parse_conversation_read_channel_has_zero_unread() {
        // last_read equals the newest ts → nothing strictly newer → 0 unread (row gets filtered out upstream).
        let info = json!({ "id": "C2", "name": "product", "last_read": "1700000000.000300" });
        let messages = vec![
            json!({ "text": "latest", "ts": "1700000000.000300" }),
            json!({ "text": "older",  "ts": "1700000000.000200" }),
        ];
        let row = parse_conversation(&info, &messages, None).unwrap();
        assert_eq!(row.unread_count, 0);
    }

    #[test]
    fn parse_conversation_partial_unread() {
        // last_read between messages → only the newer ones count.
        let info = json!({ "id": "C3", "last_read": "1700000000.000200" });
        let messages = vec![
            json!({ "text": "new",   "ts": "1700000000.000400" }),
            json!({ "text": "new2",  "ts": "1700000000.000300" }),
            json!({ "text": "read",  "ts": "1700000000.000200" }),
            json!({ "text": "old",   "ts": "1700000000.000100" }),
        ];
        assert_eq!(parse_conversation(&info, &messages, None).unwrap().unread_count, 2);
    }

    #[test]
    fn parse_conversation_marks_im_kind() {
        let info = json!({ "id": "D9", "is_im": true, "last_read": "1700000000.000000" });
        let messages = vec![json!({ "text": "hi", "ts": "1700000000.000200" })];
        let row = parse_conversation(&info, &messages, None).unwrap();
        assert_eq!(row.kind, "im");
        assert_eq!(row.name, "D9"); // no resolved name → falls back to id
        assert_eq!(row.unread_count, 1);
    }

    #[test]
    fn parse_conversation_uses_resolved_im_name() {
        // A 1:1 DM with a resolved partner name shows the person, not the D-id.
        let info = json!({ "id": "D9", "is_im": true, "user": "U123", "last_read": "1700000000.000000" });
        let messages = vec![json!({ "text": "hi", "ts": "1700000000.000200" })];
        let row = parse_conversation(&info, &messages, Some("Alice")).unwrap();
        assert_eq!(row.kind, "im");
        assert_eq!(row.name, "Alice");
    }

    #[test]
    fn list_row_names_channels_and_dms() {
        let names: HashMap<String, String> = [("U1".to_string(), "Alice".to_string())].into_iter().collect();
        // channel → own name
        let ch = json!({ "id": "C1", "name": "general" });
        let r = list_row(&ch, &names).unwrap();
        assert_eq!((r.kind.as_str(), r.name.as_str()), ("channel", "general"));
        // 1:1 DM with a cached partner name → shows the person
        let im = json!({ "id": "D1", "is_im": true, "user": "U1" });
        let r = list_row(&im, &names).unwrap();
        assert_eq!((r.kind.as_str(), r.name.as_str()), ("im", "Alice"));
        // 1:1 DM without a cached name → falls back to the user id
        let im2 = json!({ "id": "D2", "is_im": true, "user": "U9" });
        assert_eq!(list_row(&im2, &names).unwrap().name, "U9");
        // group DM → carries its own synthetic name
        let mp = json!({ "id": "G1", "is_mpim": true, "name": "mpdm-a--b-1" });
        let r = list_row(&mp, &names).unwrap();
        assert_eq!((r.kind.as_str(), r.name.as_str()), ("mpim", "mpdm-a--b-1"));
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
        let info = json!({ "id": "G7", "is_mpim": true, "last_read": "1700000000.000000" });
        let messages = vec![json!({ "text": "x", "ts": "1700000000.000300" })];
        let row = parse_conversation(&info, &messages, None).unwrap();
        assert_eq!(row.kind, "mpim");
    }

}
