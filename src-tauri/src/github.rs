//! github.rs — GitHub source provider: detects PR/issue URLs, fetches their context via the gh CLI, and maps owner/repo to a known local repo.

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
fn parse_github_url(token: &str) -> Option<GithubRef> {
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
}
