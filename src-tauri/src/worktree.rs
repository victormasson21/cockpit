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

// One local branch + how long ago it was last committed to (for the recency-sorted picker).
// `checked_out` flags a branch git won't let us worktree-add (already checked out in the main repo or another
// worktree); the UI disables those so the user can't pick a branch that would fail at create.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub last_commit_relative: String,
    pub checked_out: bool,
    pub checked_out_path: Option<String>,
}

// Parse `git for-each-ref` output (one `<name>\t<relative-date>` line per branch) into BranchInfo rows.
// git already sorted the input by committerdate desc, so we preserve line order. Blank lines are skipped.
pub fn parse_branch_lines(stdout: &str) -> Vec<BranchInfo> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut parts = l.splitn(2, '\t');
            BranchInfo {
                name: parts.next().unwrap_or("").to_string(),
                last_commit_relative: parts.next().unwrap_or("").to_string(),
                checked_out: false,
                checked_out_path: None,
            }
        })
        .collect()
}

// Parse `git worktree list --porcelain` into (branch-short-name, worktree-path) pairs — one per branch-bearing
// worktree (detached worktrees have no `branch` line and are skipped). Used to flag already-checked-out branches.
pub fn parse_worktree_branches(porcelain: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut cur_path: Option<String> = None;
    for line in porcelain.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            cur_path = Some(p.trim().to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            let short = b.trim().strip_prefix("refs/heads/").unwrap_or(b.trim()).to_string();
            if let Some(p) = &cur_path {
                out.push((short, p.clone()));
            }
        }
    }
    out
}

// Dirtiness probe result for the teardown confirm dialog: does the worktree dir exist, and does it
// have uncommitted changes? `exists: false` lets Delete proceed straight to git's prune fallback.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub exists: bool,
    pub dirty: bool,
}

// One changed file in a branch-vs-base diff: path + line counts. `binary` files report no
// counts in `git diff --numstat` (a `-`/`-` line); we surface that instead of faking zeros.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
}

// The whole branch-vs-base diff summary: the resolved base ref + one row per changed file.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub base: String,
    pub files: Vec<DiffFile>,
}

// Build the `git diff --merge-base <base> --numstat` argv (the stat summary; pure/tested).
// --merge-base diffs the merge-base of base..HEAD against the WORKING TREE, so it captures
// both committed and uncommitted changes — "what does this branch contain right now".
pub fn diff_stat_args(base: &str) -> Vec<String> {
    vec!["diff".into(), "--merge-base".into(), base.into(), "--numstat".into()]
}

// Build the `git diff --merge-base <base> -- <path>` argv for one file's raw patch (pure/tested).
pub fn file_diff_args(base: &str, path: &str) -> Vec<String> {
    vec!["diff".into(), "--merge-base".into(), base.into(), "--".into(), path.into()]
}

// Parse `git diff --numstat` output (one `<added>\t<removed>\t<path>` line per file) into rows.
// Binary files emit `-\t-\t<path>`; we report them with zero counts + binary=true. Blank lines skipped.
pub fn parse_numstat(stdout: &str) -> Vec<DiffFile> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut parts = l.splitn(3, '\t');
            let added_raw = parts.next().unwrap_or("");
            let removed_raw = parts.next().unwrap_or("");
            let path = parts.next().unwrap_or("").to_string();
            let binary = added_raw == "-" || removed_raw == "-";
            DiffFile {
                path,
                added: added_raw.parse().unwrap_or(0),
                removed: removed_raw.parse().unwrap_or(0),
                binary,
            }
        })
        .collect()
}

// Build `git worktree remove [--force] <path>` argv (pure; tested without invoking git).
pub fn worktree_remove_args(worktree_path: &str, force: bool) -> Vec<String> {
    let mut v = vec!["worktree".into(), "remove".into()];
    if force {
        v.push("--force".into());
    }
    v.push(worktree_path.into());
    v
}

// Build `git branch -D <branch>` argv — force-delete (handles unmerged branches; the UI already confirmed).
pub fn delete_branch_args(branch: &str) -> Vec<String> {
    vec!["branch".into(), "-D".into(), branch.into()]
}

// Mark each branch that is currently checked out in some worktree, recording where — a pure join so it's testable.
pub fn mark_checked_out(mut branches: Vec<BranchInfo>, worktree_branches: &[(String, String)]) -> Vec<BranchInfo> {
    for b in &mut branches {
        if let Some((_, path)) = worktree_branches.iter().find(|(name, _)| name == &b.name) {
            b.checked_out = true;
            b.checked_out_path = Some(path.clone());
        }
    }
    branches
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

// List a repo's local branches, most-recently-committed first, for the "open existing branch" picker.
#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let out = Command::new("git")
        .current_dir(&repo_path)
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%09%(committerdate:relative)",
            "refs/heads/",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let branches = parse_branch_lines(&String::from_utf8_lossy(&out.stdout));
    // Flag branches already checked out elsewhere (git refuses to worktree-add those). A failure here is
    // non-fatal — we just return the branches unflagged rather than break the whole picker.
    let wt_out = Command::new("git")
        .current_dir(&repo_path)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;
    let worktree_branches = if wt_out.status.success() {
        parse_worktree_branches(&String::from_utf8_lossy(&wt_out.stdout))
    } else {
        Vec::new()
    };
    Ok(mark_checked_out(branches, &worktree_branches))
}

// Probe a worktree for uncommitted changes (for the Delete/Wipe confirm dialog). Missing dir → not
// dirty (Delete still proceeds); a git error on an existing dir → dirty (safe default: force the user
// to acknowledge force-removal rather than silently risk losing data).
#[tauri::command]
pub fn worktree_status(worktree_path: String) -> Result<WorktreeStatus, String> {
    if !Path::new(&worktree_path).exists() {
        return Ok(WorktreeStatus { exists: false, dirty: false });
    }
    let out = Command::new("git")
        .current_dir(&worktree_path)
        .args(["status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;
    let dirty = if out.status.success() {
        !String::from_utf8_lossy(&out.stdout).trim().is_empty()
    } else {
        true // existing dir but git can't read it: treat as dirty so the dialog forces force-removal.
    };
    Ok(WorktreeStatus { exists: true, dirty })
}

// Read the repo's default branch from origin/HEAD (e.g. "main"); None when there's no remote HEAD.
// Self-contained (not shared with deduce.rs's private copy) to keep this module decoupled.
fn repo_default_branch(repo_path: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let short = s.strip_prefix("origin/").unwrap_or(&s).to_string();
    if short.is_empty() { None } else { Some(short) }
}

// Resolve the base ref to diff against: an explicit base wins; else the repo default branch;
// else an error the UI shows inline (we won't guess a base).
fn resolve_base(base: &str, repo_path: &str) -> Result<String, String> {
    if !base.is_empty() {
        return Ok(base.to_string());
    }
    repo_default_branch(repo_path)
        .ok_or_else(|| "couldn't determine a base branch (no origin/HEAD)".to_string())
}

// Branch-vs-base diff summary for the Cockpit Diff tab: run `git diff --merge-base <base>
// --numstat` in the worktree dir and parse the per-file line counts. Read-only.
#[tauri::command]
pub fn worktree_diff(worktree_path: String, repo_path: String, base: String) -> Result<DiffResult, String> {
    let base = resolve_base(&base, &repo_path)?;
    if !Path::new(&worktree_path).exists() {
        return Err("worktree path not found".to_string());
    }
    let out = Command::new("git")
        .current_dir(&worktree_path)
        .args(diff_stat_args(&base))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let files = parse_numstat(&String::from_utf8_lossy(&out.stdout));
    Ok(DiffResult { base, files })
}

// One file's raw unified patch (fetched lazily when the user expands a file row). Coloring is
// the frontend's job — we return git's raw output verbatim.
#[tauri::command]
pub fn worktree_file_diff(worktree_path: String, repo_path: String, base: String, path: String) -> Result<String, String> {
    let base = resolve_base(&base, &repo_path)?;
    let out = Command::new("git")
        .current_dir(&worktree_path)
        .args(file_diff_args(&base, &path))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// Remove the git worktree (Delete/Wipe). `force` allows removing a dirty worktree. If `git worktree
// remove` fails but the dir is already gone (manually deleted), fall back to `git worktree prune` to
// deregister the stale `.git/worktrees/<ref>` entry — the core of the stuck-branch bug fix.
#[tauri::command]
pub fn remove_worktree(repo_path: String, worktree_path: String, force: bool) -> Result<(), String> {
    let args = worktree_remove_args(&worktree_path, force);
    let out = Command::new("git")
        .current_dir(&repo_path)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    // Fallback: the dir is gone, so remove can't operate — prune the dangling registration instead.
    if !Path::new(&worktree_path).exists() {
        let pruned = Command::new("git")
            .current_dir(&repo_path)
            .args(["worktree", "prune"])
            .output()
            .map_err(|e| e.to_string())?;
        if pruned.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&pruned.stderr).trim().to_string());
    }
    Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
}

// Force-delete a branch (Wipe). Must run AFTER the worktree is removed — git refuses to delete a
// branch still checked out in a worktree.
#[tauri::command]
pub fn delete_branch(repo_path: String, branch: String) -> Result<(), String> {
    let args = delete_branch_args(&branch);
    let out = Command::new("git")
        .current_dir(&repo_path)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
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

    #[test]
    fn remove_args_plain() {
        assert_eq!(worktree_remove_args("/wt", false), vec!["worktree", "remove", "/wt"]);
    }

    #[test]
    fn remove_args_force() {
        assert_eq!(worktree_remove_args("/wt", true), vec!["worktree", "remove", "--force", "/wt"]);
    }

    #[test]
    fn delete_branch_args_builds_force_delete() {
        assert_eq!(delete_branch_args("victor/fix"), vec!["branch", "-D", "victor/fix"]);
    }

    #[test]
    fn parse_branch_lines_splits_tab_and_skips_blanks() {
        let out = "main\t2 hours ago\nvictor/fix\t3 days ago\n\n";
        let got = parse_branch_lines(out);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "main");
        assert_eq!(got[0].last_commit_relative, "2 hours ago");
        assert_eq!(got[1].name, "victor/fix");
        assert_eq!(got[1].last_commit_relative, "3 days ago");
    }

    #[test]
    fn parse_branch_lines_empty_is_empty() {
        assert!(parse_branch_lines("").is_empty());
        assert!(parse_branch_lines("\n  \n").is_empty());
    }

    #[test]
    fn parse_branch_lines_tolerates_missing_date() {
        let got = parse_branch_lines("orphan\n");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "orphan");
        assert_eq!(got[0].last_commit_relative, "");
        assert!(!got[0].checked_out);
        assert_eq!(got[0].checked_out_path, None);
    }

    #[test]
    fn parse_worktree_branches_pairs_branch_with_path_and_skips_detached() {
        let porcelain = "worktree /repo/main\nHEAD abc123\nbranch refs/heads/ca-v3-form-v1\n\n\
                         worktree /repo/detached\nHEAD def456\ndetached\n\n\
                         worktree /repo/feat\nHEAD 789aaa\nbranch refs/heads/feat/login\n";
        let got = parse_worktree_branches(porcelain);
        assert_eq!(
            got,
            vec![
                ("ca-v3-form-v1".to_string(), "/repo/main".to_string()),
                ("feat/login".to_string(), "/repo/feat".to_string()),
            ]
        );
    }

    #[test]
    fn diff_stat_args_builds_numstat_against_merge_base() {
        assert_eq!(diff_stat_args("main"), vec!["diff", "--merge-base", "main", "--numstat"]);
    }

    #[test]
    fn file_diff_args_builds_pathspec_diff() {
        let a = file_diff_args("main", "src/foo.ts");
        assert_eq!(a, vec!["diff", "--merge-base", "main", "--", "src/foo.ts"]);
    }

    #[test]
    fn parse_numstat_reads_counts_and_path() {
        let out = "12\t3\tsrc/foo.ts\n4\t0\tsrc/bar.rs\n";
        let got = parse_numstat(out);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].path, "src/foo.ts");
        assert_eq!((got[0].added, got[0].removed, got[0].binary), (12, 3, false));
        assert_eq!((got[1].added, got[1].removed, got[1].binary), (4, 0, false));
    }

    #[test]
    fn parse_numstat_flags_binary_files() {
        let got = parse_numstat("-\t-\tassets/logo.png\n");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].path, "assets/logo.png");
        assert_eq!((got[0].added, got[0].removed, got[0].binary), (0, 0, true));
    }

    #[test]
    fn parse_numstat_empty_and_blank_lines() {
        assert!(parse_numstat("").is_empty());
        assert!(parse_numstat("\n  \n").is_empty());
    }

    #[test]
    fn parse_numstat_tolerates_paths_with_spaces() {
        // numstat is tab-separated, so a path with spaces stays intact (splitn(3) on '\t').
        let got = parse_numstat("1\t2\tsrc/a b/c.ts\n");
        assert_eq!(got[0].path, "src/a b/c.ts");
    }

    #[test]
    fn mark_checked_out_flags_in_use_branches_only() {
        let branches = parse_branch_lines("ca-v3-form-v1\t2 days ago\nidle-branch\t5 days ago\n");
        let wt = vec![("ca-v3-form-v1".to_string(), "/repo/main".to_string())];
        let got = mark_checked_out(branches, &wt);
        assert!(got[0].checked_out);
        assert_eq!(got[0].checked_out_path, Some("/repo/main".to_string()));
        assert!(!got[1].checked_out);
        assert_eq!(got[1].checked_out_path, None);
    }
}
