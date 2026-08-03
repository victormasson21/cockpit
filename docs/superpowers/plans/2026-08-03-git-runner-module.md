# A `git` module — the missing runner

**Date:** 2026-08-03
**Type:** pure refactor. One deliberate behaviour change, called out below.
**Origin:** architecture review candidate 1, after candidates 3 and 4
(`2026-08-03-deduce-flow-module.md`, `2026-08-03-settings-store-slices.md`).

---

## Problem

17 hand-rolled `Command::new("git")` blocks — 15 in `worktree.rs`, one each in `deduce.rs` and
`github.rs` — each repeating `.output()`, `map_err(|e| e.to_string())` and
`if !status.success() { Err(stderr.trim()) }`. Two dialects for the repo dir (`.current_dir(p)` 21
times, `["-C", p]` 4 times). The pure arg-builders were tested; not one runner was.

Worse, `repo_default_branch` existed **twice** — `worktree.rs` and `deduce.rs` — with a comment
declaring the duplication deliberate "to keep this module decoupled". They had already drifted.

`github.rs::run_gh`, `deduce.rs::run_claude` and `slack.rs::api_get` all establish the runner pattern.
git was the only subprocess family without one.

## What changed

`src-tauri/src/git.rs` — **two public functions**, 17 call sites:

```rust
pub fn run<I, S>(dir: &str, args: I) -> Result<String, String>
pub fn default_branch(repo_path: &str) -> Option<String>
// plus strip_origin_prefix, which moved here from deduce.rs because default_branch needs it
```

`run`'s contract, deliberately:

- **stdout comes back UNTRIMMED** so `worktree_file_diff`'s raw patch survives byte-for-byte. Callers
  wanting a single value trim it themselves. A trimming runner would have silently altered that patch.
- **Err carries git's TRIMMED stderr** — that string reaches the UI verbatim.
- **A non-zero exit is an `Err`, not a panic.** Seven call sites treat failure as *data* rather than an
  error (the dirty-default in `worktree_status`, the prune fallback in `remove_worktree`, the
  main/master probes, `branch_exists`, `origin_owner_repo`, the non-fatal `worktree list`). They use
  `.ok()` and branch on the `Option`.
- **Args are generic exactly like `Command::args`**, so both `["a", "b"]` and a `Vec<String>` from a
  pure arg-builder pass without conversion at the call site.

**One function, not three.** The first sketch had `run` + `try_run` + `probe`. `run(...).ok()` already
covers every probe and fallback site, so the extra two were pure surface. Worth remembering if someone
is tempted to add them back.

`current_dir` won over `-C` (21 uses vs 4; output is byte-identical for the same operation), so
`repo_root_args` lost its embedded `-C <path>` — the directory is `run`'s first argument now.

## The one behaviour change

**`deduce.rs` gains the origin/main → origin/master fallback.** The two resolvers were not equivalent:
`worktree.rs`'s fell back to the conventional names when `origin/HEAD` was absent, `deduce.rs`'s just
gave up. Merging them means deduce can now resolve a base branch in a locally-init-ed repo that never
got an `origin/HEAD` symref — the same gap the Diff tab fix closed on 2026-07-09 (`e94f72c`). Before
this, deduce kept the agent's *guessed* base in that case. This is a strict improvement, but it is a
change, so it belongs in a smoke: deduce into a repo with no `origin/HEAD` and check the base.

## What deliberately stayed raw

`worktree.rs` keeps **one** raw `Command::new("gh")` — the `gh pr checkout` in `create_worktree`. It's
`gh`, not git, and `github.rs`'s runner imposes `GH_TIMEOUT` (30 s). A PR fetch on a large repo could
plausibly exceed that, and a timeout there would silently divert to the `refs/pull/<N>/head` fallback.
Unifying it needs that timeout decided on its own merits, not smuggled in behind a refactor.

## Tests

Ten new tests in `git.rs`, exercising real repos because shelling out is the whole point: stdout on
success, **stdout is not trimmed**, stderr comes back trimmed, owned `Vec<String>` args, a non-repo dir
errors, and the four `default_branch` cases (prefers the symref; falls back to main; falls back to
master; `None` with no origin refs at all).

Five tests moved out rather than being duplicated: the four `repo_default_branch_*` cases from
`worktree.rs` and `strip_origin_prefix_handles_origin_head` from `deduce.rs` — they travelled with
their functions. `repo_root_args_builds_rev_parse_toplevel` was updated for the dropped `-C`.

132 → 137 Rust tests. `cargo build`, `cargo clippy` and `cargo test` clean (three pre-existing clippy
warnings remain in `pr_reviews.rs`, `pty.rs` and `slack.rs` — untouched files). 288 JS tests and `tsc`
unaffected: **no frontend changes at all**, and no IPC signatures moved.

Net: **239 deletions against 54 insertions** across the three touched files, plus a 149-line `git.rs`
of which ~90 are tests. `worktree.rs` went 819 → 667 lines.

## Deferred

- **A timeout on git calls.** `run_gh` and `run_claude` both have one; `run` does not, matching today's
  behaviour. Most git calls here are local and fast, but `fetch` and the PR checkout hit the network.
  Adding one is now a one-line change in a single place — which is rather the point.
- **Routing `gh pr checkout` through `github.rs`**, per above.
- The last review candidate: the **pane-session module** (frontend) — 10 raw `invoke("pty_*")` calls
  across 5 modules, described at the bottom of `2026-08-03-deduce-flow-module.md`.
