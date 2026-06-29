# Worktree teardown actions — Close / Pause / Delete / Wipe

**Date:** 2026-06-29
**Status:** design approved, ready for plan

## Problem

A worktree column's top-right menu currently offers two actions: **Hide** (unassign
the slot) and **Delete** (kill PTYs + drop the model). The "Delete" action never runs
`git worktree remove` — it only filters the worktree out of `cockpit.json` and kills
the three PTYs. The on-disk worktree directory and, crucially, git's registration of it
(`.git/worktrees/<ref>`) are left intact.

The consequence is a **major bug**: the branch that was checked out in that worktree
stays checked out there forever (from git's point of view), so it can't be checked out
anywhere else. `list_branches` correctly flags it as `checkedOut` and the existing-branch
picker disables it — a branch the user can no longer use, attached to a worktree the app
no longer shows.

This is not hypothetical: the current machine has **5 orphaned worktrees** on disk under
`~/CockpitWorktrees` (across `customer-web-portal` and `pro-web-portal`) whose models were
already dropped from `cockpit.json` (which now lists zero worktrees), each holding a branch
hostage.

## Goal

Give a worktree four cumulative teardown actions, each removing one more of the four things
a worktree has attached to it, and make the destructive ones actually clean up git:

| Action | Removes | Effect |
|--------|---------|--------|
| **Close** | 1. tile assignment | Worktree stops showing in that slot. Processes, dir, branch all kept. (= today's "Hide".) |
| **Pause** | 1 + 2. processes | Slot cleared **and** the 3 PTYs killed. Model, on-disk dir, branch all kept — re-selectable from the picker. |
| **Delete** | 1 + 2 + 3. git worktree | Pause + `git worktree remove` + drop the model. **Branch preserved.** Destructive → confirmation. |
| **Wipe** | 1 + 2 + 3 + 4. branch | Delete + `git branch -D <branch>`. Destructive → confirmation. |

The four "attached things" named by the user:
1. **Tile assignment** — which slot displays it (session-only slot state).
2. **Processes** — the running PTYs (3 for a worktree: git/host/claude).
3. **Worktree** — the git worktree (on-disk dir + `.git/worktrees/<ref>` registration).
4. **Branch** — the git branch.

**Scratch terminals** (session-only, no git) get only **Close** and **Delete**:
Close = unassign slot; Delete = kill the single `shell` PTY + drop the scratch entity.
Pause and Wipe are meaningless for scratch (no model to keep, no branch).

## Confirmation dialog

Delete and Wipe open a confirmation window (reusing the generic `<Modal>`). Before showing
the confirm button, the dialog probes the worktree for **uncommitted changes** (dirtiness).
If the worktree is dirty, the dialog warns the user that the changes will be lost; on
confirmation, `git worktree remove --force` is used. Wipe additionally warns that the branch
will be force-deleted (`git branch -D`).

- Confirm is disabled until the dirtiness probe returns (the whole point of the probe).
- While the teardown runs, the dialog blocks dismissal (no scrim-close mid-operation).
- On `remove_worktree` failure the dialog stays open with an inline error so the user can retry;
  the model is **not** dropped.

## Architecture

Same provider/boundary pattern as the rest of the app: new Rust IPC commands do the privileged
git work; the React side orchestrates the cumulative sequence and renders the confirmation.

### Rust — `src-tauri/src/worktree.rs`

Three new commands, each with a pure, `#[cfg(test)]`-tested arg-builder where it has one
(matching the existing `worktree_add_args` style). All run git via `.current_dir(...)`.

- **`worktree_status(worktree_path) -> { exists, dirty }`** — runs `git status --porcelain`
  inside the worktree.
  - Path missing on disk → `{ exists: false, dirty: false }` (so Delete still proceeds).
  - Git exits non-zero on an existing dir (e.g. corrupted) → `{ exists: true, dirty: true }`
    (safe default: forces the user to acknowledge force-removal rather than silently lose data).
- **`remove_worktree(repo_path, worktree_path, force) -> ()`** — runs
  `git worktree remove [--force] <worktree_path>`.
  - **Missing-dir fallback:** if `remove` fails *and* the path no longer exists on disk, run
    `git worktree prune` and return `Ok(())`. This deregisters the stale `.git/worktrees/<ref>`
    entry — the core of the bug fix and the recovery path for manually-deleted dirs.
  - If the path still exists and `remove` failed, surface git's stderr as `Err`.
- **`delete_branch(repo_path, branch) -> ()`** — runs `git branch -D <branch>` (force delete,
  handles unmerged branches; the UI dialog already confirmed). Must run **after** the worktree
  is removed — git refuses to delete a branch still checked out in a worktree.

Registered in `src-tauri/src/lib.rs` after `worktree::list_branches`.

### Frontend

- **`src/worktrees/api.ts`** — typed wrappers: `worktreeStatus`, `removeWorktreeGit`
  (named to avoid colliding with the store's `removeWorktree`), `deleteBranch`, plus a
  `WorktreeStatus` interface.
- **`src/worktrees/teardown.ts`** (new) — a plain, dependency-injected module (no React) so
  it's unit-testable:
  - `killWorktreePtys(worktreeId)` — kills the 3 PTYs (idempotent; `pty_kill` is a no-op on
    missing ids).
  - `teardownWorktree(wt, { wipe, force }, removeWorktreeModel) -> warning | null` — the
    cumulative sequence: **kill PTYs → `remove_worktree(force)` → [Wipe: `delete_branch`] →
    drop model**. If `remove_worktree` throws, the model is kept and the error propagates
    (retry possible). A `delete_branch` failure is caught and downgraded to a non-fatal
    warning string (the worktree is already gone, so dropping the model is still correct).
- **`src/views/worktree-column/TeardownConfirm.tsx`** (new) — the Delete/Wipe confirmation
  dialog. Probes dirtiness on mount, warns, runs `teardownWorktree` on confirm.
- **`src/views/worktree-column/SlotColumn.tsx`** — the menu becomes:
  - worktree entity: **Close · Pause · Delete · Wipe** (Delete/Wipe open the confirm dialog;
    confirm state is **local** to SlotColumn — three independent render sites, no shared
    coordination).
  - scratch entity: **Close · Delete** (unchanged Delete behaviour).
- **`src/views/worktree-column/WorktreeColumn.css`** — minimal styles for the dialog
  (`.tc__warn`, `.tc__error`, `.tc__actions`), reusing existing tokens.

## Error handling & ordering

| Step | On failure |
|------|------------|
| 1. kill PTYs | Cannot fail (`pty_kill` always `Ok`). Always first so no process holds the dir open. |
| 2. `remove_worktree` | Stop; keep the model; show inline error in the dialog; allow retry. |
| 3. `delete_branch` (Wipe only) | Non-fatal: the worktree is already gone. Catch → warning string → continue. |
| 4. drop model (`removeWorktree`) | Runs only after step 2 succeeds. Also clears slots + `cockpitWorktreeId`. |

## Testing

- **Rust** (`#[cfg(test)]` in `worktree.rs`): pure arg-builders —
  `worktree_remove_args` (plain + `--force`), `delete_branch_args`.
- **Frontend** (Vitest, `src/worktrees/teardown.test.ts`): mock `invoke`/`removeWorktreeGit`/
  `deleteBranch` and assert: PTYs killed before remove; delete never calls `deleteBranch` and
  drops the model once; wipe success calls `deleteBranch`, returns `null`, drops the model;
  wipe with `deleteBranch` rejecting returns a warning and **still** drops the model;
  `remove_worktree` rejecting does **not** drop the model; the `force` flag is threaded through.
- **Manual GUI acceptance:** Close (re-selectable), Pause (column empties, picker re-selects,
  PTYs gone), Delete on a clean and on a dirty worktree (dirty warning shown), Wipe (branch
  gone from the picker afterwards).

## Wrap-up cleanup (one-off, during implementation)

Clean up the 5 existing orphaned worktrees so we start fresh, **branches preserved**. Run
`git worktree remove --force <path>` for each registered worktree under `~/CockpitWorktrees`:

- `~/Repos/elder/customer-web-portal` → `amplitude-investigation`, `sentry-fix`, `sentry-fixes`
  (all clean).
- `~/Repos/elder/pro-web-portal` → `investigate-amplitude`, `unify-applied-placement-card`
  (**both dirty — 23 uncommitted lines each**).

The two dirty worktrees hold uncommitted work; force-removing discards it. **Confirm with the
user before force-removing the dirty pair** — the clean three can go without ceremony. Branches
are never deleted by the wrap-up.

## Deferred / out of scope

- Deleting the on-disk worktree directory beyond what `git worktree remove` does (git removes
  the working tree itself on a successful remove).
- A "clean up all orphaned worktrees" UI button (the wrap-up is a one-time chore, not a feature).
- Locking/`--force --force` for locked worktrees or submodules (cockpit never locks).
