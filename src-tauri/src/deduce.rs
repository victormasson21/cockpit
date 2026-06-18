//! deduce.rs — deduction provider: builds repo digests, shells out to the claude CLI (headless JSON), returns validated worktree params.
use serde::{Deserialize, Serialize};

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

// Guard against the model inventing a repo: repo_path must be one of the provided paths (spec §B.4: never silent).
pub fn validate_repo(d: DeducedWorktree, repo_paths: &[String]) -> Result<DeducedWorktree, String> {
    if repo_paths.iter().any(|p| p == &d.repo_path) {
        Ok(d)
    } else {
        Err(format!("agent chose a repo not in the known list: {}", d.repo_path))
    }
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
reason. Output only the structured object.";

// Inline JSON Schema enforcing the DeducedWorktree shape (claude --json-schema wants the schema inline).
const DEDUCE_SCHEMA: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"}},"required":["repoPath","name","branch","base","startCmd","address","reason"],"additionalProperties":false}"#;

const DEDUCE_TIMEOUT: Duration = Duration::from_secs(120); // CLI calls observed at 15-43s; generous ceiling.

// Build a compact JSON digest of one repo (basename + package.json fields + README snippet) for the agent to match against.
fn read_repo_digest(repo_path: &str) -> serde_json::Value {
    let dir = Path::new(repo_path);
    let basename = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let pkg = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    let (package_name, description, scripts) = package_fields(&pkg);
    let readme = std::fs::read_to_string(dir.join("README.md"))
        .or_else(|_| std::fs::read_to_string(dir.join("readme.md")))
        .unwrap_or_default();
    serde_json::json!({
        "path": repo_path,
        "basename": basename,
        "packageName": package_name,
        "description": description,
        "scripts": scripts,
        "readme": truncate(&readme, 800),
    })
}

// Shell out to the claude CLI in headless JSON mode (reuses Claude Code auth), with a hard timeout.
fn run_claude(user_prompt: &str) -> Result<String, String> {
    let mut child = Command::new("claude")
        .args([
            "-p", user_prompt,
            "--system-prompt", SYSTEM_PROMPT,
            "--output-format", "json",
            "--json-schema", DEDUCE_SCHEMA,
            "--model", "claude-haiku-4-5",
        ])
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
    let user = compose_user(&prompt, &digests);
    let stdout = run_claude(&user)?;
    let deduced = parse_envelope(&stdout)?;
    validate_repo(deduced, &repo_paths)
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
        };
        assert!(validate_repo(d.clone(), &["/a".into(), "/b".into()]).is_ok());
        assert!(validate_repo(d, &["/b".into()]).is_err());
    }
}
