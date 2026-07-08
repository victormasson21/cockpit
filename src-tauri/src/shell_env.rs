//! shell_env.rs — GUI-launch PATH fix: merge the user's login-shell PATH into the process PATH so spawned CLIs (claude, gh) resolve.
//! macOS gives GUI-launched apps the minimal launchd PATH (/usr/bin:/bin:/usr/sbin:/sbin); the user's real PATH lives in shell profiles.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

// Sentinel marks the PATH line in the shell output — profiles may echo other lines (motd, version managers).
const SENTINEL: &str = "__COCKPIT_PATH__";
// Interactive profiles can be slow (nvm, plugins); a hung one must never block app startup.
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

// Best-effort: ask the user's shell for its PATH and append entries we're missing. Never fails the app.
pub fn fix_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    // `-ilc` = interactive + login: user PATH additions commonly live in .zshrc (verified here:
    // ~/.local/bin, where claude lives), which login NON-interactive shells skip. stdin is null so
    // an interactive profile can't wait on input.
    let Ok(mut child) = Command::new(&shell)
        .args(["-ilc", &format!("echo {SENTINEL}$PATH")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return; // keep the inherited PATH on any failure
    };
    match child.wait_timeout(SHELL_TIMEOUT) {
        Ok(Some(status)) if status.success() => {}
        Ok(None) => {
            let _ = child.kill();
            return;
        }
        _ => return,
    }
    let mut stdout = String::new();
    if let Some(mut so) = child.stdout.take() {
        let _ = so.read_to_string(&mut stdout);
    }
    if let Some(login) = extract_login_path(&stdout) {
        let current = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", merge_paths(&current, login));
    }
}

// Pull the sentinel-marked PATH out of the shell output (last occurrence wins if profiles echo noise).
fn extract_login_path(stdout: &str) -> Option<&str> {
    stdout
        .lines()
        .rev()
        .find_map(|l| l.trim().strip_prefix(SENTINEL))
        .filter(|p| !p.is_empty())
}

// Append login-PATH entries missing from current — preserves the launch context's order/priority, only adds.
fn merge_paths(current: &str, login: &str) -> String {
    let mut entries: Vec<&str> = current.split(':').filter(|e| !e.is_empty()).collect();
    for e in login.split(':').filter(|e| !e.is_empty()) {
        if !entries.contains(&e) {
            entries.push(e);
        }
    }
    entries.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_sentinel_line_ignoring_profile_noise() {
        let out = "welcome banner\n__COCKPIT_PATH__/usr/bin:/opt/homebrew/bin\n";
        assert_eq!(
            extract_login_path(out),
            Some("/usr/bin:/opt/homebrew/bin")
        );
    }

    #[test]
    fn extract_returns_none_without_sentinel_or_when_empty() {
        assert_eq!(extract_login_path("no sentinel here\n"), None);
        assert_eq!(extract_login_path("__COCKPIT_PATH__\n"), None);
    }

    #[test]
    fn merge_appends_missing_entries_only() {
        assert_eq!(
            merge_paths("/usr/bin:/bin", "/usr/bin:/Users/v/.local/bin"),
            "/usr/bin:/bin:/Users/v/.local/bin"
        );
    }

    // Manual smoke (env-mutating + depends on this machine's shell profile):
    // `cargo test --lib -- --ignored shell_env`. Simulates a GUI launch's minimal PATH.
    #[test]
    #[ignore]
    fn fix_path_recovers_login_shell_entries() {
        std::env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        fix_path();
        let path = std::env::var("PATH").unwrap();
        assert!(
            path.split(':').any(|e| e.ends_with(".local/bin")),
            "PATH after fix: {path}"
        );
    }

    #[test]
    fn merge_keeps_current_order_and_skips_empties() {
        assert_eq!(merge_paths("/a:/b", "/b::/a"), "/a:/b");
        assert_eq!(merge_paths("", "/x:/y"), "/x:/y");
    }
}
