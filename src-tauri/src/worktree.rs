//! worktree.rs — git-worktree provider: derives a managed path and runs `git worktree add` for a new or existing branch.
use std::path::{Path, PathBuf};
use std::process::Command;

// Existing branch checkout vs. a new branch cut from a base. Deserialized from the frontend's tagged JSON.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BranchSpec {
    Existing { branch: String },
    New { branch: String, base: String },
    // GitHub PR: make a detached worktree, then `gh pr checkout <number>` inside it; `branch` (the PR's
    // headRefName) names the local branch on the merged/deleted-branch fallback (handles fork PRs too).
    Pr { number: u64, branch: String },
}

// Lowercase dash-separated slug so a worktree name maps to a safe directory name.
pub fn slug(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

// Managed location: ~/CockpitWorktrees/<repo-basename>/<slug>.
pub fn managed_path(home: &Path, repo_path: &str, name: &str) -> PathBuf {
    let repo_base = Path::new(repo_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".into());
    home.join("CockpitWorktrees").join(repo_base).join(slug(name))
}

// Build the `git worktree add` argv for a branch spec (pure; tested without invoking git).
pub fn worktree_add_args(worktree_path: &str, spec: &BranchSpec) -> Vec<String> {
    match spec {
        BranchSpec::Existing { branch } => {
            vec!["worktree".into(), "add".into(), worktree_path.into(), branch.clone()]
        }
        BranchSpec::New { branch, base } => vec![
            "worktree".into(), "add".into(), "-b".into(), branch.clone(),
            worktree_path.into(), base.clone(),
        ],
        // PR: detached HEAD first; gh pr checkout will create the branch inside the worktree.
        BranchSpec::Pr { .. } => {
            vec!["worktree".into(), "add".into(), "--detach".into(), worktree_path.into()]
        }
    }
}

// Run `git worktree add` into the managed location; returns the resolved worktree path or git's stderr.
#[tauri::command]
pub fn create_worktree(
    app: tauri::AppHandle,
    repo_path: String,
    name: String,
    spec: BranchSpec,
) -> Result<String, String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let wt = managed_path(&home, &repo_path, &name);
    let wt_str = wt.to_string_lossy().to_string();
    // Add the worktree — but for a PR, reuse an existing target dir (idempotent retry after a failed
    // checkout, e.g. a leftover detached worktree) instead of failing; the PR checkout below brings it
    // onto the right branch. Non-PR specs keep failing on a colliding path (a "new branch" shouldn't reuse).
    let reuse = matches!(spec, BranchSpec::Pr { .. }) && wt.exists();
    if !reuse {
        let args = worktree_add_args(&wt_str, &spec);
        let out = Command::new("git")
            .current_dir(&repo_path)
            .args(&args)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
    }
    // PR: check out the PR inside the (fresh or reused) worktree.
    if let BranchSpec::Pr { number, branch } = &spec {
        let n = number.to_string();
        // Primary: `gh pr checkout` sets up a push-tracking branch for an open PR and handles forks.
        let co = Command::new("gh")
            .current_dir(&wt)
            .args(["pr", "checkout", &n])
            .output()
            .map_err(|e| format!("gh CLI not found: {e}"))?;
        if !co.status.success() {
            // Fallback: the live head branch may be gone (e.g. a merged PR with its branch deleted).
            // The immutable refs/pull/<N>/head always exists — fetch it and create the branch from it.
            let pull_ref = format!("pull/{n}/head");
            let fetched = Command::new("git")
                .current_dir(&wt)
                .args(["fetch", "origin", &pull_ref])
                .output()
                .map_err(|e| format!("failed to run git: {e}"))?;
            if !fetched.status.success() {
                return Err(String::from_utf8_lossy(&fetched.stderr).trim().to_string());
            }
            // -B (not -b): create the branch, or reset it to the PR head if a prior attempt left it — idempotent.
            let checked = Command::new("git")
                .current_dir(&wt)
                .args(["checkout", "-B", branch, "FETCH_HEAD"])
                .output()
                .map_err(|e| format!("failed to run git: {e}"))?;
            if !checked.status.success() {
                return Err(String::from_utf8_lossy(&checked.stderr).trim().to_string());
            }
        }
    }
    Ok(wt_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalizes_case_and_separators() {
        assert_eq!(slug("Fix Login Bug"), "fix-login-bug");
        assert_eq!(slug("  Weird__Name!! "), "weird-name");
    }

    #[test]
    fn managed_path_uses_repo_basename_and_slug() {
        let p = managed_path(Path::new("/home/me"), "/Users/me/Repos/elder-api", "Fix Login");
        assert_eq!(p, PathBuf::from("/home/me/CockpitWorktrees/elder-api/fix-login"));
    }

    #[test]
    fn add_args_existing_branch() {
        let a = worktree_add_args("/wt", &BranchSpec::Existing { branch: "fex".into() });
        assert_eq!(a, vec!["worktree", "add", "/wt", "fex"]);
    }

    #[test]
    fn add_args_new_branch_from_base() {
        let a = worktree_add_args(
            "/wt",
            &BranchSpec::New { branch: "victor/fix".into(), base: "main".into() },
        );
        assert_eq!(a, vec!["worktree", "add", "-b", "victor/fix", "/wt", "main"]);
    }

    #[test]
    fn add_args_pr_makes_detached_worktree() {
        let a = worktree_add_args("/wt", &BranchSpec::Pr { number: 42, branch: "feat/x".into() });
        assert_eq!(a, vec!["worktree", "add", "--detach", "/wt"]);
    }
}
