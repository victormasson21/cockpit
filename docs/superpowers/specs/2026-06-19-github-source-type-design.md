# Cockpit — GitHub Source Type (sub-project 3, iteration 2) — Design

> Status: approved (brainstorming), ready for an implementation plan.
> Second of the deduction **source types** (Linear → **GitHub** → Slack, one at a
> time). A GitHub PR or issue URL in the new-worktree prompt is resolved — via the
> already-authenticated `gh` CLI — into context that feeds the **same** deduction
> agent, and the PR/issue link auto-populates the new worktree's links. Flow stays
> **deduce → preview/confirm → create, never silent**.
>
> Builds on the Linear iteration: `2026-06-18-linear-source-type-design.md` (this
> plugs into the source seam it left — §G there). Product vision:
> `2026-06-16-cockpit-product-spec.md` (Right column — worktrees; decomposition
> item 3; cross-cutting decisions 3 & 4; Authentication). Stack & conventions:
> `../../../CLAUDE.md`.

## Goal

Let the user paste a **GitHub PR or issue URL** (`github.com/<owner>/<repo>/pull/<N>`
or `.../issues/<N>`) into the existing new-worktree prompt box. Cockpit detects
the ref, **fetches its context via `gh`** (title / body / branch info), feeds it to
the **same plain deduction agent** so the worktree name (and, for an issue, the
branch) are deduced from it, resolves the repo deterministically, and **auto-adds
the PR/issue link** to the created worktree. A **PR checks out its existing
branch**; an **issue gets a new branch** (exactly Linear's shape). Everything else
(base-from-git, saved host defaults, preview/confirm, manual editability) is
unchanged.

## Keystone decision (locked during brainstorming): the app reuses `gh`, not an MCP

The central question was *how Cockpit reads GitHub*. Linear had to delegate its
fetch into the `claude` subprocess via MCP because the app has no Linear auth.
**GitHub is the opposite: `gh` is already authenticated**, so the fetch is done
**deterministically in Rust** and the result is fed to the **same plain,
tool-less deduction agent** (haiku, no `--allowedTools`, no new schema, no new
system prompt — just a `gh`-context block folded into the user prompt).

This is the analogue of Linear's "the app does not auth to Linear" decision,
resolved the other way *because `gh` exists*. It matches product-spec **decision 4**
("GitHub = reuse `gh`").

Why this is the right MVP and is spec-consistent:

- **`gh` is already authenticated** (the developer is the user) — a sanctioned
  reuse of the dev tool's auth, like Anthropic = reuse Claude Code auth.
- The agent stays **exactly the plain-path agent** — no MCP coupling, no
  GitHub-MCP-must-be-installed dependency, no paid tool-use round-trip.
- `sourceResolved` becomes something **Rust knows for certain** (did `gh` exit 0?),
  not a model self-report — a *stronger* guardrail than Linear's.
- The privileged fetch lives in a **Rust provider** (`github.rs`), matching
  provider+panel — *more* architecturally honest than Linear's subprocess fetch.

**Accepted trade-offs:**

1. The two source types are **not symmetric** (Linear = MCP-in-subprocess, GitHub
   = `gh`-in-Rust). → Accepted: the spec sanctions both; the *reusable seam* (the
   `Source` branch point, the staged link, the banner, `ensure_ref_prefix`, the
   `sourceResolved` concept) is still reused. Only *where the fetch happens* differs.
2. **Local-only this iteration** — a ref whose repo isn't cloned/known errors
   inline. → Accepted and documented: the *no-local-clone* "remote-review-only"
   mode is named as the next sub-project (§G).

## Scope

**In scope**
- Pure Rust ref detection: PR and issue **URLs** (`detect_github_ref`).
- A `gh`-based fetch (`gh pr view` / `gh issue view --json …`) in a narrow new
  `github.rs` module.
- Deterministic `owner/repo` → `knownRepo` resolution by matching each repo's
  `origin` remote; **inline error if no known repo matches** (never fabricate).
- A GitHub branch in `deduce_worktree`: fold `gh` context into the **plain** agent
  call, then Rust **overrides** the authoritative fields (`repoPath`; PR →
  branch/base/mode; the source link).
- **PR → existing branch** (`headRefName`/`baseRefName`); **issue → new branch**
  (agent-proposed, `issue-<N>` pinned via `ensure_ref_prefix`).
- The resolved link auto-populates the worktree's `links` on Create; a banner
  shows it.
- A **rename** of the staged-link fields to source-neutral names
  (`ticketUrl`/`ticketTitle` → `sourceUrl`/`sourceTitle`,
  `ticketLinkFrom` → `sourceLinkFrom`) now that a second source exists.

**Out of scope** (later iterations / sub-projects — named in §G)
- The **remote-review-only worktree** (no local clone): a new tile shape — its
  own sub-project.
- **Filesystem auto-find** of a clone not yet in `knownRepos`.
- `owner/repo#N` shorthand and bare `#N` refs.
- Slack source type — *next iteration, same shape*.
- Skipping the agent for PRs that have a saved host default (a cost optimization).
- Seeding the worktree's Claude terminal with PR context (the deferred idea the
  remote-review mode would need).

## A. Detection — pure, in Rust (`github.rs` + a `Source` enum in `deduce.rs`)

Linear's §G anticipated "one detection point, one branch point." A small `Source`
enum in `deduce.rs` makes that explicit instead of stacked `Option`s:

```rust
// deduce.rs — the resolved kind of source the prompt references (one branch point).
enum Source { GitHub(GithubRef), Linear(String), Plain }

// deduce.rs — detection order: a GitHub URL wins, then a Linear ref, else plain.
fn detect_source(prompt: &str) -> Source
```

The GitHub-specific detection lives in `github.rs`, pure and unit-tested:

```rust
// github.rs
pub enum GithubKind { Pr, Issue }
pub struct GithubRef { pub kind: GithubKind, pub owner: String, pub repo: String, pub number: u64 }

// Some(GithubRef) for a github.com PR/issue URL; None otherwise. Pure, no I/O.
pub fn detect_github_ref(prompt: &str) -> Option<GithubRef>
```

- Matches `github.com/<owner>/<repo>/pull/<N>` (→ `Pr`) and
  `github.com/<owner>/<repo>/issues/<N>` (→ `Issue`). Each URL encodes
  owner/repo + kind + number unambiguously — no extra disambiguation call.
- `owner/repo#N` shorthand and bare `#N` are **not** detected this iteration
  (§G): bare `#N` has no owner/repo, and shorthand would need a pull-vs-issue
  `gh` probe.
- A prompt with no GitHub URL falls through to the Linear detector, then the
  plain path — both **byte-identical to today**.

## B. The `gh` fetch + deterministic repo match — `github.rs` (Rust providers)

Two helpers, both shelling out to already-authenticated tools. Both can fail, and
every failure is surfaced inline — **never fabricated**.

```rust
// github.rs — what `gh` gave us about the referenced PR/issue.
pub struct GithubContext {
    pub title: String,
    pub body: String,
    pub url: String,
    pub branch: Option<String>, // headRefName — Some only for a PR
    pub base: Option<String>,   // baseRefName — Some only for a PR
}

// Fetch the PR/issue context via the gh CLI (reuses gh auth). Err on gh-missing / not-found / no-access.
pub fn fetch_github(r: &GithubRef) -> Result<GithubContext, String>

// Resolve owner/repo to one of the known repo paths by matching each repo's `origin` remote. Err if none match.
pub fn match_repo(r: &GithubRef, repo_paths: &[String]) -> Result<String, String>

// Pure: parse "owner/repo" out of a git remote URL (SSH `git@github.com:owner/repo.git` or HTTPS forms).
pub fn parse_owner_repo(remote_url: &str) -> Option<(String, String)>
```

- **Fetch:**
  - PR → `gh pr view <N> --repo <owner>/<repo> --json title,body,headRefName,baseRefName,url,number`
  - Issue → `gh issue view <N> --repo <owner>/<repo> --json title,body,url,number`
  - (Field names confirmed against `gh` 2.83 during brainstorming.) A hard timeout
    mirrors the deduce timeout. `gh` not found / ticket not found / no access →
    `Err`, surfaced inline.
- **Repo match:** for each known repo, read `git -C <path> remote get-url origin`,
  `parse_owner_repo`, compare **case-insensitively** to the ref's owner/repo.
  First match wins. No match → `Err("this PR/issue is for <owner>/<repo>, which
  isn't one of your known repos — add it above")`. The existing `KnownReposEditor`
  is the fix (never-silent). **Local-only** — `knownRepos` entries are local paths.

## C. Rust `deduce_worktree` — the GitHub branch

The command keeps its signature (`prompt`, `repo_paths`) and its tail. It branches
once on `detect_source`:

```text
detect_source(prompt):
  Plain        -> existing call: SYSTEM_PROMPT + DEDUCE_SCHEMA, haiku, no tools   (UNCHANGED)
  Linear(id)   -> ticket call (UNCHANGED from Linear iteration: MCP-enabled)
  GitHub(r)    -> gh-fetch + repo-match, then the PLAIN agent with gh context folded in,
                  then Rust overrides the authoritative fields
```

The GitHub path, step by step:

1. `let ctx = github::fetch_github(&r)?;` (→ inline `Err` if `gh` fails).
2. `let repo_path = github::match_repo(&r, &repo_paths)?;` (→ inline `Err` if unknown).
3. Compose the user prompt = plain `compose_user(prompt, digests)` **plus a
   `gh`-context block** (the PR/issue title + body; for a PR, a note of its
   branch/base). Run the **plain** agent (`SYSTEM_PROMPT`, `DEDUCE_SCHEMA`, haiku,
   `allowed_tools: None`), then `parse_envelope`.
4. **Rust overrides the fields it knows authoritatively** (same pattern as today's
   `default_branch` override):
   - **Both:** `repo_path` = the matched path; inject `source_url = ctx.url`,
     `source_title = ctx.title`, `source_resolved = true`.
   - **PR:** `branch = ctx.branch` (**untouched** — it must match the remote branch
     for checkout), `base = ctx.base`, `existing_branch = true`;
     `name = ensure_ref_prefix(name, "pr-<N>")`.
   - **Issue:** `base = default_branch(repo_path)` (today's behavior),
     `branch = ensure_ref_prefix(branch, "issue-<N>")` (lowercased),
     `name = ensure_ref_prefix(name, "issue-<N>")`, `existing_branch = false`
     — exactly Linear's shape.

Notes:
- The **agent always runs** (one code path; trivial haiku cost). It is *not* asked
  to fill the source fields — Rust injects them from `gh`. For a PR the agent's
  branch/base picks are discarded; its `name` + host + `reason` are kept.
- `validate_repo` still runs but is effectively superseded by the deterministic
  match on the GitHub path (the match already guarantees a known path); it remains
  the guard for the plain/Linear paths.

### `DeducedWorktree` changes (Rust struct + mirrored TS)

- **Rename** (source-neutral now that GitHub exists):
  - `ticket_url` (`ticketUrl`) → `source_url` (`sourceUrl`)
  - `ticket_title` (`ticketTitle`) → `source_title` (`sourceTitle`)
  - `source_resolved` (`sourceResolved`) — already neutral, unchanged.
- **New field** `existing_branch: bool` (`existingBranch`, `#[serde(default)]`,
  source-neutral) — tells the form to build an `existing` vs `new` `BranchSpec`.
- All new/renamed fields keep `#[serde(default)]` so the plain/Linear narrower JSON
  still deserializes. Linear's *prompt strings* (`compose_user_ticket`,
  `SYSTEM_PROMPT_TICKET`) keep their `ticket` wording; only the shared **fields**
  are renamed.

## D. Frontend — `NewWorktreeForm` (the panel)

Small, additive changes (on top of the rename):

- **`src/worktrees/api.ts`** — `DeducedWorktree`: rename `ticketUrl`/`ticketTitle`
  → `sourceUrl`/`sourceTitle`; add optional `existingBranch?`.
- **`src/worktrees/model.ts`** — rename `ticketLinkFrom` → `sourceLinkFrom`
  (reads `sourceUrl`/`sourceTitle`).
- **`runDeduce`** — use `sourceLinkFrom(d)`; set `mode` from `d.existingBranch`
  (`"existing"` when true, else `"new"`). Stage the link + banner as today.
- **Banner** — the existing ticket line becomes source-aware, e.g.
  `🔗 <title> — link will be added`; for a PR it also notes
  `will check out branch <headRefName>`.
- **`submit`** — unchanged; it already threads `links` and the `mode` `BranchSpec`
  into `createWorktree`/`makeWorktree`.
- **Errors** — `gh` failure / unknown-repo come back as rejected promises and
  reuse the existing inline `deduceError`. A failed GitHub deduction leaves manual
  entry fully working (the throughline from SP1/SP2/SP3 + Linear).

No source picker: the single prompt box auto-detects (matches the spec's "single
text input accepting a Linear ticket … a GitHub link … or a plain prompt").

## E. Error handling (additions to the Linear table)

| Failure | Behaviour |
|---|---|
| `gh` missing / not authenticated | inline `Err` from the fetch; manual entry works |
| PR/issue not found or no access | inline `Err`; manual entry works |
| Ref's `owner/repo` not in `knownRepos` | inline `Err` guiding to add it via `KnownReposEditor` |
| No GitHub URL in the prompt | Linear path, then plain path — byte-identical to today |
| Non-URL GitHub-looking text | detector matches only the canonical PR/issue URL shape; else plain |

## F. Testing

Mirrors SP1/SP2/SP3 + Linear: unit-test the pure/risky logic; manual for the GUI.

- **Rust (pure):** `detect_github_ref` (PR URL / issue URL / embedded-in-text /
  none / trailing slug or query tolerated); `parse_owner_repo` (SSH form, HTTPS
  form, with/without `.git`, non-GitHub → None); `ensure_ref_prefix` reuse;
  envelope parse with the **renamed** fields + `existing_branch` default on the
  plain path.
- **Rust (self-runnable, read-only — no paid call):** the `gh` field contract is
  verifiable locally without an LLM; the field names were confirmed during
  brainstorming. The plain agent itself was already smoke-tested in SP3, so the
  **GitHub path needs no new paid smoke test.**
- **TS:** `sourceLinkFrom` (null when no `sourceUrl`; title-or-url label);
  `existingBranch` → `mode` mapping if extracted to a pure helper.
- **Headless (agent-runnable):** `cargo test`, `cargo build`, `npm test`,
  `npx tsc --noEmit`, `npm run build`.
- **Manual GUI (user eyeballs):**
  1. Paste a real **PR URL** for a known repo → deduce → repo + `existing` branch
     (`headRefName`) + base filled, name contains `pr-<N>`, banner shows the title
     and "will check out branch …" → Create → tile shows the PR link on its branch.
  2. Paste an **issue URL** → new branch with `issue-<N>`, link added.
  3. Paste a PR/issue URL for a repo **not in `knownRepos`** → inline error.
  4. A plain prompt and a Linear ref still behave exactly as before.

## G. Extensibility — deferred GitHub iterations (documented, not built)

Named explicitly, the way Linear named `linear.rs`/sub-project-4 as its swap point:

1. **Remote-review-only worktree** (the *no-local-clone* matrix cell): a new tile
   shape — no `git worktree add`, no host/git PTYs, a single Claude Code +
   code-review terminal pointed at the *remote* PR. It changes the worktree model
   (no `worktreePath`/`host`) and needs the deferred "seed the Claude terminal with
   PR context" idea. **Its own sub-project**, not a drop-in branch.
2. **Filesystem auto-find** of a matching clone not yet in `knownRepos` (the
   *yes-local-but-unknown* cell) — needs a configured search root + dedup.
3. **`owner/repo#N` shorthand** (and possibly bare `#N` with a repo hint) — needs a
   pull-vs-issue `gh` probe.
4. **PR fast-path optimization** — skip the agent entirely when a PR's repo has a
   saved host default (everything is then deterministic).
5. **Slack source type** stays next-after-GitHub — same `Source`-branch shape (a
   Slack permalink → its MCP or API), same `sourceResolved` guardrail, same link
   auto-population.

> The repo-location matrix (brainstorming): `yes-local + yes-known` →
> deterministic remote-match (this iteration); `yes-local + unknown` → add via
> `KnownReposEditor` now, auto-find later; `no-local` → remote-review mode (its own
> sub-project).

## H. File-level change surface

- **Create:** `src-tauri/src/github.rs` — `GithubKind`, `GithubRef`,
  `GithubContext`, `detect_github_ref`, `parse_owner_repo` (pure + tested),
  `fetch_github`, `match_repo`.
- **Modify:** `src-tauri/src/deduce.rs` — the `Source` enum + `detect_source`; the
  GitHub branch in `deduce_worktree` (fetch + match + plain call + overrides); the
  `DeducedWorktree` field rename + `existing_branch`; register `mod github`.
- **Modify:** `src-tauri/src/lib.rs` — add `mod github;` (next to `mod deduce;`).
- **Modify:** `src/worktrees/api.ts` — field rename + optional `existingBranch?`.
- **Modify:** `src/worktrees/model.ts` + `src/worktrees/model.test.ts` —
  `ticketLinkFrom` → `sourceLinkFrom`.
- **Modify:** `src/tiles/worktree/NewWorktreeForm.tsx` — `sourceLinkFrom`, mode
  from `existingBranch`, source-aware banner.
- **Modify:** `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`
  — as-built notes + status (GitHub source type complete; Slack next).
- **No new dependencies, no IPC signature changes.**

## Linear deferred verification (resolved as part of this work)

The GitHub path has **no MCP/`--allowedTools` const to pin**, so it needs no paid
smoke test — its only LLM call is the already-verified plain agent, and the `gh`
contract is verifiable read-only and locally. Linear's `LINEAR_ALLOWED_TOOLS` /
`LINEAR_MODEL`, however, remain **provisional** and require a **human-run** paid
MCP smoke (the agent's Bash-spawned `claude` is not logged in). The plan carries
that human smoke as its first task (Linear const-pinning) alongside a tiny
self-runnable `gh`-contract check for GitHub.

## Definition of done

- A GitHub PR or issue URL typed into the prompt is detected; `gh` fetches its
  context and the repo is resolved deterministically from `knownRepos`.
- A **PR checks out its existing branch** (`headRefName` from `baseRefName`); an
  **issue gets a new branch** with `issue-<N>` in name + branch (agent-proposed,
  Rust-enforced). The PR's name contains `pr-<N>`.
- The resolved PR/issue link is auto-added to the worktree's `links` on Create;
  the banner shows it.
- A `gh` failure or an unknown repo surfaces inline and never produces fabricated
  params; the plain-prompt and Linear paths are byte-identical and unaffected;
  manual entry always works.
- The staged-link fields are renamed source-neutral (`sourceUrl`/`sourceTitle`,
  `sourceLinkFrom`); `existing_branch` drives the `BranchSpec` mode.
- `github.rs` holds the detect/fetch/match unit; `deduce.rs` stays the orchestrator.
- Rust pure-logic tests + TS tests green; app builds and launches.
- As-built notes + status updated; decomposition item 3 marks GitHub done and
  Slack as the next source-type iteration; the deferred GitHub cells (§G) recorded.
- Linear's `LINEAR_*` consts pinned by a human-run smoke (carried in the plan).
