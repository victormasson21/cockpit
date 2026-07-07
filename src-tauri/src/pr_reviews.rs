//! pr_reviews.rs — PR Reviews tile provider: one-shot fetch of new PR-request messages from a Slack
//! channel (since a persisted cursor), turning each PR link into a render-ready item.

use crate::github::{parse_github_url, run_gh_timeout, GithubKind, GithubRef};
use crate::settings::PrReviewItem;
use crate::slack::{api_get, resolve_user_name, SlackManager, ACCOUNT_TOKEN};
use serde::Serialize;
use tauri::State;

// What one refresh returns: new items (newest first, matching Slack's history order) + the next cursor.
#[derive(Debug, Clone, Serialize)]
pub struct PrFetchResult {
    pub items: Vec<PrReviewItem>,
    #[serde(rename = "newestTs", skip_serializing_if = "Option::is_none")]
    pub newest_ts: Option<String>,
}

// One-shot fetch of channel messages since the cursor. No cursor yet ("start empty" first refresh):
// just report the newest message ts so the frontend can seed the cursor — no parsing, no gh calls.
#[tauri::command]
pub fn pr_reviews_fetch(
    manager: State<SlackManager>,
    channel_id: String,
    oldest: Option<String>,
) -> Result<PrFetchResult, String> {
    let token = manager.store.get(ACCOUNT_TOKEN).map_err(|e| e.to_string())?.ok_or("Slack not connected")?;
    let Some(cursor) = oldest else {
        let resp = api_get(&token, "conversations.history", &[("channel", &channel_id), ("limit", "1")])?;
        let messages = resp.get("messages").and_then(|m| m.as_array()).cloned().unwrap_or_default();
        // Empty channel: seed at "0" so the channel's first-ever message still counts next refresh.
        return Ok(PrFetchResult { items: vec![], newest_ts: newest_ts(&messages).or_else(|| Some("0".into())) });
    };
    let messages = fetch_history_since(&token, &channel_id, &cursor)?;
    // Clone the name cache out, do all network work without holding the lock, write the grown cache back.
    let mut names = manager.state.lock().unwrap().user_names.clone();
    let items: Vec<PrReviewItem> = messages
        .iter()
        .filter_map(|m| {
            build_item(m, |pr| fetch_pr_title(pr), |uid| {
                if let Some(n) = names.get(uid) {
                    return Some(n.clone());
                }
                let n = resolve_user_name(&token, uid)?;
                names.insert(uid.to_string(), n.clone());
                Some(n)
            })
        })
        .collect();
    // extend(), not replace: the 30s poll thread may have cached names while we were on the network.
    manager.state.lock().unwrap().user_names.extend(names);
    Ok(PrFetchResult { items, newest_ts: newest_ts(&messages) })
}

// Slack pages history at `limit` per call; follow response_metadata.next_cursor (bounded) so a big
// backlog (> one page since the cursor) isn't silently dropped while the cursor jumps past it.
const MAX_HISTORY_PAGES: usize = 5;
fn fetch_history_since(token: &str, channel_id: &str, oldest: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut messages: Vec<serde_json::Value> = vec![];
    let mut cursor = String::new();
    for _ in 0..MAX_HISTORY_PAGES {
        let mut params: Vec<(&str, &str)> = vec![("channel", channel_id), ("oldest", oldest), ("limit", "200")];
        if !cursor.is_empty() {
            params.push(("cursor", &cursor));
        }
        let resp = api_get(token, "conversations.history", &params)?;
        if let Some(arr) = resp.get("messages").and_then(|m| m.as_array()) {
            messages.extend(arr.iter().cloned());
        }
        let next = resp
            .get("response_metadata")
            .and_then(|r| r.get("next_cursor"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        if next.is_empty() {
            break;
        }
        cursor = next;
    }
    Ok(messages)
}

// Exact PR title via the gh CLI; None (→ fallback_title) when gh can't see the repo / isn't set up.
// Short timeout: enrichment is best-effort and runs once per new PR — don't let a hang stall refresh.
fn fetch_pr_title(pr: &PrRef) -> Option<String> {
    let args = pr_title_args(&pr.owner, &pr.repo, pr.number);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    parse_title(&run_gh_timeout(&refs, std::time::Duration::from_secs(10)).ok()?)
}

// A PR link found in a Slack message; label is the mrkdwn <url|label> text when present.
#[derive(Debug, Clone, PartialEq)]
pub struct PrRef {
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub label: Option<String>,
}

// Find the first GitHub PR link in a message. Slack mrkdwn <url|label> segments are scanned first
// (labels may contain spaces, so they can't be token-split), then plain whitespace tokens.
pub fn extract_pr_ref(text: &str) -> Option<PrRef> {
    // Angle-bracket segments: <url>, <url|label>, and non-link tokens like <@U123> (skipped).
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        let seg = &rest[start + 1..];
        let Some(end) = seg.find('>') else { break };
        let inner = &seg[..end];
        let (url, label) = match inner.split_once('|') {
            Some((u, l)) => (u, Some(l.trim()).filter(|s| !s.is_empty())),
            None => (inner, None),
        };
        if let Some(r) = parse_pr_url(url) {
            return Some(PrRef { label: label.map(str::to_string), ..r });
        }
        rest = &seg[end + 1..];
    }
    // Plain URL pasted without mrkdwn; trim surrounding paste punctuation.
    text.split_whitespace()
        .map(|t| t.trim_matches(|c: char| "(),.".contains(c)))
        .find_map(parse_pr_url)
}

// Parse one URL-ish string as a PR (issues and other GitHub URLs don't qualify).
fn parse_pr_url(s: &str) -> Option<PrRef> {
    match parse_github_url(s)? {
        GithubRef { kind: GithubKind::Pr, owner, repo, number } => Some(PrRef { owner, repo, number, label: None }),
        _ => None,
    }
}

// Find a standalone SHIP/SHOW/ASK marker (uppercase only — the channel convention — so prose like
// "can you show me" doesn't badge; *bold*/[brackets]/punctuation around the token are tolerated).
pub fn extract_mode(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|t| {
        let w = t.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        ["SHIP", "SHOW", "ASK"].iter().find(|m| w == **m).map(|m| m.to_string())
    })
}

// Max ts across all fetched messages (chatter included) — the next cursor. Fixed-width epoch.micros
// strings compare lexicographically.
pub fn newest_ts(messages: &[serde_json::Value]) -> Option<String> {
    messages.iter().filter_map(|m| m.get("ts").and_then(|v| v.as_str())).max().map(str::to_string)
}

// Title when gh can't supply one: mrkdwn label → message text minus links → "repo#N".
pub fn fallback_title(label: Option<&str>, text: &str, repo: &str, number: u64) -> String {
    if let Some(l) = label.map(str::trim).filter(|l| !l.is_empty()) {
        return l.to_string();
    }
    let stripped = strip_links(text);
    if !stripped.is_empty() {
        return stripped;
    }
    format!("{repo}#{number}")
}

// Drop <...> segments and bare github.com tokens from the text; collapse whitespace.
fn strip_links(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    // Remove angle-bracket segments wholesale (they're links/mentions, not prose).
    while let Some(start) = rest.find('<') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else { break };
        out.push_str(&rest[..start]);
        out.push(' ');
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out.split_whitespace().filter(|t| !t.contains("github.com/")).collect::<Vec<_>>().join(" ")
}

// Read the title out of `gh pr view --json title` output; None on parse failure or empty title.
pub fn parse_title(stdout: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    v.get("title").and_then(|t| t.as_str()).filter(|s| !s.is_empty()).map(str::to_string)
}

// Turn one Slack message into an item, resolvers injected so this stays pure/testable:
// `fetch_title` = the gh title lookup, `resolve_author` = the users.info cache lookup.
// None when the message has no PR link or no ts.
pub fn build_item<FT, FA>(m: &serde_json::Value, mut fetch_title: FT, mut resolve_author: FA) -> Option<PrReviewItem>
where
    FT: FnMut(&PrRef) -> Option<String>,
    FA: FnMut(&str) -> Option<String>,
{
    let text = m.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let pr = extract_pr_ref(text)?;
    let ts = m.get("ts").and_then(|v| v.as_str())?.to_string();
    // Human posts carry `user` (resolve, falling back to the raw id); bot posts carry `username`.
    let author = m
        .get("user")
        .and_then(|v| v.as_str())
        .map(|uid| resolve_author(uid).unwrap_or_else(|| uid.to_string()))
        .or_else(|| m.get("username").and_then(|v| v.as_str()).map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string());
    let title = fetch_title(&pr).unwrap_or_else(|| fallback_title(pr.label.as_deref(), text, &pr.repo, pr.number));
    Some(PrReviewItem {
        id: ts.clone(),
        url: format!("https://github.com/{}/{}/pull/{}", pr.owner, pr.repo, pr.number),
        repo: pr.repo.clone(),
        number: pr.number,
        title,
        author,
        ts,
        mode: extract_mode(text),
    })
}

// Args for `gh pr view` fetching just the title.
pub fn pr_title_args(owner: &str, repo: &str, number: u64) -> Vec<String> {
    vec![
        "pr".into(),
        "view".into(),
        number.to_string(),
        "--repo".into(),
        format!("{owner}/{repo}"),
        "--json".into(),
        "title".into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_pr_ref_finds_plain_url_in_prose() {
        let r = extract_pr_ref("please review https://github.com/acme/web-app/pull/4821 thanks").unwrap();
        assert_eq!((r.owner.as_str(), r.repo.as_str(), r.number), ("acme", "web-app", 4821));
        assert_eq!(r.label, None);
    }

    #[test]
    fn extract_pr_ref_reads_slack_mrkdwn_link_with_label() {
        // Slack wraps links as <url|label>; the label may contain spaces.
        let r = extract_pr_ref("SHIP <https://github.com/acme/api/pull/2204|Rate-limit the payments endpoint>").unwrap();
        assert_eq!((r.repo.as_str(), r.number), ("api", 2204));
        assert_eq!(r.label.as_deref(), Some("Rate-limit the payments endpoint"));
    }

    #[test]
    fn extract_pr_ref_reads_bare_mrkdwn_link_and_skips_mentions() {
        // <url> without a label, preceded by a user mention token that must be skipped.
        let r = extract_pr_ref("<@U123> take <https://github.com/acme/api/pull/9>?").unwrap();
        assert_eq!(r.number, 9);
        assert_eq!(r.label, None);
    }

    #[test]
    fn extract_pr_ref_tolerates_query_and_paste_punctuation() {
        assert_eq!(extract_pr_ref("(https://github.com/a/b/pull/123/files?w=1)").unwrap().number, 123);
    }

    #[test]
    fn extract_pr_ref_ignores_issues_and_plain_text() {
        assert!(extract_pr_ref("https://github.com/a/b/issues/7").is_none());
        assert!(extract_pr_ref("no links here").is_none());
    }

    #[test]
    fn extract_mode_matches_standalone_uppercase_ship_show_ask_tokens() {
        assert_eq!(extract_mode("SHIP: tiny fix").as_deref(), Some("SHIP"));
        assert_eq!(extract_mode("*SHOW* please").as_deref(), Some("SHOW")); // slack bold tolerated
        assert_eq!(extract_mode("[ASK] big refactor").as_deref(), Some("ASK"));
        assert_eq!(extract_mode("we are shipping this"), None); // embedded in a word
        assert_eq!(extract_mode("can you show me the diff and ask around"), None); // prose, not a marker
        assert_eq!(extract_mode("plain request"), None);
    }

    #[test]
    fn newest_ts_picks_the_max_across_all_messages() {
        let msgs = vec![json!({"ts": "1751.000200"}), json!({"ts": "1751.000900"}), json!({"text": "no ts"})];
        assert_eq!(newest_ts(&msgs).as_deref(), Some("1751.000900"));
        assert_eq!(newest_ts(&[]), None);
    }

    #[test]
    fn fallback_title_prefers_label_then_text_minus_links_then_ref() {
        assert_eq!(fallback_title(Some("From label"), "ignored", "web-app", 1), "From label");
        assert_eq!(
            fallback_title(None, "SHIP fix rounding <https://github.com/a/web-app/pull/2>", "web-app", 2),
            "SHIP fix rounding"
        );
        assert_eq!(fallback_title(None, "https://github.com/a/web-app/pull/3", "web-app", 3), "web-app#3");
    }

    #[test]
    fn parse_title_reads_gh_json_output() {
        assert_eq!(parse_title(r#"{"title":"Fix cart total rounding error"}"#).as_deref(), Some("Fix cart total rounding error"));
        assert_eq!(parse_title("not json"), None);
        assert_eq!(parse_title(r#"{"title":""}"#), None);
    }

    #[test]
    fn build_item_resolves_title_author_and_mode() {
        let m = json!({
            "ts": "1751.000200",
            "user": "U1",
            "text": "SHIP <https://github.com/acme/web-app/pull/4821|checkout fix>"
        });
        let item = build_item(&m, |_| Some("Add idempotency key to checkout".into()), |uid| {
            assert_eq!(uid, "U1");
            Some("Priya Shah".into())
        })
        .unwrap();
        assert_eq!(item.id, "1751.000200");
        assert_eq!(item.url, "https://github.com/acme/web-app/pull/4821");
        assert_eq!((item.repo.as_str(), item.number), ("web-app", 4821));
        assert_eq!(item.title, "Add idempotency key to checkout");
        assert_eq!(item.author, "Priya Shah");
        assert_eq!(item.mode.as_deref(), Some("SHIP"));
    }

    #[test]
    fn build_item_falls_back_gracefully() {
        // gh title fails → mrkdwn label; unresolvable user → raw id; bot messages use `username`.
        let m = json!({ "ts": "1.2", "user": "U9", "text": "<https://github.com/a/b/pull/7|label title>" });
        let item = build_item(&m, |_| None, |_| None).unwrap();
        assert_eq!(item.title, "label title");
        assert_eq!(item.author, "U9");
        assert_eq!(item.mode, None);
        let bot = json!({ "ts": "1.3", "username": "github-bot", "text": "https://github.com/a/b/pull/8" });
        assert_eq!(build_item(&bot, |_| None, |_| None).unwrap().author, "github-bot");
        // No PR link → no item; missing ts → no item.
        assert!(build_item(&json!({"ts": "1.4", "text": "hello"}), |_| None, |_| None).is_none());
        assert!(build_item(&json!({"text": "https://github.com/a/b/pull/9"}), |_| None, |_| None).is_none());
    }

    #[test]
    fn pr_title_args_builds_the_gh_invocation() {
        assert_eq!(
            pr_title_args("acme", "web-app", 4821),
            vec!["pr", "view", "4821", "--repo", "acme/web-app", "--json", "title"]
        );
    }
}
