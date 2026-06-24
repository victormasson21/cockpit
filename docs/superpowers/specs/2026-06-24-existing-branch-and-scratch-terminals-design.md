# Existing-branch + scratch terminals — design

> Status: ✅ implemented & merged to `main` (2026-06-24). GUI + live acceptance verified.
> One addition beyond this spec during build: `list_branches` also flags already-checked-out branches
> (via `git worktree list`) so the picker disables them — see CLAUDE.md as-built notes.
> Builds on `2026-06-23-worktrees-view-and-theme-design.md` (the 3-slot Worktrees view).
> Stack context lives in `CLAUDE.md`; product vision in `2026-06-16-cockpit-product-spec.md`.

## Goal

Today the only way to fill a Worktrees slot is the **deduce flow**, which always
**creates a new branch** and spins up **3 terminals** (host / git / claude). Two
more ways to fill a slot are missing:

1. **Open an existing branch** (+ the same 3 terminals) — without inventing a new
   branch.
2. **A single scratch terminal** — a plain login shell with no repo/branch
   presets, for quick `gh`/`brew`/poking-around work.

Both must fit the existing 3-slot mental model with the smallest possible change,
and add **only one new Rust command** (branch listing). Everything else reuses
machinery that already exists.

## Core model change: a slot holds an *entity*, not just a worktree

Today `slots: (worktreeId | null)[]` (length 3, session-only). We widen the set of
things a slot can hold from "worktree" to a **slot entity = worktree | scratch**.

- **Scratch terminal** is a new lightweight **session-only** entity:
  `{ id: "scratch-<n>", title: "Scratch <n>" }`, held in a new store list
  `scratchTerminals: ScratchTerminal[]`. No repo, no branch, no disk footprint.
- Slots stay `(string | null)[]`. **Resolution:** an id is looked up in
  `cockpit.worktrees` first, then `scratchTerminals`. Scratch ids are prefixed
  `scratch-` so the two id-spaces never collide. (Chosen over a tagged
  `{ kind, id }` ref because it keeps existing slot code and `slots.test.ts`
  almost untouched.)
- `slots.ts`: the `deleteWorktree` reducer is renamed **`clearEntity(slots, id)`**
  — identical "null out any slot holding this id" logic, now shared by both
  worktree-delete and scratch-delete. `assignFirstEmpty` / `hide` /
  `initFromWorktrees` are already id-generic and unchanged.

Scratch terminals are **session-only** by nature (ephemeral shells), consistent
with slots themselves not persisting this pass. On reload they're gone; worktrees
still auto-fill from `cockpit.json`.

## Entry points: create in the header, select in the picker

Creation and selection are separated. This removes any per-slot-target tracking —
all three creation paths reuse today's **auto-display** logic (fill first empty
slot, else displace the last slot; the existing behavior from
`15e2e6d feat(worktrees): auto-display new worktree…`).

**Header, right side** gains two buttons beside the existing one:

`+ New worktree` · `+ Existing branch` · `+ Terminal`

- **`+ New worktree`** → opens the modal in **Deduce** mode (today's flow, untouched).
- **`+ Existing branch`** → opens the modal in **Existing-branch** mode.
- **`+ Terminal`** → **instant** `addScratch()`, no modal, zero inputs.

**The slot picker stays a pure selector** (no `+ New…` action rows). It now lists
both entity kinds as two `<optgroup>`s:

```
Select…
── Worktrees ──   feature/login-fix · ENG-1234 …
── Scratch ──     Scratch 1 · Scratch 2
```

Selecting an entry assigns it to that slot (existing `setSlot`). The `⚙` menu's
**Hide** (free the slot, entity keeps running, stays re-selectable) and **Delete**
(kill PTYs + drop the entity) now act on whichever entity occupies the slot.

## The modal: two repo-based modes

`NewWorktreeModal` hosts a small segmented control at the top —
**`Deduce · Existing branch`** — set to the mode the header button chose, and
switchable in-place (so it stays a single modal component, not two near-duplicates).

- **Deduce mode** renders the **existing `NewWorktreeForm` byte-identical** — no
  change to deduce / pre-fill / Create logic.
- **Existing-branch mode** renders the new `ExistingBranchForm` (below).

## Existing-branch mode + the one new Rust command

`BranchSpec::Existing { branch }` already drives `git worktree add <path> <branch>`,
so creation needs **no new backend**. The only new backend is listing branches:

### `list_branches` (new IPC command, in `src-tauri/src/worktree.rs`)

```
list_branches(repoPath) -> Vec<BranchInfo>   // BranchInfo { name, lastCommitRelative }
```

Shells:

```
git -C <repoPath> for-each-ref \
  --sort=-committerdate \
  --format='%(refname:short)%09%(committerdate:relative)' \
  refs/heads/
```

Parsed into `BranchInfo` rows, **recency-sorted newest-first** (the
`--sort=-committerdate` does the ordering; recently-touched branches land at the
top). The line-parsing is factored into a **pure function**
(`parse_branch_lines(stdout) -> Vec<BranchInfo>`) so it's unit-tested without git.

**MVP = local branches only** (`refs/heads/`). Remote-only branches (checking out a
teammate's pushed branch you don't have locally) need tracking-branch logic and are
a **deferred follow-up**, not built now.

### `ExistingBranchForm` (new component, rendered inside the modal)

Top-to-bottom:

- **Repo `<select>`** populated from `cockpit.knownRepos` (reused as-is).
- On repo pick → `listBranches(repoPath)` → **branch `<select>`**, recency-ordered,
  each row showing `branch — 2 days ago`.
- **Name** field, auto-derived from the branch (editable).
- **Create** → `createWorktree(repoPath, name, { kind: "existing", branch })` (same
  path as deduce-created worktrees), then `addWorktree` + auto-display into a slot.

A branch already checked out in the main repo makes `git worktree add` fail; that
stderr surfaces **inline** (consistent with today's error handling — not
pre-checked). The new worktree's host pane uses the repo's saved `knownRepos.host`
default if present, else the form defaults.

## Scratch terminal — no Rust at all

A scratch reuses the existing `pty_ensure` command unchanged:

- `worktree_id = "scratch-<n>"`, `role = "shell"`, `autostart_cmd = none`,
  `cwd = homeDir()` (resolved frontend-side via `@tauri-apps/api/path`).
- The `"shell"` role is just a plain login shell — the host/claude autostart branch
  in `pty.rs` doesn't fire for it. `pty_id(worktree_id, role)` already namespaces
  it as `scratch-<n>:shell`, distinct from every worktree pty.

`addScratch()` (new store action): allocate the next `scratch-<n>` id + `Scratch <n>`
title, push to `scratchTerminals`, auto-display into a slot, return the id.
`removeScratch(id)` drops it from the list and clears slots (`clearEntity`); Delete
in the `⚙` menu also kills the single `scratch-<n>:shell` pty.

## Rendering: `SlotColumn` with two bodies

`WorktreeColumn` is **renamed `SlotColumn`** (it now hosts either entity). It keeps
the shared chrome — status dot, worktree/scratch picker, `⚙` Hide/Delete menu —
resolves its slot id to a worktree or a scratch, and renders one of two small,
focused bodies:

- **`WorktreeBody`** — today's chips + path line + 3 `WorktreePane`s + `LinksList`,
  extracted verbatim from the current `WorktreeColumn` body.
- **`ScratchBody`** — a single `WorktreePane` (`role="shell"`, `cwd = home`), no
  chips / path / links.

Delete dispatches by kind: a worktree kills its 3 role ptys (today's loop); a
scratch kills its one `shell` pty. `variant="calm"`: a scratch in Calm renders just
its shell pane (it has no extra chrome to strip); a worktree renders header + claude
pane as today.

## Files

**New:**
- `src/tiles/worktree/ExistingBranchForm.tsx` (+ `.css`).
- `src/views/worktree-column/WorktreeBody.tsx` (extracted from today's column body).
- `src/views/worktree-column/ScratchBody.tsx`.
- `src-tauri/src/worktree.rs`: `list_branches` command + `parse_branch_lines` pure
  helper + its unit test.

**Modified:**
- `App.tsx` — two new header buttons; track which mode the modal opens in.
- `src/views/NewWorktreeModal.tsx` — `Deduce · Existing branch` segmented control.
- `src/views/worktree-column/WorktreeColumn.tsx` → `SlotColumn.tsx` — entity
  resolution, two-optgroup picker, kind-dispatched Delete, body switch.
- `src/views/WorktreesView.tsx`, `src/views/CalmView.tsx` — render `SlotColumn`
  (rename; Calm passes `variant="calm"`).
- `src/views/slots.ts` — `deleteWorktree` → `clearEntity`.
- `src/settings/store.ts` — `scratchTerminals` session state + `addScratch` /
  `removeScratch`; `removeWorktree` uses `clearEntity`.
- `src/worktrees/api.ts` — `listBranches` wrapper + `BranchInfo` type.
- `src-tauri/src/lib.rs` — register `list_branches` in the invoke handler.

## Testing

- **`slots.test.ts`** — `clearEntity` clears slots holding a `scratch-` id;
  `assignFirstEmpty` accepts a scratch id (rename-through of existing tests).
- **`store.test.ts`** — `addScratch` creates an entity + auto-displays it;
  `removeScratch` drops it and clears its slot.
- **Rust** — `parse_branch_lines` parses tab-separated `for-each-ref` output into
  ordered `BranchInfo`, tolerates blank output (no branches), preserves input order
  (git already sorted by committerdate).
- Existing `chips.test.ts` / `model.test.ts` / `cargo test` stay green.

## Out of scope (deferred)

- **Remote-branch checkout** in the existing-branch picker (tracking-branch logic).
- **Persisting scratch terminals** across restarts (session-only, like slots today).
- Live branch-status (ahead/behind, last-author) decoration in the branch picker.
- Same scratch displayed in two slots simultaneously — inherits today's worktree
  behavior, not specially handled.
- Renaming a scratch terminal.
