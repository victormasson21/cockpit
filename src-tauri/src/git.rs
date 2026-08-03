//! git.rs — the one place that runs git. Every git invocation in the app goes through `run`, so the
//! cwd convention, the exit-status check and the stderr-to-String policy exist once instead of at
//! seventeen call sites. Sibling of `github.rs::run_gh`, `deduce.rs::run_claude` and
//! `slack.rs::api_get` — git was the only subprocess family without its runner.
use std::ffi::OsStr;
use std::process::Command;

// Run git in `dir` and return its stdout. Deliberate contract:
//   - stdout comes back UNTRIMMED, so a raw patch (worktree_file_diff) survives byte-for-byte.
//     Callers wanting a single value trim it themselves.
//   - Err carries git's TRIMMED stderr — that string is shown to the user verbatim.
//   - A non-zero exit is an Err, not a panic; callers that treat failure as data (a dirty-default, a
//     prune fallback, a main/master probe) use `.ok()` and branch on the Option.
// Args are generic exactly like Command::args, so both `["a", "b"]` and a `Vec<String>` from a pure
// arg-builder can be passed without conversion at the call site.
pub fn run<I, S>(dir: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// Drop the "origin/" that `symbolic-ref --short refs/remotes/origin/HEAD` prefixes onto the branch name.
pub fn strip_origin_prefix(s: &str) -> String {
    s.strip_prefix("origin/").unwrap_or(s).to_string()
}

// The repo's default branch (e.g. "main"), as one shared resolver — worktree.rs and deduce.rs each had
// their own, and they had drifted: only worktree.rs carried the main/master fallback.
//
// origin/HEAD is the real answer, but ONLY `git clone` creates that symref — a locally-init-ed repo
// never gets one (the cockpit repo itself was such a case). So fall back to the conventional names,
// requiring the remote-tracking ref to actually exist rather than guessing a name that doesn't.
pub fn default_branch(repo_path: &str) -> Option<String> {
    if let Ok(out) = run(repo_path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        let short = strip_origin_prefix(out.trim());
        if !short.is_empty() {
            return Some(short);
        }
    }
    ["main", "master"].into_iter().find(|name| {
        run(repo_path, ["show-ref", "--verify", "--quiet", &format!("refs/remotes/origin/{name}")]).is_ok()
    }).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scaffolding: a real repo, since the whole point of this module is that it shells out.
    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_str().unwrap();
        run(p, ["init", "-q"]).unwrap();
        run(p, ["config", "user.email", "t@example.com"]).unwrap();
        run(p, ["config", "user.name", "T"]).unwrap();
        std::fs::write(dir.path().join("f.txt"), "hi").unwrap();
        run(p, ["add", "."]).unwrap();
        run(p, ["commit", "-qm", "init"]).unwrap();
        dir
    }

    #[test]
    fn run_returns_stdout_on_success() {
        let repo = init_repo();
        let out = run(repo.path().to_str().unwrap(), ["rev-parse", "--abbrev-ref", "HEAD"]).unwrap();
        assert!(!out.trim().is_empty());
    }

    // Untrimmed on purpose: a raw patch must not be silently altered by the runner.
    #[test]
    fn run_does_not_trim_stdout() {
        let repo = init_repo();
        let out = run(repo.path().to_str().unwrap(), ["log", "--format=%s"]).unwrap();
        assert_eq!(out, "init\n");
    }

    #[test]
    fn run_returns_trimmed_stderr_on_failure() {
        let repo = init_repo();
        let err = run(repo.path().to_str().unwrap(), ["rev-parse", "--verify", "refs/heads/nope"]).unwrap_err();
        assert!(!err.is_empty());
        assert_eq!(err, err.trim(), "stderr should reach the UI already trimmed");
    }

    // A Vec<String> from a pure arg-builder must pass without conversion at the call site.
    #[test]
    fn run_accepts_owned_args() {
        let repo = init_repo();
        let args: Vec<String> = vec!["rev-parse".into(), "--is-inside-work-tree".into()];
        assert_eq!(run(repo.path().to_str().unwrap(), &args).unwrap().trim(), "true");
    }

    #[test]
    fn run_errors_when_the_dir_is_not_a_repo() {
        let dir = tempfile::tempdir().unwrap();
        assert!(run(dir.path().to_str().unwrap(), ["status", "--porcelain"]).is_err());
    }

    #[test]
    fn strip_origin_prefix_handles_origin_head() {
        assert_eq!(strip_origin_prefix("origin/master"), "master");
        assert_eq!(strip_origin_prefix("origin/main"), "main");
        assert_eq!(strip_origin_prefix("develop"), "develop"); // no prefix: unchanged
    }

    #[test]
    fn default_branch_prefers_the_origin_head_symref() {
        let repo = init_repo();
        let p = repo.path().to_str().unwrap();
        run(p, ["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        run(p, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]).unwrap();
        run(p, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]).unwrap();
        assert_eq!(default_branch(p).as_deref(), Some("trunk"));
    }

    // The fallback deduce.rs was missing before this module existed.
    #[test]
    fn default_branch_falls_back_to_origin_main_without_a_symref() {
        let repo = init_repo();
        let p = repo.path().to_str().unwrap();
        run(p, ["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        assert_eq!(default_branch(p).as_deref(), Some("main"));
    }

    #[test]
    fn default_branch_falls_back_to_origin_master() {
        let repo = init_repo();
        let p = repo.path().to_str().unwrap();
        run(p, ["update-ref", "refs/remotes/origin/master", "HEAD"]).unwrap();
        assert_eq!(default_branch(p).as_deref(), Some("master"));
    }

    // No remote refs at all: refuse to guess a name that doesn't exist.
    #[test]
    fn default_branch_is_none_without_any_origin_refs() {
        let repo = init_repo();
        assert_eq!(default_branch(repo.path().to_str().unwrap()), None);
    }
}
