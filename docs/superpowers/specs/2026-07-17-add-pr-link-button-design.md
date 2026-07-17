# "+ PR" button — attach the branch's PR link on click

**Date:** 2026-07-17
**Status:** design approved

## Problem

When Claude (running in a worktree's Claude pane) creates a pull request with
`gh pr create`, nothing in Cockpit reflects it — the user has to copy the URL and
paste it in manually via `+ link`. We want a one-click way to pull the branch's PR
into the worktree's links.

## Decision

Add a dedicated **`+ PR`** chip next to the existing `+ link` chip in the worktree
column's chip row (full variant only). Clicking it queries `gh` for the PR
associated with the worktree's current branch and, if found, adds a link to the
worktree's `links`.

- **Trigger is the click only** — no background polling, no terminal scraping.
- **Detection is deterministic** via `gh pr view` (reuses `gh` auth, same as the
  deduce GitHub path), not by parsing terminal output.
- `+ link`'s existing blank-link behavior is **unchanged**.

## Behavior

Clicking `+ PR` runs `gh pr view --json url,number` in the worktree directory:

| Outcome | Result |
|---------|--------|
| PR found, not already linked | Add `{ label: "PR #<n>", url: <pr-url> }` to `links` (persisted). Renders as a clickable link chip; the derived `pr` chip also picks it up via the existing `/pull/` match in `chips.ts`. |
| PR found, URL already in `links` | No duplicate; inline notice "already linked". |
| No PR for the branch | Inline notice "no PR found"; nothing added. |
| gh error (missing / timeout / other) | Inline notice with gh's message. |

While the call is in flight the button is disabled and shows a `…` label. The
notice is transient session-only UI state (no persistence).

## Backend (`src-tauri/src/github.rs`)

- Refactor `run_gh_timeout` to delegate to a new private
  `run_gh_cwd(cwd: Option<&str>, args, timeout)` that sets `.current_dir()` when
  `Some` — so `gh` resolves the *worktree's* current branch. Existing callers pass
  `None`, keeping their behavior byte-identical.
- New command **`worktree_pr(worktreePath) -> Result<Option<WorktreePr>, String>`**,
  `#[tauri::command(async)]` (touches subprocess — follows the main-thread-beachball
  rule). `WorktreePr { number: u64, url: String }` (`camelCase`). Runs
  `gh pr view --json url,number` in the worktree; a "no pull requests found" stderr
  maps to `Ok(None)`, any other failure to `Err`.
- Pure, tested helpers:
  - `parse_pr_json(stdout) -> Result<WorktreePr, String>` — extract `number` + `url`.
  - `is_no_pr(stderr) -> bool` — classify the "no pull requests found" stderr so it
    becomes `None` rather than a scary error.
- Register `github::worktree_pr` in `lib.rs`.

## Frontend

- `src/worktrees/api.ts`: `worktreePr(worktreePath)` wrapper returning
  `WorktreePr | null`, plus the `WorktreePr` type.
- Pure helper `prLinkToAdd(links, pr): WorktreeLink | null` — returns the link to
  add, or `null` if a link with the same URL already exists. Unit-tested.
- `src/tiles/worktree/LinksList.tsx`: add the `+ PR` button after `+ link`, with
  transient `note` + `busy` local state. On click: call `worktreePr`, then
  `prLinkToAdd` → `commit(addLink(...))` on success, or set the matching notice.

## Tests

- **Rust:** `parse_pr_json` (valid / missing fields), `is_no_pr` (no-PR stderr vs a
  real error string).
- **JS:** `prLinkToAdd` (adds when the URL is absent; returns `null` when already
  linked).

## Out of scope (YAGNI)

- Background polling or automatic detection.
- Terminal-output scraping.
- A separate/new PR chip derivation — the existing `/pull/` match in `chips.ts`
  already surfaces the chip once the link exists.
- Editing the added link's label inline (it's added ready-to-use).
