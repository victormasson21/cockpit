//! deduce.rs — deduction provider: builds repo digests, shells out to the claude CLI (headless JSON), returns validated worktree params.
use serde::{Deserialize, Serialize};
use crate::github::{self, GithubContext, GithubRef};

// The deduced worktree parameters the agent returns; mirrors the TS DeducedWorktree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeducedWorktree {
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    pub name: String,
    pub branch: String,
    pub base: String,
    #[serde(rename = "startCmd")]
    pub start_cmd: String,
    pub address: String,
    pub reason: String,
    // Source-context fields: populated only on a source path; default so the plain path's JSON still deserializes.
    #[serde(rename = "sourceUrl", default)]
    pub source_url: String,
    #[serde(rename = "sourceTitle", default)]
    pub source_title: String,
    #[serde(rename = "sourceResolved", default)]
    pub source_resolved: bool,
    #[serde(rename = "existingBranch", default)]
    pub existing_branch: bool,
}

// Char-safe truncation so a long README snippet stays small without splitting a multibyte char.
pub fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

// Extract (name, description, scripts) from a package.json string, defaulting missing/invalid pieces.
pub fn package_fields(pkg_json: &str) -> (String, String, serde_json::Value) {
    let v: serde_json::Value = serde_json::from_str(pkg_json).unwrap_or(serde_json::Value::Null);
    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let description = v.get("description").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let scripts = v.get("scripts").cloned().unwrap_or_else(|| serde_json::json!({}));
    (name, description, scripts)
}

// Compose the user-prompt text: the task prompt plus the per-repo digests the agent picks from.
pub fn compose_user(prompt: &str, digests: &[serde_json::Value]) -> String {
    format!(
        "Task prompt: {prompt}\n\nKnown repos (digests, pick repoPath from these only):\n{}",
        serde_json::to_string_pretty(digests).unwrap_or_else(|_| "[]".into())
    )
}

// Parse the claude CLI JSON envelope: reject errors / empty output, then deserialize structured_output.
pub fn parse_envelope(stdout: &str) -> Result<DeducedWorktree, String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("couldn't parse deduction output: {e}"))?;
    if v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(true) {
        let msg = v.get("result").and_then(|r| r.as_str()).filter(|s| !s.is_empty()).unwrap_or("unknown error");
        return Err(format!("deduction failed: {msg}"));
    }
    let so = v.get("structured_output").cloned().unwrap_or(serde_json::Value::Null);
    if so.is_null() {
        return Err("deduction returned no structured output".into());
    }
    serde_json::from_value::<DeducedWorktree>(so)
        .map_err(|e| format!("deduction output didn't match schema: {e}"))
}

// Map the present lockfile to its package manager so the agent uses the right run command (npm is the default).
pub fn package_manager_from_lockfiles(has_pnpm: bool, has_yarn: bool, has_bun: bool) -> &'static str {
    if has_pnpm { "pnpm" } else if has_yarn { "yarn" } else if has_bun { "bun" } else { "npm" }
}

// Extract build.devUrl from a tauri.conf.json string — the real dev address for a Tauri app (vite's default is wrong for Tauri).
pub fn tauri_dev_url(conf_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(conf_json).ok()?;
    v.get("build")?.get("devUrl")?.as_str().map(|s| s.to_string())
}

// True if token is exactly a canonical Linear id: [A-Z][A-Z0-9]*-[0-9]+ (whole token, no trailing slug).
fn is_ticket_id(token: &str) -> bool {
    match token.split_once('-') {
        Some((team, num)) => {
            let mut tc = team.chars();
            tc.next().is_some_and(|c| c.is_ascii_uppercase())
                && team.chars().skip(1).all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && !num.is_empty()
                && num.chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

// Pull a leading id off the front of a URL slug segment (e.g. "ABC-42-fix-login" -> "ABC-42").
fn leading_ticket_id(s: &str) -> Option<String> {
    let dash = s.find('-')?;
    let team = &s[..dash];
    let mut tc = team.chars();
    if !tc.next()?.is_ascii_uppercase() || !team.chars().skip(1).all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return None;
    }
    let num: String = s[dash + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
    if num.is_empty() { None } else { Some(format!("{team}-{num}")) }
}

// Detect a Linear ticket ref in the prompt: a linear.app issue URL first, else a bare canonical id token. None for plain prompts.
pub fn detect_linear_ref(prompt: &str) -> Option<String> {
    // URL form: take the segment after "/issue/" and parse the id off its front.
    if let Some(base) = prompt.find("linear.app/") {
        if let Some(rel) = prompt[base..].find("/issue/") {
            let after = &prompt[base + rel + "/issue/".len()..];
            if let Some(id) = leading_ticket_id(after) {
                return Some(id);
            }
        }
    }
    // Bare id: scan tokens delimited by anything that isn't alphanumeric or '-'.
    prompt
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .find(|t| is_ticket_id(t))
        .map(|t| t.to_string())
}

// Guarantee the ticket id is present: unchanged if value already contains it (case-insensitive), else "{id}-{value}".
pub fn ensure_ref_prefix(value: &str, id: &str) -> String {
    if value.to_lowercase().contains(&id.to_lowercase()) {
        value.to_string()
    } else {
        format!("{id}-{value}")
    }
}

// Compose the ticket-path user prompt: the plain composition plus an instruction to fetch the ticket and include its id.
pub fn compose_user_ticket(prompt: &str, id: &str, digests: &[serde_json::Value]) -> String {
    format!(
        "{}\n\nA Linear ticket ({id}) was referenced; fetch it via the Linear MCP and use its title/description \
to choose the name and branch (include {id} in both), and set sourceUrl/sourceTitle/sourceResolved accordingly.",
        compose_user(prompt, digests)
    )
}

// The resolved kind of source the prompt references — one branch point for deduction.
enum Source {
    GitHub(GithubRef),
    Linear(String),
    Plain,
}

// Detect which source a prompt references: a GitHub URL wins, then a Linear ref, else plain.
fn detect_source(prompt: &str) -> Source {
    if let Some(r) = github::detect_github_ref(prompt) {
        Source::GitHub(r)
    } else if let Some(id) = detect_linear_ref(prompt) {
        Source::Linear(id)
    } else {
        Source::Plain
    }
}

// Compose the GitHub-path user prompt: the plain composition plus the fetched PR/issue context block.
pub fn compose_user_github(prompt: &str, ctx: &GithubContext, digests: &[serde_json::Value]) -> String {
    // For a PR, tell the agent the branch already exists (it won't be asked to invent one).
    let branch_note = match (&ctx.branch, &ctx.base) {
        (Some(h), Some(b)) => format!("\nThis is a PR on existing branch '{h}' targeting '{b}'."),
        _ => String::new(),
    };
    format!(
        "{}\n\nReferenced GitHub item:\nTitle: {}\nBody: {}{}\n\nUse the title/body to choose a short name (and, for an issue, a new branch).",
        compose_user(prompt, digests),
        ctx.title,
        truncate(&ctx.body, 800),
        branch_note
    )
}

// Apply the fields Rust knows authoritatively for a GitHub ref onto the agent's deduction.
pub fn apply_github_overrides(
    mut d: DeducedWorktree,
    r: &GithubRef,
    ctx: &GithubContext,
    repo_path: &str,
    base_default: Option<String>,
) -> DeducedWorktree {
    // Both kinds: the repo is known from the ref, and the link comes from gh (not the agent).
    d.repo_path = repo_path.to_string();
    d.source_url = ctx.url.clone();
    d.source_title = ctx.title.clone();
    d.source_resolved = true;
    match r.kind {
        github::GithubKind::Pr => {
            // PR: check out its existing branch (left untouched so it matches the remote); pin pr-<N> into the name only.
            d.existing_branch = true;
            if let Some(b) = &ctx.branch {
                d.branch = b.clone();
            }
            if let Some(b) = &ctx.base {
                d.base = b.clone();
            }
            d.name = ensure_ref_prefix(&d.name, &format!("pr-{}", r.number));
        }
        github::GithubKind::Issue => {
            // Issue: new branch off the git default; pin issue-<N> into both name and branch (Linear's shape).
            d.existing_branch = false;
            if let Some(b) = base_default {
                d.base = b;
            }
            let id = format!("issue-{}", r.number);
            d.branch = ensure_ref_prefix(&d.branch, &id);
            d.name = ensure_ref_prefix(&d.name, &id);
        }
    }
    d
}

// Guard against the model inventing a repo: repo_path must be one of the provided paths (spec §B.4: never silent).
pub fn validate_repo(d: DeducedWorktree, repo_paths: &[String]) -> Result<DeducedWorktree, String> {
    if repo_paths.iter().any(|p| p == &d.repo_path) {
        Ok(d)
    } else {
        Err(format!("agent chose a repo not in the known list: {}", d.repo_path))
    }
}

// "origin/master" -> "master" (pure); leaves an already-bare branch name unchanged.
pub fn strip_origin_prefix(s: &str) -> String {
    s.strip_prefix("origin/").unwrap_or(s).to_string()
}

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

// System prompt: keeps the agent a pure text->JSON deducer (no tools, single structured answer).
const SYSTEM_PROMPT: &str = "You deduce git worktree parameters from a task prompt. \
Choose repoPath from the provided repo digests ONLY (copy one of their paths exactly). \
Propose a short clear name, a new branch name, the base branch to cut from, and the dev-server \
start command and address inferred from that repo's package.json scripts / README. Give a one-line \
reason. Output only the structured object. \
Use the repo's packageManager for run commands (e.g. `npm run dev`, not another package manager). \
If isTauri is true, the start command is `<packageManager> run tauri dev` and the address is the provided devUrl; \
otherwise infer the dev script and its address from scripts/README.";

// Inline JSON Schema enforcing the DeducedWorktree shape (claude --json-schema wants the schema inline).
const DEDUCE_SCHEMA: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"}},"required":["repoPath","name","branch","base","startCmd","address","reason"],"additionalProperties":false}"#;

// Ticket-path system prompt: same deduction, but the agent may fetch the referenced Linear ticket via MCP and must report whether it did.
const SYSTEM_PROMPT_TICKET: &str = "You deduce git worktree parameters from a task prompt that references a Linear ticket. \
Fetch the referenced ticket via the Linear MCP and use its title/description to choose a short name and a new branch \
(include the ticket id in BOTH). Choose repoPath from the provided repo digests ONLY (copy one exactly). Also propose the \
base branch and the dev-server start command/address from that repo's scripts/README, with a one-line reason. \
Set sourceUrl and sourceTitle from the fetched ticket and sourceResolved=true. If you CANNOT fetch the ticket, set \
sourceResolved=false and leave sourceUrl/sourceTitle empty. Output only the structured object.";

// Ticket-path schema: the plain fields plus the source-context fields, all required.
const DEDUCE_SCHEMA_TICKET: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"sourceResolved":{"type":"boolean"}},"required":["repoPath","name","branch","base","startCmd","address","reason","sourceUrl","sourceTitle","sourceResolved"],"additionalProperties":false}"#;

// Pinned in Task 1's smoke test (Verified CLI facts). Starting guesses below.
const LINEAR_ALLOWED_TOOLS: &str = "mcp__linear";
const LINEAR_MODEL: &str = "claude-haiku-4-5";

const DEDUCE_TIMEOUT: Duration = Duration::from_secs(120); // CLI calls observed at 15-43s; generous ceiling.

// Build a compact JSON digest of one repo (basename + package.json fields + README snippet + package manager + Tauri signals) for the agent to match against.
fn read_repo_digest(repo_path: &str) -> serde_json::Value {
    let dir = Path::new(repo_path);
    let basename = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let pkg = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    let (package_name, description, scripts) = package_fields(&pkg);
    let readme = std::fs::read_to_string(dir.join("README.md"))
        .or_else(|_| std::fs::read_to_string(dir.join("readme.md")))
        .unwrap_or_default();
    // Detect package manager from lockfiles so the agent uses the right run command.
    let pm = package_manager_from_lockfiles(
        dir.join("pnpm-lock.yaml").exists(),
        dir.join("yarn.lock").exists(),
        dir.join("bun.lockb").exists(),
    );
    // Detect Tauri: read tauri.conf.json and extract devUrl if present.
    let tauri_conf_path = dir.join("src-tauri").join("tauri.conf.json");
    let is_tauri = tauri_conf_path.exists();
    let dev_url = if is_tauri {
        std::fs::read_to_string(&tauri_conf_path)
            .ok()
            .and_then(|s| tauri_dev_url(&s))
            .unwrap_or_default()
    } else {
        String::new()
    };
    serde_json::json!({
        "path": repo_path,
        "basename": basename,
        "packageName": package_name,
        "description": description,
        "scripts": scripts,
        "readme": truncate(&readme, 800),
        "packageManager": pm,
        "isTauri": is_tauri,
        "devUrl": dev_url,
    })
}

// Read the repo's default branch from git (origin/HEAD -> e.g. "master"); None when there is no remote/HEAD.
fn default_branch(repo_path: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(strip_origin_prefix(&s))
    }
}

// One headless claude invocation's knobs; lets the plain and ticket paths share the spawn/timeout logic.
struct ClaudeCall<'a> {
    user_prompt: &'a str,
    system_prompt: &'a str,
    schema: &'a str,
    model: &'a str,
    allowed_tools: Option<&'a str>, // Some(..) only on the ticket path, to enable the Linear MCP
}

// Shell out to the claude CLI in headless JSON mode (reuses Claude Code auth), with a hard timeout.
fn run_claude(call: ClaudeCall) -> Result<String, String> {
    let mut args: Vec<&str> = vec![
        "-p", call.user_prompt,
        "--system-prompt", call.system_prompt,
        "--output-format", "json",
        "--json-schema", call.schema,
        "--model", call.model,
    ];
    // Ticket path only: allow the Linear MCP tools so the agent can fetch the ticket non-interactively.
    if let Some(tools) = call.allowed_tools {
        args.push("--allowedTools");
        args.push(tools);
    }

    let mut child = Command::new("claude")
        .args(&args)
        .current_dir(std::env::temp_dir()) // neutral cwd: don't auto-load the project's CLAUDE.md
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("claude CLI not found: {e}"))?;

    match child.wait_timeout(DEDUCE_TIMEOUT).map_err(|e| e.to_string())? {
        None => {
            let _ = child.kill();
            Err("deduction timed out".into())
        }
        Some(status) => {
            // Output is a few KB (well under the pipe buffer), so reading after wait can't deadlock.
            let mut out = String::new();
            if let Some(mut so) = child.stdout.take() {
                let _ = so.read_to_string(&mut out);
            }
            if !status.success() && out.trim().is_empty() {
                let mut err = String::new();
                if let Some(mut se) = child.stderr.take() {
                    let _ = se.read_to_string(&mut err);
                }
                return Err(format!("claude exited with an error: {}", err.trim()));
            }
            Ok(out)
        }
    }
}

// Deduce worktree params from a prompt + the known-repos list; reads digests, calls the agent, validates the pick.
#[tauri::command]
pub fn deduce_worktree(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String> {
    if repo_paths.is_empty() {
        return Err("no known repos configured".into());
    }
    let digests: Vec<serde_json::Value> = repo_paths.iter().map(|p| read_repo_digest(p)).collect();
    let detected = detect_linear_ref(&prompt);

    // Ticket path: MCP-enabled call so the agent fetches the ticket. Plain path: byte-identical to before (no tools).
    let stdout = match &detected {
        Some(id) => run_claude(ClaudeCall {
            user_prompt: &compose_user_ticket(&prompt, id, &digests),
            system_prompt: SYSTEM_PROMPT_TICKET,
            schema: DEDUCE_SCHEMA_TICKET,
            model: LINEAR_MODEL,
            allowed_tools: Some(LINEAR_ALLOWED_TOOLS),
        })?,
        None => run_claude(ClaudeCall {
            user_prompt: &compose_user(&prompt, &digests),
            system_prompt: SYSTEM_PROMPT,
            schema: DEDUCE_SCHEMA,
            model: "claude-haiku-4-5",
            allowed_tools: None,
        })?,
    };

    let mut deduced = validate_repo(parse_envelope(&stdout)?, &repo_paths)?;
    // Base branch is deterministic from git; don't trust the agent's main/master guess.
    if let Some(b) = default_branch(&deduced.repo_path) {
        deduced.base = b;
    }
    // Ticket guardrails: never fabricate on an unresolved ticket; guarantee the id is in name + branch.
    if let Some(id) = &detected {
        if !deduced.source_resolved {
            return Err(format!("couldn't resolve Linear ticket {id} (is the Linear MCP connected?)"));
        }
        deduced.branch = ensure_ref_prefix(&deduced.branch, &id.to_lowercase());
        deduced.name = ensure_ref_prefix(&deduced.name, id);
    }
    Ok(deduced)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_is_char_safe_and_bounded() {
        assert_eq!(truncate("hello world", 5), "hello");
        assert_eq!(truncate("héllo", 2), "hé"); // does not split the multibyte char
        assert_eq!(truncate("hi", 99), "hi");
    }

    #[test]
    fn package_fields_extracts_and_defaults() {
        let (n, d, s) = package_fields(r#"{"name":"elder-api","description":"API","scripts":{"dev":"vite"}}"#);
        assert_eq!(n, "elder-api");
        assert_eq!(d, "API");
        assert_eq!(s["dev"], "vite");
        // Missing/invalid input degrades to empty defaults rather than panicking.
        let (n2, d2, s2) = package_fields("not json");
        assert_eq!(n2, "");
        assert_eq!(d2, "");
        assert_eq!(s2, serde_json::json!({}));
    }

    #[test]
    fn compose_user_includes_prompt_and_digests() {
        let digests = vec![serde_json::json!({"basename": "elder-api"})];
        let out = compose_user("fix login", &digests);
        assert!(out.contains("fix login"));
        assert!(out.contains("elder-api"));
    }

    #[test]
    fn parse_envelope_extracts_structured_output() {
        let env = r#"{"type":"result","subtype":"success","is_error":false,"result":"","structured_output":{"repoPath":"/r","name":"login","branch":"fix-login","base":"main","startCmd":"npm run dev","address":"http://localhost:5173","reason":"vite app"}}"#;
        let d = parse_envelope(env).unwrap();
        assert_eq!(d.repo_path, "/r");
        assert_eq!(d.start_cmd, "npm run dev");
    }

    #[test]
    fn parse_envelope_rejects_error_and_null() {
        let err = r#"{"is_error":true,"result":"boom","structured_output":null}"#;
        assert!(parse_envelope(err).is_err());
        let null_so = r#"{"is_error":false,"result":"","structured_output":null}"#;
        assert!(parse_envelope(null_so).is_err());
        assert!(parse_envelope("not json").is_err());
        // Missing is_error field is treated as an error (safe default: don't trust malformed envelopes).
        let no_flag = r#"{"structured_output":{"repoPath":"/r","name":"n","branch":"b","base":"main","startCmd":"c","address":"a","reason":"r"}}"#;
        assert!(parse_envelope(no_flag).is_err());
    }

    #[test]
    fn validate_repo_enforces_membership() {
        let d = DeducedWorktree {
            repo_path: "/a".into(), name: "n".into(), branch: "b".into(), base: "main".into(),
            start_cmd: "c".into(), address: "x".into(), reason: "r".into(),
            source_url: "".into(), source_title: "".into(), source_resolved: false, existing_branch: false,
        };
        assert!(validate_repo(d.clone(), &["/a".into(), "/b".into()]).is_ok());
        assert!(validate_repo(d, &["/b".into()]).is_err());
    }

    #[test]
    fn package_manager_defaults_to_npm_and_detects_others() {
        assert_eq!(package_manager_from_lockfiles(false, false, false), "npm");
        assert_eq!(package_manager_from_lockfiles(true, false, false), "pnpm");
        assert_eq!(package_manager_from_lockfiles(false, true, false), "yarn");
        assert_eq!(package_manager_from_lockfiles(false, false, true), "bun");
    }

    #[test]
    fn tauri_dev_url_extracts_build_dev_url() {
        let conf = r#"{"build":{"devUrl":"http://localhost:1420","beforeDevCommand":"npm run dev"}}"#;
        assert_eq!(tauri_dev_url(conf).as_deref(), Some("http://localhost:1420"));
        assert_eq!(tauri_dev_url(r#"{"build":{}}"#), None);
        assert_eq!(tauri_dev_url("not json"), None);
    }

    #[test]
    fn strip_origin_prefix_handles_origin_head() {
        assert_eq!(strip_origin_prefix("origin/master"), "master");
        assert_eq!(strip_origin_prefix("origin/main"), "main");
        assert_eq!(strip_origin_prefix("develop"), "develop"); // no prefix: unchanged
    }

    #[test]
    fn detect_linear_ref_matches_id_url_and_rejects_noise() {
        assert_eq!(detect_linear_ref("fix ENG-1234 please"), Some("ENG-1234".into())); // bare id in text
        assert_eq!(detect_linear_ref("ENG-1234, backend only"), Some("ENG-1234".into())); // mixed input
        assert_eq!(detect_linear_ref("see https://linear.app/acme/issue/ABC-42-fix-login now"),
                   Some("ABC-42".into())); // url form, id parsed out of the slug
        assert_eq!(detect_linear_ref("eng-1234"), None); // lowercase is not canonical
        assert_eq!(detect_linear_ref("fix the login bug"), None); // plain prompt
        assert_eq!(detect_linear_ref("v2-3 release"), None); // lowercase team -> not a ref
    }

    #[test]
    fn ensure_ref_prefix_adds_id_only_when_absent() {
        assert_eq!(ensure_ref_prefix("fix-login", "eng-1234"), "eng-1234-fix-login"); // absent -> prepended
        assert_eq!(ensure_ref_prefix("eng-1234-fix-login", "eng-1234"), "eng-1234-fix-login"); // present -> unchanged
        assert_eq!(ensure_ref_prefix("ENG-1234 fix login", "eng-1234"), "ENG-1234 fix login"); // case-insensitive match
    }

    #[test]
    fn compose_user_ticket_names_id_prompt_and_digests() {
        let digests = vec![serde_json::json!({"basename": "cockpit"})];
        let out = compose_user_ticket("do the thing", "ENG-1234", &digests);
        assert!(out.contains("do the thing"));
        assert!(out.contains("ENG-1234"));
        assert!(out.contains("cockpit"));
    }

    #[test]
    fn detect_source_picks_github_then_linear_then_plain() {
        assert!(matches!(detect_source("see github.com/a/b/pull/3"), Source::GitHub(_)));
        assert!(matches!(detect_source("fix ENG-1234 now"), Source::Linear(_)));
        assert!(matches!(detect_source("just a prompt"), Source::Plain));
    }

    #[test]
    fn compose_user_github_includes_prompt_context_and_digests() {
        let ctx = crate::github::GithubContext {
            title: "Fix login".into(), body: "the body".into(), url: "https://github.com/a/b/pull/9".into(),
            branch: Some("fix-login".into()), base: Some("main".into()),
        };
        let digests = vec![serde_json::json!({"basename": "cockpit"})];
        let out = compose_user_github("do the thing", &ctx, &digests);
        assert!(out.contains("do the thing"));
        assert!(out.contains("Fix login"));
        assert!(out.contains("the body"));
        assert!(out.contains("cockpit"));
        assert!(out.contains("fix-login")); // PR branch note included
    }

    #[test]
    fn apply_github_overrides_pr_uses_existing_branch_and_pins_name() {
        let d = DeducedWorktree {
            repo_path: "/wrong".into(), name: "login".into(), branch: "agent-branch".into(), base: "develop".into(),
            start_cmd: "c".into(), address: "a".into(), reason: "r".into(),
            source_url: "".into(), source_title: "".into(), source_resolved: false, existing_branch: false,
        };
        let r = crate::github::GithubRef { kind: crate::github::GithubKind::Pr, owner: "a".into(), repo: "b".into(), number: 9 };
        let ctx = crate::github::GithubContext {
            title: "Fix login".into(), body: "".into(), url: "https://github.com/a/b/pull/9".into(),
            branch: Some("feat/login".into()), base: Some("main".into()),
        };
        let out = apply_github_overrides(d, &r, &ctx, "/p/b", Some("ignored".into()));
        assert_eq!(out.repo_path, "/p/b");          // repo overridden deterministically
        assert!(out.existing_branch);                // PR -> existing branch
        assert_eq!(out.branch, "feat/login");        // the PR's real branch, untouched
        assert_eq!(out.base, "main");                // the PR's base
        assert_eq!(out.name, "pr-9-login");          // pr-<N> pinned into the name
        assert_eq!(out.source_url, "https://github.com/a/b/pull/9");
        assert_eq!(out.source_title, "Fix login");
        assert!(out.source_resolved);
    }

    #[test]
    fn apply_github_overrides_issue_makes_new_branch_with_id() {
        let d = DeducedWorktree {
            repo_path: "/wrong".into(), name: "login".into(), branch: "fix-login".into(), base: "develop".into(),
            start_cmd: "c".into(), address: "a".into(), reason: "r".into(),
            source_url: "".into(), source_title: "".into(), source_resolved: false, existing_branch: true,
        };
        let r = crate::github::GithubRef { kind: crate::github::GithubKind::Issue, owner: "a".into(), repo: "b".into(), number: 7 };
        let ctx = crate::github::GithubContext {
            title: "Login bug".into(), body: "".into(), url: "https://github.com/a/b/issues/7".into(),
            branch: None, base: None,
        };
        let out = apply_github_overrides(d, &r, &ctx, "/p/b", Some("trunk".into()));
        assert!(!out.existing_branch);               // issue -> new branch
        assert_eq!(out.base, "trunk");               // base from git default
        assert_eq!(out.branch, "issue-7-fix-login"); // issue-<N> pinned into branch
        assert_eq!(out.name, "issue-7-login");       // issue-<N> pinned into name
    }

    #[test]
    fn parse_envelope_reads_source_fields_and_defaults_them() {
        let with = r#"{"is_error":false,"result":"","structured_output":{"repoPath":"/r","name":"n","branch":"b","base":"main","startCmd":"c","address":"a","reason":"r","sourceUrl":"https://linear.app/x","sourceTitle":"Fix login","sourceResolved":true}}"#;
        let d = parse_envelope(with).unwrap();
        assert_eq!(d.source_url, "https://linear.app/x");
        assert!(d.source_resolved);
        // Plain-path envelope (no source fields) still parses, with defaults.
        let without = r#"{"is_error":false,"result":"","structured_output":{"repoPath":"/r","name":"n","branch":"b","base":"main","startCmd":"c","address":"a","reason":"r"}}"#;
        let d2 = parse_envelope(without).unwrap();
        assert_eq!(d2.source_url, "");
        assert!(!d2.source_resolved);
    }
}
