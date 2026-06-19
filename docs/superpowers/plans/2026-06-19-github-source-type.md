# GitHub Source Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GitHub PR or issue URL in the new-worktree prompt be resolved — via the already-authenticated `gh` CLI, fetched in Rust — into context that drives the existing plain deduction, with the repo resolved deterministically from `knownRepos`, a PR checking out its existing branch (an issue getting a new branch), and the PR/issue link auto-added to the created worktree.

**Architecture:** A new `github.rs` module owns GitHub-specific work: detect a PR/issue URL (pure), fetch its context via `gh ... --json` (IO), and map `owner/repo` to a known local repo via each repo's `origin` remote (IO + pure parse). `deduce.rs` stays the orchestrator: a small `Source` enum branches `deduce_worktree`; on a GitHub ref it fetches + matches, folds the fetched context into the **plain, tool-less** agent call (no MCP, no new schema/prompt), then deterministically **overrides** the authoritative fields (`repoPath`; for a PR its branch/base/mode; the source link). The staged-link fields are renamed source-neutral (`ticketUrl/ticketTitle` → `sourceUrl/sourceTitle`, `ticketLinkFrom` → `sourceLinkFrom`).

**Tech Stack:** Tauri v2, Rust (`std::process::Command` + `wait-timeout`, `serde_json` — hand-rolled URL/remote parsing, no `regex` crate), the `gh` CLI, React 19 + TS, Zustand, Vitest.

## Global Constraints

- **Learning project:** one-line role comment at the top of every file; one-line intent comment atop each significant block. High-signal only — explain intent, not syntax.
- **Minimalism:** smallest thing that works; **no new dependencies** (URL/remote parsing is hand-rolled, like the Linear ref parsing); one new file (`github.rs`).
- **Dual-definition discipline:** persisted/IPC shapes exist as a Rust serde struct AND a mirrored TS type (camelCase via `#[serde(rename)]`).
- **Backward-compatible:** new/renamed `DeducedWorktree` fields use `#[serde(default)]` so the plain/Linear narrower JSON still deserializes. `cockpit.json` `version` stays `1`; `Worktree` model unchanged.
- **IPC unchanged:** `deduce_worktree(prompt: String, repo_paths: Vec<String>)` keeps its signature; the plain-prompt and Linear paths stay byte-identical (same system prompt, same schema, same model, same tools).
- **Never silent / never fabricate:** deduce only fills the form; only the user-clicked Create makes a worktree. A `gh` failure or an unknown repo returns an `Err` (inline) and leaves manual entry working — the GitHub repo is never guessed.
- **Reuse `gh` auth:** the PR/issue fetch shells out to the already-authenticated `gh` CLI; no API key, no in-app GitHub auth, no MCP on this path.
- **Local-only this iteration:** a ref whose `owner/repo` isn't a known local repo errors inline (→ add via `KnownReposEditor`). The no-local "remote-review" mode is a deferred sub-project (spec §G).
- **Source-neutral naming:** the staged-link fields and helper are renamed `source*`; Linear's prompt *prose* keeps its `ticket` wording; GitHub strings live in `github.rs`.
- **Tests:** Rust `cd src-tauri && cargo test`; frontend `npm test` (Vitest). Headless build checks: `cargo build`, `npm run build`, `npx tsc --noEmit`. GUI the user eyeballs.

## Verified facts (confirmed during brainstorming)

- `gh` 2.83 is installed and authenticated. PR `--json` exposes `title, body, headRefName, baseRefName, url, number, state`; issue exposes `title, body, url, number, state`. These field names are used verbatim in Task 4.
- Rust modules are declared in `src-tauri/src/lib.rs` (`mod deduce; mod pty; mod worktree;`). Task 3 adds `mod github;` there.
- The plain deduce agent (`SYSTEM_PROMPT` + `DEDUCE_SCHEMA`, haiku, no tools) was smoke-tested in sub-project 3. The GitHub path reuses it unchanged, so **it needs no new paid smoke test.**

---

## File Structure

- `src-tauri/src/github.rs` (create) — `GithubKind`, `GithubRef`, `GithubContext`; pure `detect_github_ref`, `parse_owner_repo`, `select_repo`, `parse_gh_json`; IO `fetch_github`, `match_repo` (+ private `run_gh`, `origin_owner_repo`, `parse_github_url`).
- `src-tauri/src/lib.rs` (modify) — add `mod github;`.
- `src-tauri/src/deduce.rs` (modify) — rename the three ticket fields → source fields; add `existing_branch`; `Source` enum + `detect_source`; pure `compose_user_github` + `apply_github_overrides`; the GitHub branch in `deduce_worktree`.
- `src/worktrees/api.ts` (modify) — rename `ticketUrl/ticketTitle` → `sourceUrl/sourceTitle`; add optional `existingBranch?`.
- `src/worktrees/model.ts` (modify) — rename `ticketLinkFrom` → `sourceLinkFrom`.
- `src/worktrees/model.test.ts` (modify) — rename helper + fields in tests.
- `src/tiles/worktree/NewWorktreeForm.tsx` (modify) — use `sourceLinkFrom`; set `mode` from `existingBranch`; source-aware banner.
- `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (modify) — as-built notes + status.

---

### Task 1: Verification facts — pin Linear consts (human, paid) + confirm the `gh` contract (agent, free)

Two independent verifications. **(a)** resolves the deferred Linear smoke the user asked about; it is **human-run** (the agent's Bash-spawned `claude` is not logged into the Linear MCP) and gates **nothing** in this GitHub plan — do it any time. **(b)** is agent-runnable, read-only, and confirms the `gh` JSON contract Task 4 depends on. No code ships here.

**Files:** none (records results in this block).

- [ ] **Step 1 (human, paid ~$0.08): pin Linear `LINEAR_*`**

Run the Linear smoke from `docs/superpowers/plans/2026-06-18-linear-source-type.md` Task 1 (Steps 1–3) against a real ticket with the Linear MCP connected. Record in *that* plan's "Verified CLI facts" block, and update the `LINEAR_ALLOWED_TOOLS` / `LINEAR_MODEL` consts in `src-tauri/src/deduce.rs` if the smoke shows the current guesses (`mcp__linear`, `claude-haiku-4-5`) are wrong. If they're already correct, note "confirmed" and change nothing.

- [ ] **Step 2 (agent, free): confirm the `gh` JSON field names**

Run against any public repo you can read:

```bash
gh pr view 1 --repo cli/cli --json title,body,headRefName,baseRefName,url,number >/dev/null && echo "PR fields OK"
gh issue view 1 --repo cli/cli --json title,body,url,number >/dev/null && echo "issue fields OK"
```

Expected: both print "… OK". If a field is rejected, gh lists the valid names — reconcile with Task 4's field lists before proceeding.

- [ ] **Step 3: commit any const change from Step 1 (only if you changed one)**

```bash
git add src-tauri/src/deduce.rs docs/superpowers/plans/2026-06-18-linear-source-type.md
git commit -m "chore(deduce): pin Linear MCP consts from live smoke"
```

---

### Task 2: Rename the staged-link fields source-neutral (Rust + TS refactor)

Now that a second source exists, rename `ticketUrl/ticketTitle` → `sourceUrl/sourceTitle` and `ticketLinkFrom` → `sourceLinkFrom` everywhere they form the IPC contract — the Rust struct + serde names, the Linear ticket **schema** and the **field-name references** in the Linear prompts (so the agent still emits fields that match the schema), the TS type, the model helper, and its call site in the form. Linear's conceptual *prose* ("Linear ticket") stays. Pure refactor: no behavior change, all tests green.

**Files:**
- Modify: `src-tauri/src/deduce.rs`
- Modify: `src/worktrees/api.ts`
- Modify: `src/worktrees/model.ts`
- Modify: `src/worktrees/model.test.ts`
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx`

**Interfaces:**
- Produces (Rust): `DeducedWorktree.source_url` (`sourceUrl`), `source_title` (`sourceTitle`) — both `#[serde(default)]`; `source_resolved` unchanged.
- Produces (TS): `DeducedWorktree.sourceUrl?`, `sourceTitle?`; `sourceLinkFrom(d) -> WorktreeLink | null`.

- [ ] **Step 1: Rename the Rust struct fields**

In `src-tauri/src/deduce.rs`, change the `DeducedWorktree` field block:

```rust
    // Source-context fields: populated only on a source path; default so the plain path's JSON still deserializes.
    #[serde(rename = "sourceUrl", default)]
    pub source_url: String,
    #[serde(rename = "sourceTitle", default)]
    pub source_title: String,
    #[serde(rename = "sourceResolved", default)]
    pub source_resolved: bool,
```

- [ ] **Step 2: Rename the fields inside the Linear ticket schema + prompts**

In `src-tauri/src/deduce.rs`:

In `DEDUCE_SCHEMA_TICKET`, replace the two property keys and the two `required` entries `"ticketUrl"`/`"ticketTitle"` with `"sourceUrl"`/`"sourceTitle"` (leave `"sourceResolved"`):

```rust
const DEDUCE_SCHEMA_TICKET: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"sourceResolved":{"type":"boolean"}},"required":["repoPath","name","branch","base","startCmd","address","reason","sourceUrl","sourceTitle","sourceResolved"],"additionalProperties":false}"#;
```

In `SYSTEM_PROMPT_TICKET`, change `Set ticketUrl and ticketTitle from the fetched ticket` to `Set sourceUrl and sourceTitle from the fetched ticket`.

In `compose_user_ticket`, change `and set ticketUrl/ticketTitle/sourceResolved accordingly.` to `and set sourceUrl/sourceTitle/sourceResolved accordingly.`

- [ ] **Step 3: Update the Rust tests that name the fields**

In `src-tauri/src/deduce.rs` `tests`:

In `validate_repo_enforces_membership`, rename the two literal fields:

```rust
        let d = DeducedWorktree {
            repo_path: "/a".into(), name: "n".into(), branch: "b".into(), base: "main".into(),
            start_cmd: "c".into(), address: "x".into(), reason: "r".into(),
            source_url: "".into(), source_title: "".into(), source_resolved: false,
        };
```

Replace `parse_envelope_reads_ticket_fields_and_defaults_them` with the renamed version:

```rust
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
```

- [ ] **Step 4: Rename the TS type + helper + form call**

In `src/worktrees/api.ts`, rename the two optional fields:

```ts
  sourceUrl?: string;
  sourceTitle?: string;
  sourceResolved?: boolean;
```

In `src/worktrees/model.ts`, rename the helper (reads the renamed fields):

```ts
// Build the worktree link to attach from a deduction, or null when no source was resolved.
export function sourceLinkFrom(d: DeducedWorktree): WorktreeLink | null {
  if (!d.sourceUrl) return null;
  return { label: d.sourceTitle || d.sourceUrl, url: d.sourceUrl };
}
```

In `src/worktrees/model.test.ts`, update the top comment + import line and replace the `ticketLinkFrom` describe block (leave the `makeWorktree` and `links reducers` blocks untouched):

```ts
// model.test.ts — pure worktree helpers (existing link reducers + source link construction from a deduction).
import { describe, it, expect } from "vitest";
import { makeWorktree, addLink, updateLink, removeLink, sourceLinkFrom } from "./model";
```

```ts
describe("sourceLinkFrom", () => {
  it("returns null when there is no source url", () => {
    expect(sourceLinkFrom(deducedBase)).toBeNull();
  });
  it("uses the source title as the link label", () => {
    expect(sourceLinkFrom({ ...deducedBase, sourceUrl: "https://linear.app/x", sourceTitle: "Fix login" }))
      .toEqual({ label: "Fix login", url: "https://linear.app/x" });
  });
  it("falls back to the url when there is no title", () => {
    expect(sourceLinkFrom({ ...deducedBase, sourceUrl: "https://linear.app/x" }))
      .toEqual({ label: "https://linear.app/x", url: "https://linear.app/x" });
  });
});
```

In `src/tiles/worktree/NewWorktreeForm.tsx`, update the import and the one call site:

```tsx
import { makeWorktree, sourceLinkFrom } from "../../worktrees/model";
```
```tsx
      const tl = sourceLinkFrom(d);
```

(Leave the `ticketLink` state and `banner.ticket` as they are — Task 7 renames them along with the behavior change.)

- [ ] **Step 5: Run all tests + type-check**

Run: `cd src-tauri && cargo test && cd .. && npm test && npx tsc --noEmit`
Expected: all green; no `ticketUrl`/`ticketTitle`/`ticketLinkFrom` references remain (`grep -rn "ticketUrl\|ticketTitle\|ticketLinkFrom" src src-tauri/src` returns nothing).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/deduce.rs src/worktrees/api.ts src/worktrees/model.ts src/worktrees/model.test.ts src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "refactor: rename staged-link fields ticket* -> source* (source-neutral)"
```

---

### Task 3: `github.rs` — pure detection + parsing (TDD)

The risky, deterministic GitHub logic, fully unit-tested without any IO: the types, PR/issue URL detection, the `owner/repo` remote-URL parser, and the repo selector.

**Files:**
- Create: `src-tauri/src/github.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `pub enum GithubKind { Pr, Issue }`; `pub struct GithubRef { kind, owner: String, repo: String, number: u64 }`; `pub struct GithubContext { title, body, url: String, branch: Option<String>, base: Option<String> }`.
- Produces (pure): `detect_github_ref(&str) -> Option<GithubRef>`, `parse_owner_repo(&str) -> Option<(String, String)>`, `select_repo(&GithubRef, &[(String, String, String)]) -> Option<String>`.

- [ ] **Step 1: Register the module**

In `src-tauri/src/lib.rs`, add next to the other module declarations:

```rust
mod github;
```

- [ ] **Step 2: Create `github.rs` with the types + failing tests**

Create `src-tauri/src/github.rs`:

```rust
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test github::`
Expected: FAIL to compile — `detect_github_ref`, `parse_owner_repo`, `select_repo` not defined.

- [ ] **Step 4: Implement the pure helpers**

In `src-tauri/src/github.rs`, add above the `tests` module:

```rust
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test github::`
Expected: PASS — the three new tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/github.rs src-tauri/src/lib.rs
git commit -m "feat(github): types + pure PR/issue URL detection, owner/repo + repo-select helpers"
```

---

### Task 4: `github.rs` — `gh` fetch + repo match (IO) + JSON parse (TDD)

The IO wrappers the orchestrator needs: fetch the PR/issue via `gh`, and resolve `owner/repo` to a known repo by reading each repo's `origin` remote. The JSON parsing (`parse_gh_json`) is pure and unit-tested; the shell wrappers are thin and verified by the Task 1 `gh` check + the GUI acceptance.

**Files:**
- Modify: `src-tauri/src/github.rs`

**Interfaces:**
- Consumes: `select_repo`, `parse_owner_repo` (Task 3).
- Produces (IO): `fetch_github(&GithubRef) -> Result<GithubContext, String>`, `match_repo(&GithubRef, &[String]) -> Result<String, String>`.

- [ ] **Step 1: Write the failing test for `parse_gh_json`**

In `src-tauri/src/github.rs` `tests`, add:

```rust
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test github::parse_gh_json`
Expected: FAIL to compile — `parse_gh_json` not defined.

- [ ] **Step 3: Implement the IO wrappers + the pure parser**

In `src-tauri/src/github.rs`, add the imports at the top (below the doc comment) and the functions above `tests`:

```rust
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

const GH_TIMEOUT: Duration = Duration::from_secs(30); // gh calls are quick; generous ceiling.
```

```rust
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
        GithubKind::Pr => (Some(get("headRefName")), Some(get("baseRefName"))),
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
fn run_gh(args: &[&str]) -> Result<String, String> {
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
```

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test github:: && cargo build`
Expected: all `github::tests` pass; crate builds (warnings about unused `fetch_github`/`match_repo` are expected until Task 6 wires them — acceptable for this task).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/github.rs
git commit -m "feat(github): gh-CLI fetch + deterministic owner/repo->knownRepo match"
```

---

### Task 5: `deduce.rs` — `Source` enum, `existing_branch`, and the pure GitHub override logic (TDD)

The deterministic deduction-side logic, unit-tested without IO: the `Source` branch point, the new `existing_branch` field, the GitHub user-prompt composer, and the field-override helper (the risky part — PR vs issue behavior).

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Consumes: `crate::github::{GithubKind, GithubRef, GithubContext}`; existing `compose_user`, `truncate`, `ensure_ref_prefix`.
- Produces (Rust): `DeducedWorktree.existing_branch: bool` (`existingBranch`, default); `detect_source(&str) -> Source`; `compose_user_github(&str, &GithubContext, &[Value]) -> String`; `apply_github_overrides(DeducedWorktree, &GithubRef, &GithubContext, &str, Option<String>) -> DeducedWorktree`.

- [ ] **Step 1: Add the `existing_branch` field**

In `src-tauri/src/deduce.rs`, add to `DeducedWorktree` after `source_resolved`:

```rust
    #[serde(rename = "existingBranch", default)]
    pub existing_branch: bool,
```

Then add `existing_branch: false,` to the `DeducedWorktree` literal in the `validate_repo_enforces_membership` test (now: `source_url`, `source_title`, `source_resolved`, `existing_branch`).

- [ ] **Step 2: Write the failing tests for the new pure helpers**

In `src-tauri/src/deduce.rs` `tests`, add:

```rust
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test deduce::`
Expected: FAIL to compile — `Source`, `detect_source`, `compose_user_github`, `apply_github_overrides` not defined.

- [ ] **Step 4: Implement the helpers**

In `src-tauri/src/deduce.rs`, add near the top a `use` for the github types and, after `compose_user_ticket`, the new helpers:

```rust
use crate::github::{self, GithubContext, GithubRef};
```

```rust
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test deduce::`
Expected: PASS — all existing `deduce::tests` plus the four new ones. (`Source`/`compose_user_github`/`apply_github_overrides` are unused outside tests until Task 6 — `cargo test` tolerates this; the dead-code warning clears in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): Source enum + existing_branch + pure GitHub prompt/override helpers"
```

---

### Task 6: `deduce.rs` — wire the GitHub branch into `deduce_worktree` (IO orchestration)

Replace the `detect_linear_ref` branch with a `detect_source` match: the plain and Linear arms are byte-identical to today; the new GitHub arm fetches via `gh`, matches the repo, runs the **plain** agent with the folded context, then applies the overrides.

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Consumes: Task 4 (`github::fetch_github`, `github::match_repo`), Task 5 (`detect_source`, `compose_user_github`, `apply_github_overrides`); existing `run_claude`, `compose_user`/`compose_user_ticket`, `parse_envelope`, `validate_repo`, `default_branch`.
- Produces (IPC, unchanged signature): `deduce_worktree(prompt, repo_paths) -> Result<DeducedWorktree, String>` — now GitHub-aware.

- [ ] **Step 1: Replace the body of `deduce_worktree`**

In `src-tauri/src/deduce.rs`, replace the current `deduce_worktree` body (the `let detected = detect_linear_ref(...)` block through the final `Ok(deduced)`) with:

```rust
#[tauri::command]
pub fn deduce_worktree(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String> {
    if repo_paths.is_empty() {
        return Err("no known repos configured".into());
    }
    let digests: Vec<serde_json::Value> = repo_paths.iter().map(|p| read_repo_digest(p)).collect();

    // One branch point: a GitHub URL, a Linear ref, or a plain prompt.
    match detect_source(&prompt) {
        // GitHub: fetch + match in Rust, run the PLAIN agent with the gh context, then override authoritative fields.
        Source::GitHub(r) => {
            let ctx = github::fetch_github(&r)?;
            let repo_path = github::match_repo(&r, &repo_paths)?;
            let stdout = run_claude(ClaudeCall {
                user_prompt: &compose_user_github(&prompt, &ctx, &digests),
                system_prompt: SYSTEM_PROMPT,
                schema: DEDUCE_SCHEMA,
                model: "claude-haiku-4-5",
                allowed_tools: None,
            })?;
            let deduced = parse_envelope(&stdout)?;
            // Issue branches off the git default; PR uses the PR's own base (handled in apply_github_overrides).
            let base_default = default_branch(&repo_path);
            Ok(apply_github_overrides(deduced, &r, &ctx, &repo_path, base_default))
        }
        // Linear: MCP-enabled ticket path (unchanged from the Linear iteration).
        Source::Linear(id) => {
            let stdout = run_claude(ClaudeCall {
                user_prompt: &compose_user_ticket(&prompt, &id, &digests),
                system_prompt: SYSTEM_PROMPT_TICKET,
                schema: DEDUCE_SCHEMA_TICKET,
                model: LINEAR_MODEL,
                allowed_tools: Some(LINEAR_ALLOWED_TOOLS),
            })?;
            let mut deduced = validate_repo(parse_envelope(&stdout)?, &repo_paths)?;
            if let Some(b) = default_branch(&deduced.repo_path) {
                deduced.base = b;
            }
            if !deduced.source_resolved {
                return Err(format!("couldn't resolve Linear ticket {id} (is the Linear MCP connected?)"));
            }
            deduced.branch = ensure_ref_prefix(&deduced.branch, &id.to_lowercase());
            deduced.name = ensure_ref_prefix(&deduced.name, &id);
            Ok(deduced)
        }
        // Plain: byte-identical to before (no tools, haiku).
        Source::Plain => {
            let stdout = run_claude(ClaudeCall {
                user_prompt: &compose_user(&prompt, &digests),
                system_prompt: SYSTEM_PROMPT,
                schema: DEDUCE_SCHEMA,
                model: "claude-haiku-4-5",
                allowed_tools: None,
            })?;
            let mut deduced = validate_repo(parse_envelope(&stdout)?, &repo_paths)?;
            if let Some(b) = default_branch(&deduced.repo_path) {
                deduced.base = b;
            }
            Ok(deduced)
        }
    }
}
```

- [ ] **Step 2: Build + run tests**

Run: `cd src-tauri && cargo test && cargo build`
Expected: all tests pass; crate builds warning-clean (the GitHub helpers and `Source` are now used).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): GitHub branch in deduce_worktree (gh fetch + match + overrides)"
```

---

### Task 7: Frontend — `existingBranch` type, branch-mode mapping, source-aware banner

Mirror the new Rust field in TS and finish the form: drive the `BranchSpec` mode from `existingBranch`, rename the staged-link state to `source*`, and make the banner source-aware (it shows the link, and for a PR notes the branch being checked out).

**Files:**
- Modify: `src/worktrees/api.ts`
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx`

**Interfaces:**
- Consumes: `sourceLinkFrom` (Task 2); `DeducedWorktree.existingBranch?`, `branch` (Task 6 output).

- [ ] **Step 1: Add `existingBranch?` to the TS type**

In `src/worktrees/api.ts`, add to `DeducedWorktree` (optional — plain/Linear omit it):

```ts
  existingBranch?: boolean;
```

- [ ] **Step 2: Rename the staged-link state to `source*`**

In `src/tiles/worktree/NewWorktreeForm.tsx`, rename the state hook and widen the banner type to carry the source link + branch info:

```tsx
  const [sourceLink, setSourceLink] = useState<WorktreeLink | null>(null);
  const [banner, setBanner] = useState<{ prompt: string; repoPath: string; reason: string; hostFromSaved: boolean; source: WorktreeLink | null; existingBranch: boolean; branch: string } | null>(null);
```

- [ ] **Step 3: Drive mode + banner from the deduction in `runDeduce`**

In `runDeduce`, replace the hardcoded `setMode("new")` with the `existingBranch`-driven mode, and replace the `sourceLinkFrom`/`setBanner` block:

```tsx
      setMode(d.existingBranch ? "existing" : "new");
      const sl = sourceLinkFrom(d);
      setSourceLink(sl);
      setBanner({ prompt, repoPath: d.repoPath, reason: d.reason, hostFromSaved: !!(saved?.startCmd && saved?.address), source: sl, existingBranch: !!d.existingBranch, branch: d.branch });
```

- [ ] **Step 4: Make the banner JSX source-aware**

In the banner block, replace the old `{banner.ticket && …}` line with:

```tsx
          {banner.source && <><br />🔗 {banner.source.label} — link will be added.</>}
          {banner.existingBranch && <><br />will check out existing branch <strong>{banner.branch}</strong>.</>}
```

- [ ] **Step 5: Attach the link on Create**

In `submit`, change the `links` line to use the renamed state:

```tsx
        links: sourceLink ? [sourceLink] : [],
```

- [ ] **Step 6: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; no `ticketLink`/`banner.ticket` references remain (`grep -rn "ticketLink\|banner.ticket" src` returns nothing).

- [ ] **Step 7: Commit**

```bash
git add src/worktrees/api.ts src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "feat(tile): existingBranch mode mapping + source-aware banner for GitHub refs"
```

---

### Task 8: Docs + acceptance

Full headless verification, as-built/status updates, and manual GUI acceptance.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`

- [ ] **Step 1: Full headless verification**

Run:
```bash
cd src-tauri && cargo test && cargo build && cd .. && npm test && npx tsc --noEmit && npm run build
```
Expected: all Rust + JS tests green; both builds succeed. If anything fails, STOP and report BLOCKED — do not patch code in a docs task.

- [ ] **Step 2: Update as-built docs**

In `CLAUDE.md` under "As-built notes", add a GitHub source type entry: `deduce_worktree` detects a GitHub PR/issue **URL** via pure `github::detect_github_ref`; on a hit it fetches the PR/issue via the already-authenticated `gh` CLI (`gh pr|issue view --json …` in `github.rs`, no MCP), resolves `owner/repo` to a known repo deterministically by matching each repo's `origin` remote (inline error if unknown — local-only), folds the fetched title/body into the **plain** agent call, then overrides the authoritative fields (`repoPath`; PR → existing `headRefName`/`baseRefName` + `pr-<N>` in name; issue → new branch with `issue-<N>` in name+branch). The staged-link fields are now source-neutral (`sourceUrl`/`sourceTitle`/`sourceLinkFrom`); `existingBranch` drives the `BranchSpec` mode; the resolved link auto-attaches on Create. Note the deferred GitHub cells (remote-review-only mode, filesystem auto-find, `owner/repo#N` shorthand, PR fast-path) per spec §G. Under "Status", mark the GitHub source type complete and point "Next" at the Slack source type.

In `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`, under decomposition item 3, mark GitHub done and Slack as the next (last) source-type iteration; note `gh`-reuse (decision 4) as realized.

- [ ] **Step 3: Manual GUI acceptance (ask the user to eyeball)**

Run: `npm run tauri dev` (blocking, opens the native window). Ask the user to confirm:
1. With the relevant repo in `knownRepos`, paste a real **PR URL** → **deduce** → repo + **existing** branch (the PR's `headRefName`) + base fill, name contains `pr-<N>`, the banner shows the title and "will check out existing branch …" → **Create** → the worktree tile shows the PR link, on the PR's branch.
2. Paste an **issue URL** → new branch containing `issue-<N>`, banner shows the link → Create → tile shows the issue link.
3. Paste a PR/issue URL for a repo **not in `knownRepos`** → inline error ("… isn't one of your known repos — add it above"); form still usable manually.
4. A plain prompt and a Linear ref still deduce exactly as before (no regression).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "docs: as-built notes + status for the GitHub source type"
```

---

## Notes for the implementer

- **`gh`-in-Rust, not MCP.** Unlike Linear, the GitHub fetch is deterministic Rust (`github::fetch_github`), and the agent stays the *plain* tool-less one. There is no `--allowedTools`, no new schema, no new system prompt on this path — only a richer user prompt + Rust overrides.
- **Never fabricate the repo.** `match_repo` resolves `owner/repo` from real `origin` remotes; if nothing matches it's an `Err`, never a guess. This is the GitHub analogue of Linear's `sourceResolved` guardrail (here the guarantee is even stronger — Rust knows the fetch and the match succeeded).
- **PR branch is untouched.** For a PR, `branch = headRefName` is left exactly as GitHub reports it so the worktree checkout matches the remote — `ensure_ref_prefix` is applied to the *name* only (`pr-<N>`), never the PR's branch. Only the issue path pins the id into both name and branch.
- **Plain + Linear paths must stay byte-identical.** The `Source::Plain` and `Source::Linear` arms reproduce today's exact calls (system prompt, schema, model, tools, guardrail). Verify no regression there.
- **The rename (Task 2) is contract-wide.** `ticketUrl/ticketTitle` are renamed in the Rust struct, the Linear ticket *schema*, the Linear *prompt field-name references*, the TS type, and the model helper — a half-rename would make the Linear agent emit fields the schema rejects. Grep to confirm none remain.
- **No new deps, one new file (`github.rs`), no IPC signature change.**
