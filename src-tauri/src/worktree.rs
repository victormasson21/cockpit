//! worktree.rs — git-worktree provider: derives a managed path and runs `git worktree add` for a new or existing branch.
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::git;

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
// `primary_tree` is the one exception: the branch the repo's OWN working tree holds, which the UI offers
// as "open in place" instead.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub last_commit_relative: String,
    pub checked_out: bool,
    pub primary_tree: bool,
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
                primary_tree: false,
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

// git args to print a path's repo root; non-zero exit if the path is not inside a work tree.
// The directory to run in is git::run's first argument, so it isn't part of the argv.
pub fn repo_root_args() -> Vec<String> {
    vec!["rev-parse".into(), "--show-toplevel".into()]
}

// True when `branch` is a branch we refuse to force-delete on Wipe. It matches the repo's known
// default (from origin/HEAD) when we have one; when that's absent (fresh clones often lack a local
// origin/HEAD ref), it falls back to the conventional names main/master so the common case is still
// protected. Pure so the guard is testable.
pub fn is_default_branch(branch: &str, default: Option<&str>) -> bool {
    match default {
        Some(d) => branch == d,
        None => branch == "main" || branch == "master",
    }
}

// Mark each branch that is currently checked out in some worktree, recording where — a pure join so it's testable.
pub fn mark_checked_out(mut branches: Vec<BranchInfo>, worktree_branches: &[(String, String)]) -> Vec<BranchInfo> {
    for b in &mut branches {
        if worktree_branches.iter().any(|(name, _)| name == &b.name) {
            b.checked_out = true;
        }
    }
    branches
}

// The branch the repo's own working tree holds, or None when that tree is detached. `git worktree list`
// always prints the main working tree first, so the answer is the first block's `branch` line — no path
// comparison against the caller's repo path, which a trailing slash or a symlinked checkout would break.
pub fn primary_tree_branch(porcelain: &str) -> Option<String> {
    for line in porcelain.lines() {
        if line.trim().is_empty() {
            return None;
        }
        if let Some(b) = line.strip_prefix("branch ") {
            let short = b.trim().strip_prefix("refs/heads/").unwrap_or(b.trim());
            return Some(short.to_string());
        }
    }
    None
}

// Flag the branch the repo's own working tree holds — the one branch the picker offers despite being
// checked out, because opening it needs no `git worktree add`. A pure join so it's testable.
pub fn mark_primary_tree(mut branches: Vec<BranchInfo>, primary_branch: Option<&str>) -> Vec<BranchInfo> {
    for b in &mut branches {
        if primary_branch == Some(b.name.as_str()) {
            b.primary_tree = true;
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
#[tauri::command(async)]
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
        git::run(&repo_path, worktree_add_args(&wt_str, &spec))?;
    }
    // PR: check out the PR inside the (fresh or reused) worktree.
    if let BranchSpec::Pr { number, branch } = &spec {
        let n = number.to_string();
        // Primary: `gh pr checkout` sets up a push-tracking branch for an open PR and handles forks.
        // The one raw subprocess left in this module, deliberately: it's `gh`, not git, and github.rs's
        // runner imposes GH_TIMEOUT (30s) — a slow PR fetch would trip it and divert to the fallback
        // below. Unifying it needs that timeout decided on its own merits.
        let co = Command::new("gh")
            .current_dir(&wt)
            .args(["pr", "checkout", &n])
            .output()
            .map_err(|e| format!("gh CLI not found: {e}"))?;
        if !co.status.success() {
            // Fallback: the live head branch may be gone (e.g. a merged PR with its branch deleted).
            // The immutable refs/pull/<N>/head always exists — fetch it and create the branch from it.
            let pull_ref = format!("pull/{n}/head");
            let wt_dir = wt.to_string_lossy().to_string();
            git::run(&wt_dir, ["fetch", "origin", &pull_ref])?;
            // -B (not -b): create the branch, or reset it to the PR head if a prior attempt left it — idempotent.
            git::run(&wt_dir, ["checkout", "-B", branch, "FETCH_HEAD"])?;
        }
    }
    Ok(wt_str)
}

// List a repo's local branches, most-recently-committed first, for the "open existing branch" picker.
#[tauri::command(async)]
pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let out = git::run(&repo_path, [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)%09%(committerdate:relative)",
        "refs/heads/",
    ])?;
    let branches = parse_branch_lines(&out);
    // Flag branches already checked out elsewhere (git refuses to worktree-add those). A failure here is
    // non-fatal — we just return the branches unflagged rather than break the whole picker.
    let porcelain = git::run(&repo_path, ["worktree", "list", "--porcelain"]).unwrap_or_default();
    let worktree_branches = parse_worktree_branches(&porcelain);
    let flagged = mark_checked_out(branches, &worktree_branches);
    Ok(mark_primary_tree(flagged, primary_tree_branch(&porcelain).as_deref()))
}

// Probe a worktree for uncommitted changes (for the Delete/Wipe confirm dialog). Missing dir → not
// dirty (Delete still proceeds); a git error on an existing dir → dirty (safe default: force the user
// to acknowledge force-removal rather than silently risk losing data).
#[tauri::command(async)]
pub fn worktree_status(worktree_path: String) -> Result<WorktreeStatus, String> {
    if !Path::new(&worktree_path).exists() {
        return Ok(WorktreeStatus { exists: false, dirty: false });
    }
    // Failure is data here, not an error: an existing dir git can't read counts as dirty, so the
    // dialog forces a deliberate force-removal rather than silently risking data.
    let dirty = match git::run(&worktree_path, ["status", "--porcelain"]) {
        Ok(out) => !out.trim().is_empty(),
        Err(_) => true,
    };
    Ok(WorktreeStatus { exists: true, dirty })
}

// Validate a picked folder is a git work tree and normalize it to its repo root.
// One `rev-parse --show-toplevel` does both: non-zero exit => not a repo; stdout => the root.
#[tauri::command(async)]
pub fn resolve_repo_root(path: String) -> Result<String, String> {
    git::run(&path, repo_root_args())
        .map(|out| out.trim().to_string())
        .map_err(|_| format!("Not a git repository: {path}"))
}

// The branch a working tree currently has checked out. Read live rather than trusted from the model:
// a primary-tree entity points at the user's own clone, where they switch branches outside cockpit.
#[tauri::command(async)]
pub fn current_branch(repo_path: String) -> Result<String, String> {
    git::run(&repo_path, ["rev-parse", "--abbrev-ref", "HEAD"]).map(|out| out.trim().to_string())
}

// Resolve the base ref to diff against: an explicit base wins; else the repo default branch;
// else an error the UI shows inline (we won't guess a base).
fn resolve_base(base: &str, repo_path: &str) -> Result<String, String> {
    if !base.is_empty() {
        return Ok(base.to_string());
    }
    git::default_branch(repo_path)
        .ok_or_else(|| "couldn't determine a base branch (no origin/HEAD)".to_string())
}

// Branch-vs-base diff summary for the Cockpit Diff tab: run `git diff --merge-base <base>
// --numstat` in the worktree dir and parse the per-file line counts. Read-only.
#[tauri::command(async)]
pub fn worktree_diff(worktree_path: String, repo_path: String, base: String) -> Result<DiffResult, String> {
    let base = resolve_base(&base, &repo_path)?;
    if !Path::new(&worktree_path).exists() {
        return Err("worktree path not found".to_string());
    }
    let out = git::run(&worktree_path, diff_stat_args(&base))?;
    Ok(DiffResult { base, files: parse_numstat(&out) })
}

// One file's raw unified patch (fetched lazily when the user expands a file row). Coloring is
// the frontend's job — we return git's raw output verbatim.
#[tauri::command(async)]
pub fn worktree_file_diff(worktree_path: String, repo_path: String, base: String, path: String) -> Result<String, String> {
    let base = resolve_base(&base, &repo_path)?;
    // Raw patch, verbatim — git::run does not trim stdout, so coloring stays the frontend's job.
    git::run(&worktree_path, file_diff_args(&base, &path))
}

// Remove the git worktree (Delete/Wipe). `force` allows removing a dirty worktree. If `git worktree
// remove` fails because the worktree is already gone — dir deleted, or only leftover files remain
// with the `.git` link missing (e.g. an external cleanup then a dev process recreating cache files:
// git refuses with "is not a working tree") — fall back to `git worktree prune` + clearing the
// leftovers. The confirm dialog is the gate: once the user approves, the desired end state holds.
#[tauri::command(async)]
pub fn remove_worktree(repo_path: String, worktree_path: String, force: bool) -> Result<(), String> {
    let removed = git::run(&repo_path, worktree_remove_args(&worktree_path, force));
    if removed.is_ok() {
        return Ok(());
    }
    // Fallback: no longer a valid worktree (dir gone, or a plain dir without a `.git` link) —
    // remove can't operate; deregister the stale entry and delete any leftover files instead.
    let path = Path::new(&worktree_path);
    if !path.exists() || !path.join(".git").exists() {
        git::run(&repo_path, ["worktree", "prune"])?;
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    Err(removed.unwrap_err())
}

// True when `branch` exists locally. A probe failure reports "exists" so `branch -D` runs and
// surfaces the real git error instead of us silently swallowing it.
fn branch_exists(repo_path: &str, branch: &str) -> bool {
    git::run(repo_path, ["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok()
}

// Force-delete a branch (Wipe). Must run AFTER the worktree is removed — git refuses to delete a
// branch still checked out in a worktree.
#[tauri::command(async)]
pub fn delete_branch(repo_path: String, branch: String) -> Result<(), String> {
    // Already gone (e.g. a Claude session cleaned up at wrap-up): Wipe's end state holds — no-op
    // success, mirroring remove_worktree's prune fallback, instead of a "branch not found" error.
    if !branch_exists(&repo_path, &branch) {
        return Ok(());
    }
    // Guard: never force-delete the repo default branch (e.g. Wipe on a `main`-checked-out worktree).
    // Wipe then degrades to Delete — the worktree is already removed by the caller; the branch is kept.
    let default = git::default_branch(&repo_path);
    if is_default_branch(&branch, default.as_deref()) {
        return Err(format!(
            "{branch} is the repo default branch — refusing to delete it (worktree removed; branch kept)."
        ));
    }
    git::run(&repo_path, delete_branch_args(&branch)).map(|_| ())
}

// Resolve any path inside a git working tree to the PRIMARY repo root. `--git-common-dir` reports the
// primary's `.git` for a clone, one of its subdirectories and a linked worktree alike, so its parent is
// always the clone the user thinks of as "the repo" — never a worktree cockpit created.
fn primary_root(dir: &Path) -> Option<String> {
    let common = git::run(&dir.to_string_lossy(), ["rev-parse", "--path-format=absolute", "--git-common-dir"]).ok()?;
    Some(Path::new(common.trim()).parent()?.to_string_lossy().to_string())
}

// How far below a picked folder to look for repos. 3 spans a group-of-groups layout
// (`~/Repos/<org>/<repo>`) with a level to spare, and caps the damage if a whole home dir is picked.
const MAX_DISCOVERY_DEPTH: usize = 3;

// Order-preserving insert: overlapping picks (`~/Repos` and `~/Repos/elder`) reach the same repo twice.
fn push_unique(out: &mut Vec<String>, root: String) {
    if !out.contains(&root) {
        out.push(root);
    }
}

// Dirs a scan must never walk into: dotfile-prefixed (`.git`, caches, editor state) and dependency trees.
fn is_searchable(path: &Path) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.is_dir() && !name.starts_with('.') && name != "node_modules"
}

// Walk `dir` for repos, stopping at each one — a repo's own vendored checkouts and submodules are part
// of it, not siblings of it. Unlike a picked path, a walked one is filtered by a cheap `.git` test
// before git is spawned, so picking a huge tree costs directory reads rather than thousands of processes.
fn collect_repos(dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return; // unreadable dir is data, not an error: skip it and keep scanning the rest.
    };
    for path in entries.flatten().map(|e| e.path()).filter(|p| is_searchable(p)) {
        if path.join(".git").exists() {
            if let Some(root) = primary_root(&path) {
                push_unique(out, root);
            }
            continue;
        }
        collect_repos(&path, depth - 1, out);
    }
}

// Repo roots for a set of picked folders (the Settings multi-select picker). A pick inside a repo
// resolves to that repo; anything else is treated as "the repos in here" and walked. The dialog hands
// back only paths, so a selected folder and the folder the panel was standing in are indistinguishable
// — this keys off what is on disk instead, which makes both gestures land in the right case.
#[tauri::command(async)]
pub fn discover_repos(paths: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for path in paths.iter().map(Path::new) {
        match primary_root(path) {
            Some(root) => push_unique(&mut out, root),
            None => collect_repos(path, MAX_DISCOVERY_DEPTH, &mut out),
        }
    }
    out
}

// Every working tree across `repo_paths` on the same branch as the tree at `worktree_path` — the editor
// button's answer to "which folders did this piece of work touch". A cross-repo change carries one branch
// name through every repo it spans, so a same-branch tree elsewhere is a root worth opening alongside it.
//
// The branch is read from HEAD, not taken from the caller: the worktree model only snapshots it at
// creation, and a Claude session that branched again since would otherwise detect nothing.
#[tauri::command(async)]
pub fn branch_roots(worktree_path: String, repo_paths: Vec<String>) -> Vec<String> {
    let Ok(branch) = current_branch(worktree_path) else {
        return Vec::new(); // gone from disk: no branch to match, and the caller still opens the worktree.
    };
    let mut out = Vec::new();
    for repo_path in &repo_paths {
        let porcelain = git::run(repo_path, ["worktree", "list", "--porcelain"]).unwrap_or_default();
        for (tree_branch, path) in parse_worktree_branches(&porcelain) {
            if tree_branch == branch {
                push_unique(&mut out, path);
            }
        }
    }
    out
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

    // Real-git tests for delete_branch's idempotency (a session may have already cleaned up).
    fn init_test_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            let out = Command::new("git").current_dir(dir.path()).args(args).output().unwrap();
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
        dir
    }

    // Init a repo at an arbitrary path (the discovery tests need several under one parent).
    fn init_repo_at(path: &Path) -> String {
        std::fs::create_dir_all(path).unwrap();
        let dir = path.to_string_lossy().to_string();
        git::run(&dir, ["init", "-q", "-b", "main"]).unwrap();
        std::fs::canonicalize(path).unwrap().to_string_lossy().to_string()
    }

    #[test]
    fn delete_branch_ok_when_branch_already_gone() {
        // Wipe after an external cleanup (Claude already deleted the branch): the desired end
        // state holds, so this must be a no-op success — not a "branch not found" error.
        let repo = init_test_repo();
        let path = repo.path().to_string_lossy().to_string();
        assert_eq!(delete_branch(path, "feat/already-gone".into()), Ok(()));
    }

    #[test]
    fn current_branch_reads_the_checked_out_branch() {
        let repo = init_test_repo();
        let path = repo.path().to_string_lossy().to_string();
        assert_eq!(current_branch(path), Ok("main".to_string()));
    }

    #[test]
    fn repo_root_args_builds_rev_parse_toplevel() {
        // The directory is git::run's first argument, so it is deliberately absent from the argv.
        assert_eq!(repo_root_args(), vec!["rev-parse", "--show-toplevel"]);
    }

    #[test]
    fn resolve_repo_root_returns_root_for_a_repo() {
        let repo = init_test_repo();
        let path = repo.path().to_string_lossy().to_string();
        let root = resolve_repo_root(path).unwrap();
        // canonicalize both sides: macOS /var is a symlink to /private/var, so git's
        // --show-toplevel and tempdir()'s path can differ only by that prefix.
        let got = std::fs::canonicalize(&root).unwrap();
        let want = std::fs::canonicalize(repo.path()).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn resolve_repo_root_normalizes_a_subdirectory_to_the_root() {
        let repo = init_test_repo();
        let sub = repo.path().join("pkg/inner");
        std::fs::create_dir_all(&sub).unwrap();
        let root = resolve_repo_root(sub.to_string_lossy().to_string()).unwrap();
        let got = std::fs::canonicalize(&root).unwrap();
        let want = std::fs::canonicalize(repo.path()).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn resolve_repo_root_errors_for_a_non_repo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        let err = resolve_repo_root(path.clone()).unwrap_err();
        assert!(err.contains("Not a git repository"), "got: {err}");
    }

    #[test]
    fn delete_branch_removes_existing_branch() {
        let repo = init_test_repo();
        let path = repo.path().to_string_lossy().to_string();
        let out = Command::new("git")
            .current_dir(repo.path())
            .args(["branch", "feat/x"])
            .output()
            .unwrap();
        assert!(out.status.success());
        assert_eq!(delete_branch(path.clone(), "feat/x".into()), Ok(()));
        // And it's actually gone.
        let verify = Command::new("git")
            .current_dir(repo.path())
            .args(["rev-parse", "--verify", "--quiet", "refs/heads/feat/x"])
            .output()
            .unwrap();
        assert!(!verify.status.success());
    }

    // repo_default_branch moved to git.rs (it was duplicated in deduce.rs); its four
    // fallback cases moved with it — see git::tests::default_branch_*.

    #[test]
    fn remove_worktree_cleans_leftover_dir_when_no_longer_a_worktree() {
        // Regression: after an external cleanup (dir deleted + registration pruned), a dev process
        // can recreate cache files in the dir. `git worktree remove` then refuses with "is not a
        // working tree" — Delete must prune + clear the leftovers instead of surfacing that error.
        let repo = init_test_repo();
        let repo_path = repo.path().to_string_lossy().to_string();
        let holder = tempfile::tempdir().unwrap();
        let wt_path = holder.path().join("wt");
        let wt = wt_path.to_string_lossy().to_string();
        let run = |args: &[&str]| {
            let out = Command::new("git").current_dir(repo.path()).args(args).output().unwrap();
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        };
        run(&["worktree", "add", "-q", "-b", "feat/leftover", &wt, "main"]);
        std::fs::remove_dir_all(&wt_path).unwrap();
        run(&["worktree", "prune"]);
        std::fs::create_dir_all(wt_path.join(".vite")).unwrap();
        std::fs::write(wt_path.join("package-lock.json"), "{}").unwrap();
        assert_eq!(remove_worktree(repo_path, wt.clone(), true), Ok(()));
        assert!(!wt_path.exists(), "leftover dir should be deleted");
    }

    #[test]
    fn remove_worktree_cleans_leftover_dir_even_without_force() {
        // The confirm dialog is the gate: once the user approves Delete/Wipe, cleanup proceeds
        // regardless of the force flag — the worktree is already gone, only junk remains.
        let repo = init_test_repo();
        let repo_path = repo.path().to_string_lossy().to_string();
        let holder = tempfile::tempdir().unwrap();
        let wt_path = holder.path().join("wt");
        let wt = wt_path.to_string_lossy().to_string();
        let run = |args: &[&str]| {
            let out = Command::new("git").current_dir(repo.path()).args(args).output().unwrap();
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        };
        run(&["worktree", "add", "-q", "-b", "feat/leftover2", &wt, "main"]);
        std::fs::remove_dir_all(&wt_path).unwrap();
        run(&["worktree", "prune"]);
        std::fs::create_dir_all(&wt_path).unwrap();
        std::fs::write(wt_path.join("stray.txt"), "x").unwrap();
        assert_eq!(remove_worktree(repo_path, wt.clone(), false), Ok(()));
        assert!(!wt_path.exists(), "leftover dir should be deleted");
    }

    #[test]
    fn is_default_branch_matches_known_default() {
        assert!(is_default_branch("main", Some("main")));
        assert!(!is_default_branch("victor/fix", Some("main")));
        // A non-standard known default (e.g. "develop") is protected; "main" is not, since it's not it.
        assert!(is_default_branch("develop", Some("develop")));
        assert!(!is_default_branch("main", Some("develop")));
    }

    #[test]
    fn is_default_branch_falls_back_to_main_master_when_unknown() {
        // No origin/HEAD (common on fresh clones): still protect the conventional names.
        assert!(is_default_branch("main", None));
        assert!(is_default_branch("master", None));
        assert!(!is_default_branch("victor/fix", None));
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
        assert!(!got[0].primary_tree);
    }

    #[test]
    fn primary_tree_branch_reads_the_first_worktree_block() {
        // git always lists the main working tree first, whatever the branch's commit date — which is
        // why identifying it needs no path comparison against the repo we were asked about.
        let porcelain = "worktree /repo/main\nHEAD abc123\nbranch refs/heads/ca-v3-form-v1\n\n\
                         worktree /repo/feat\nHEAD 789aaa\nbranch refs/heads/feat/login\n";
        assert_eq!(primary_tree_branch(porcelain), Some("ca-v3-form-v1".to_string()));
    }

    #[test]
    fn primary_tree_branch_is_none_when_the_main_tree_is_detached() {
        // The block ends without a branch line, so the next worktree's branch must NOT be claimed as ours.
        let porcelain = "worktree /repo/main\nHEAD abc123\ndetached\n\n\
                         worktree /repo/feat\nHEAD 789aaa\nbranch refs/heads/feat/login\n";
        assert_eq!(primary_tree_branch(porcelain), None);
    }

    #[test]
    fn mark_primary_tree_flags_only_the_named_branch() {
        let branches = parse_branch_lines("main\t2 days ago\nfeat/login\t5 days ago\n");
        let got = mark_primary_tree(branches, Some("main"));
        assert!(got[0].primary_tree);
        assert!(!got[1].primary_tree);
    }

    #[test]
    fn mark_primary_tree_flags_nothing_when_the_main_tree_is_detached() {
        let branches = parse_branch_lines("main\t2 days ago\n");
        assert!(!mark_primary_tree(branches, None)[0].primary_tree);
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
        assert!(!got[1].checked_out);
    }

    #[test]
    fn discover_repos_resolves_a_repo_to_itself() {
        let repo = init_test_repo();
        let got = discover_repos(vec![repo.path().to_string_lossy().to_string()]);
        let want = std::fs::canonicalize(repo.path()).unwrap().to_string_lossy().to_string();
        assert_eq!(got, vec![want]);
    }

    #[test]
    fn discover_repos_resolves_a_linked_worktree_to_its_primary() {
        let repo = init_test_repo();
        let wt = repo.path().join("linked");
        git::run(&repo.path().to_string_lossy(), ["worktree", "add", "-b", "side", &wt.to_string_lossy()]).unwrap();
        let got = discover_repos(vec![wt.to_string_lossy().to_string()]);
        let want = std::fs::canonicalize(repo.path()).unwrap().to_string_lossy().to_string();
        assert_eq!(got, vec![want]);
    }

    // A group folder (`~/Repos/elder`) is not a repo itself — the pick means "the repos in here".
    #[test]
    fn discover_repos_descends_a_group_folder() {
        let group = tempfile::tempdir().unwrap();
        let a = init_repo_at(&group.path().join("alpha"));
        let b = init_repo_at(&group.path().join("beta"));
        let got = discover_repos(vec![group.path().to_string_lossy().to_string()]);
        assert_eq!(got.len(), 2, "got {got:?}");
        assert!(got.contains(&a) && got.contains(&b), "got {got:?}");
    }

    #[test]
    fn discover_repos_dedupes_overlapping_picks() {
        let group = tempfile::tempdir().unwrap();
        let a = init_repo_at(&group.path().join("alpha"));
        let got = discover_repos(vec![
            group.path().to_string_lossy().to_string(),
            group.path().join("alpha").to_string_lossy().to_string(),
        ]);
        assert_eq!(got, vec![a]);
    }

    #[test]
    fn discover_repos_stops_at_the_depth_cap() {
        let group = tempfile::tempdir().unwrap();
        let deep = init_repo_at(&group.path().join("a/b/c"));
        let too_deep = init_repo_at(&group.path().join("d/e/f/g"));
        let got = discover_repos(vec![group.path().to_string_lossy().to_string()]);
        assert!(got.contains(&deep), "3 levels down should be found: {got:?}");
        assert!(!got.contains(&too_deep), "4 levels down should be out of reach: {got:?}");
    }

    #[test]
    fn discover_repos_skips_dependency_and_dotfile_dirs() {
        let group = tempfile::tempdir().unwrap();
        let vendored = init_repo_at(&group.path().join("node_modules/dep"));
        let hidden = init_repo_at(&group.path().join(".cache/thing"));
        let got = discover_repos(vec![group.path().to_string_lossy().to_string()]);
        assert!(!got.contains(&vendored), "node_modules should be skipped: {got:?}");
        assert!(!got.contains(&hidden), "dotfile dirs should be skipped: {got:?}");
    }

    // A checkout vendored inside a repo is part of that repo, not a sibling of it.
    #[test]
    fn discover_repos_does_not_descend_into_a_repo() {
        let group = tempfile::tempdir().unwrap();
        let outer = init_repo_at(&group.path().join("alpha"));
        init_repo_at(&group.path().join("alpha/vendor/inner"));
        let got = discover_repos(vec![group.path().to_string_lossy().to_string()]);
        assert_eq!(got, vec![outer]);
    }

    // Real-environment check (`cargo test -- --ignored`), like shell_env's PATH test: this machine keeps
    // its repos two levels below ~/Repos, with ~/elder-dev symlinked to one of the groups.
    #[test]
    #[ignore]
    fn discover_repos_walks_the_real_repos_folder() {
        let home = std::env::var("HOME").unwrap();
        let got = discover_repos(vec![format!("{home}/Repos")]);
        assert!(got.len() > 20, "expected the whole tree, got {got:?}");
        assert!(got.iter().any(|p| p.ends_with("/cockpit")), "cockpit missing from {got:?}");
        assert!(!got.iter().any(|p| p.contains("CockpitWorktrees")), "linked worktrees leaked: {got:?}");
    }

    // Add a worktree on a new branch and return its path.
    fn add_worktree_at(repo: &Path, name: &str, branch: &str) -> PathBuf {
        let wt = repo.join(name);
        git::run(&repo.to_string_lossy(), ["worktree", "add", "-b", branch, &wt.to_string_lossy()]).unwrap();
        wt
    }

    #[test]
    fn branch_roots_finds_the_working_tree_on_that_branch() {
        let repo = init_test_repo();
        let wt = add_worktree_at(repo.path(), "linked", "side");
        let got = branch_roots(wt.to_string_lossy().to_string(), vec![repo.path().to_string_lossy().to_string()]);
        let want = std::fs::canonicalize(&wt).unwrap().to_string_lossy().to_string();
        assert_eq!(got, vec![want]);
    }

    // The worktree model's branch is a creation-time snapshot, and a Claude session inside the worktree
    // may have branched again since. Detection has to read HEAD, or a renamed branch detects nothing.
    #[test]
    fn branch_roots_reads_the_branch_the_worktree_is_on_now() {
        let repo = init_test_repo();
        let wt = add_worktree_at(repo.path(), "linked", "side");
        git::run(&wt.to_string_lossy(), ["checkout", "-q", "-b", "moved-on"]).unwrap();
        let got = branch_roots(wt.to_string_lossy().to_string(), vec![repo.path().to_string_lossy().to_string()]);
        let want = std::fs::canonicalize(&wt).unwrap().to_string_lossy().to_string();
        assert_eq!(got, vec![want]);
    }

    #[test]
    fn branch_roots_ignores_repos_without_that_branch() {
        let repo = init_test_repo();
        let wt = add_worktree_at(repo.path(), "linked", "side");
        let elsewhere = init_test_repo();
        let not_a_repo = tempfile::tempdir().unwrap();
        let got = branch_roots(
            wt.to_string_lossy().to_string(),
            vec![
                elsewhere.path().to_string_lossy().to_string(),
                not_a_repo.path().to_string_lossy().to_string(),
            ],
        );
        assert!(got.is_empty(), "got {got:?}");
    }
}
