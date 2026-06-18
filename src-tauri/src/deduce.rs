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
