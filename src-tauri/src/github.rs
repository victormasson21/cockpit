//! github.rs — GitHub source provider: detects PR/issue URLs, fetches their context via the gh CLI, and maps owner/repo to a known local repo.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

const GH_TIMEOUT: Duration = Duration::from_secs(30); // gh calls are quick; generous ceiling.

// The kind of GitHub ref: a PR checks out its existing branch, an issue gets a new branch.
#[derive(Debug, Clone, PartialEq)]
pub enum GithubKind {
    Pr,
    Issue,
}

// A GitHub PR/issue reference parsed from a URL — enough to fetch it and pin its id.
#[derive(Debug, Clone, PartialEq)]
pub struct GithubRef {
    pub kind: GithubKind,
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

// What gh returned about the referenced PR/issue; branch/base are Some only for a PR.
#[derive(Debug, Clone, PartialEq)]
pub struct GithubContext {
    pub title: String,
    pub body: String,
    pub url: String,
    pub branch: Option<String>,
    pub base: Option<String>,
}

// Trim a trailing ".git" (git remotes carry it; URLs don't).
fn strip_git_suffix(s: &str) -> String {
    s.strip_suffix(".git").unwrap_or(s).to_string()
}

// Detect a GitHub PR or issue URL anywhere in the prompt; None otherwise. Pure, no I/O.
pub fn detect_github_ref(prompt: &str) -> Option<GithubRef> {
    // Scan whitespace-delimited tokens so a URL embedded in prose is found.
    prompt.split_whitespace().find_map(parse_github_url)
}

// Parse one token as github.com/<owner>/<repo>/(pull|issues)/<N> (trailing slug/query tolerated).
pub(crate) fn parse_github_url(token: &str) -> Option<GithubRef> {
    let rest = token.split_once("github.com/").map(|(_, r)| r)?;
    let mut parts = rest.split('/');
    let owner = non_empty(parts.next()?)?;
    let repo = non_empty(parts.next()?)?;
    let kind = match parts.next()? {
        "pull" => GithubKind::Pr,
        "issues" => GithubKind::Issue,
        _ => return None,
    };
    // The number segment may carry a trailing slug/query/fragment; take its leading digits.
    let digits: String = parts.next()?.chars().take_while(|c| c.is_ascii_digit()).collect();
    let number: u64 = digits.parse().ok()?;
    Some(GithubRef { kind, owner, repo, number })
}

// Parse "owner/repo" from a git origin remote URL: SSH (git@github.com:owner/repo.git) or HTTPS/ssh:// forms.
pub fn parse_owner_repo(remote_url: &str) -> Option<(String, String)> {
    let s = remote_url.trim();
    // SSH uses "github.com:owner/…"; HTTPS and ssh:// use "github.com/owner/…".
    let rest = s.split_once("github.com:").or_else(|| s.split_once("github.com/")).map(|(_, r)| r)?;
    let mut parts = rest.split('/');
    let owner = non_empty(parts.next()?)?;
    let repo = non_empty(parts.next()?)?;
    Some((owner, strip_git_suffix(&repo)))
}

// Pick the known repo path whose (owner, repo) matches the ref, case-insensitively. candidates: (path, owner, repo).
pub fn select_repo(r: &GithubRef, candidates: &[(String, String, String)]) -> Option<String> {
    candidates
        .iter()
        .find(|(_, o, rp)| o.eq_ignore_ascii_case(&r.owner) && rp.eq_ignore_ascii_case(&r.repo))
        .map(|(path, _, _)| path.clone())
}

// Some(owned) if the segment is non-empty, else None.
fn non_empty(s: &str) -> Option<String> {
    if s.is_empty() { None } else { Some(s.to_string()) }
}

// Fetch the referenced PR/issue context via the gh CLI (reuses gh auth). Err on gh-missing / not-found / no-access.
pub fn fetch_github(r: &GithubRef) -> Result<GithubContext, String> {
    let repo = format!("{}/{}", r.owner, r.repo);
    let number = r.number.to_string();
    // PR carries branch/base fields; an issue does not.
    let (sub, fields) = match r.kind {
        GithubKind::Pr => ("pr", "title,body,headRefName,baseRefName,url,number"),
        GithubKind::Issue => ("issue", "title,body,url,number"),
    };
    let out = run_gh(&[sub, "view", &number, "--repo", &repo, "--json", fields])?;
    parse_gh_json(&out, &r.kind)
}

// Resolve the ref's owner/repo to one of the known repo paths via each repo's origin remote. Err if none match.
pub fn match_repo(r: &GithubRef, repo_paths: &[String]) -> Result<String, String> {
    // Build (path, owner, repo) candidates, skipping repos without a GitHub origin.
    let candidates: Vec<(String, String, String)> = repo_paths
        .iter()
        .filter_map(|p| origin_owner_repo(p).map(|(o, rp)| (p.clone(), o, rp)))
        .collect();
    select_repo(r, &candidates).ok_or_else(|| {
        let kind = match r.kind { GithubKind::Pr => "PR", GithubKind::Issue => "issue" };
        format!("this {kind} is for {}/{}, which isn't one of your known repos — add it above", r.owner, r.repo)
    })
}

// Parse gh's --json output into a GithubContext (branch/base present only for a PR).
fn parse_gh_json(stdout: &str, kind: &GithubKind) -> Result<GithubContext, String> {
    let v: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|e| format!("couldn't parse gh output: {e}"))?;
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let (branch, base) = match kind {
        GithubKind::Pr => (non_empty(&get("headRefName")), non_empty(&get("baseRefName"))),
        GithubKind::Issue => (None, None),
    };
    Ok(GithubContext { title: get("title"), body: get("body"), url: get("url"), branch, base })
}

// Read a repo's origin remote URL via git and parse owner/repo; None if no git/remote/GitHub match.
fn origin_owner_repo(repo_path: &str) -> Option<(String, String)> {
    let out = Command::new("git")
        .args(["-C", repo_path, "remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_owner_repo(String::from_utf8_lossy(&out.stdout).trim())
}

// Run a gh subcommand with a hard timeout; returns stdout, or an Err carrying gh's stderr.
pub(crate) fn run_gh(args: &[&str]) -> Result<String, String> {
    let mut child = Command::new("gh")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("gh CLI not found: {e}"))?;
    match child.wait_timeout(GH_TIMEOUT).map_err(|e| e.to_string())? {
        None => {
            let _ = child.kill();
            Err("gh timed out".into())
        }
        Some(status) => {
            let mut out = String::new();
            if let Some(mut so) = child.stdout.take() {
                let _ = so.read_to_string(&mut out);
            }
            if !status.success() {
                let mut err = String::new();
                if let Some(mut se) = child.stderr.take() {
                    let _ = se.read_to_string(&mut err);
                }
                return Err(format!("gh failed: {}", err.trim()));
            }
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_github_ref_matches_pr_and_issue_urls() {
        let pr = detect_github_ref("please review https://github.com/elder/cockpit/pull/42 today").unwrap();
        assert_eq!(pr, GithubRef { kind: GithubKind::Pr, owner: "elder".into(), repo: "cockpit".into(), number: 42 });
        let iss = detect_github_ref("https://github.com/elder/cockpit/issues/7").unwrap();
        assert_eq!(iss.kind, GithubKind::Issue);
        assert_eq!(iss.number, 7);
        // Trailing slug/query/fragment after the number is tolerated.
        let slug = detect_github_ref("github.com/a/b/pull/123/files?w=1").unwrap();
        assert_eq!(slug.number, 123);
        // Non-PR/issue GitHub URLs and plain prompts are not refs.
        assert_eq!(detect_github_ref("https://github.com/elder/cockpit"), None);
        assert_eq!(detect_github_ref("fix the login bug"), None);
    }

    #[test]
    fn parse_owner_repo_handles_ssh_and_https() {
        assert_eq!(parse_owner_repo("git@github.com:elder/cockpit.git"), Some(("elder".into(), "cockpit".into())));
        assert_eq!(parse_owner_repo("https://github.com/elder/cockpit.git"), Some(("elder".into(), "cockpit".into())));
        assert_eq!(parse_owner_repo("https://github.com/elder/cockpit"), Some(("elder".into(), "cockpit".into())));
        assert_eq!(parse_owner_repo("git@gitlab.com:x/y.git"), None); // not github
    }

    #[test]
    fn select_repo_matches_case_insensitively() {
        let r = GithubRef { kind: GithubKind::Pr, owner: "Elder".into(), repo: "Cockpit".into(), number: 1 };
        let cands = vec![
            ("/p/other".to_string(), "elder".to_string(), "elsewhere".to_string()),
            ("/p/cockpit".to_string(), "elder".to_string(), "cockpit".to_string()),
        ];
        assert_eq!(select_repo(&r, &cands), Some("/p/cockpit".into()));
        assert_eq!(select_repo(&r, &cands[..1]), None);
    }

    #[test]
    fn parse_gh_json_reads_pr_and_issue_shapes() {
        let pr = r#"{"title":"Fix login","body":"details","url":"https://github.com/a/b/pull/9","headRefName":"fix-login","baseRefName":"main","number":9}"#;
        let c = parse_gh_json(pr, &GithubKind::Pr).unwrap();
        assert_eq!(c.title, "Fix login");
        assert_eq!(c.branch.as_deref(), Some("fix-login"));
        assert_eq!(c.base.as_deref(), Some("main"));
        // Issue: no branch/base.
        let iss = r#"{"title":"Bug","body":"b","url":"https://github.com/a/b/issues/3","number":3}"#;
        let ci = parse_gh_json(iss, &GithubKind::Issue).unwrap();
        assert_eq!(ci.title, "Bug");
        assert_eq!(ci.branch, None);
        assert_eq!(ci.base, None);
    }

    #[test]
    fn parse_gh_json_pr_with_missing_branch_fields_is_none() {
        let pr = r#"{"title":"T","body":"b","url":"https://github.com/a/b/pull/9","number":9}"#;
        let c = parse_gh_json(pr, &GithubKind::Pr).unwrap();
        assert_eq!(c.branch, None);
        assert_eq!(c.base, None);
    }
}
