# Cockpit Diff tab — design

**Date:** 2026-07-03
**Status:** design approved, ready for plan.

## Context

Cockpit's product spec calls for a modular **centre/column space** that can override
into a **🌶️ diff** of the current worktree (`docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`
§Centre). Today, when a worktree is displayed in the **Cockpit view's** right column
(`CockpitView.tsx` → `SlotColumn` → `WorktreeBody`), you can only see its three terminals
(host / git / Claude). To actually review what a branch contains you have to leave the app.

This sub-project adds a **`[ Terminals | Diff ]` tab bar** to the Cockpit worktree column so
a worktree's **branch-vs-base diff** can be reviewed in-app — a file-list + expandable
per-file hunks, colorized. It is **Cockpit-view only**: the Worktrees and Calm multi-column
views stay terminal-only and byte-identical (opt-in via a new prop that defaults off).

The outcome: select a worktree in the Cockpit right column, click **Diff**, and see the
same "what does this branch/PR contain" review you'd get from `git diff <merge-base>...HEAD`,
without app-switching.

## Confirmed decisions

| Decision | Choice |
|----------|--------|
| Diff scope | **Branch vs base** — `git diff --merge-base <base>` (working tree **and** commits vs the merge-base with `<base>`). Captures Claude's uncommitted edits and its commits. |
| Base derivation | **Not persisted.** Frontend passes `base=""`; the backend resolves the repo default branch from `origin/HEAD` (a self-contained `symbolic-ref` helper in `worktree.rs`). If no base resolves → inline error. |
| Rendering | **Stat list → expand hunks.** A `--numstat` file summary (path + green `+N` / red `-N`); click a file to lazily fetch + expand its colorized unified-diff hunks. No npm dep — parse in Rust (numstat) + TS (hunk coloring), render monospace. |
| Placement | **Cockpit view, centre column.** A `Home | Diff` tab bar at the top of `CockpitView`'s centre column: Home = the local widgets (Todo/Timer), Diff = the diff of the **right-column** worktree (`cockpitWorktreeId`). Realises the product spec's centre-column "🌶️ diff" override. The worktree column is untouched (terminals only); Worktrees/Calm views unchanged. Tab state is session-only, defaults to Home. *(Revised during build: the first cut put the tabs in the worktree column; moved to the centre to match the design + the product spec's centre-override intent.)* |
| Empty/error state | **Inline message in the tab** — `No changes vs <base>` or git's stderr, matching the in-pane `[failed to start]` idiom. |
| Refresh timing | **Snapshot on tab-open + manual refresh button**, with an **`as of HH:MM:SS` timestamp** so staleness is visible. No background polling — reactive/live updates are deferred to the future "Live worktree & Claude signals" provider. |

## Architecture

Same **provider + panel / thin-command** shape as the rest of `worktree.rs`: pure tested
argv-builders + parsers, thin `#[tauri::command]` wrappers that shell out to `git`, a typed
`invoke` wrapper in `api.ts`, and a React panel. No filesystem watcher, no new crate.

### Backend — `src-tauri/src/worktree.rs`

Mirror `worktree_status` (existence guard → read-only git command in the worktree dir →
serde-serialized `Result<T, String>` where the error is git's trimmed stderr).

**Pure helpers (unit-tested, no I/O):**

- `diff_stat_args(base: &str) -> Vec<String>` → `["diff", "--merge-base", base, "--numstat"]`.
- `file_diff_args(base: &str, path: &str) -> Vec<String>` → `["diff", "--merge-base", base, "--", path]`.
- `parse_numstat(stdout: &str) -> Vec<DiffFile>` — one `<added>\t<removed>\t<path>` line per file.
  Binary files emit `-`/`-`; parse those counts as `0` and set `binary: true`. Skip blank lines.

**Structs (`#[derive(serde::Serialize)]`, `#[serde(rename_all = "camelCase")]`):**

```rust
pub struct DiffFile { pub path: String, pub added: u32, pub removed: u32, pub binary: bool }
pub struct DiffResult { pub base: String, pub files: Vec<DiffFile> }
```

**Base resolution (self-contained, keeps `worktree.rs` decoupled from `deduce.rs`):**

- `repo_default_branch(repo_path: &str) -> Option<String>` — runs
  `git symbolic-ref --short refs/remotes/origin/HEAD` (the same pattern as `deduce.rs`'s private
  `default_branch`), strips a leading `origin/`. Returns `None` when there's no remote HEAD.
- A small `resolve_base(base, repo_path)` rule: if `base` is non-empty use it verbatim;
  else fall back to `repo_default_branch(repo_path)`; if still none → `Err` (inline error).

**Commands:**

- `worktree_diff(worktree_path: String, repo_path: String, base: String) -> Result<DiffResult, String>`
  — resolve base, guard the worktree dir exists, run `diff_stat_args` via
  `Command::new("git").current_dir(&worktree_path)`, `parse_numstat` the stdout, return
  `DiffResult { base, files }`. (`repo_path` is needed only for `repo_default_branch`.)
- `worktree_file_diff(worktree_path: String, repo_path: String, base: String, path: String) -> Result<String, String>`
  — resolve base, run `file_diff_args`, return the **raw** unified patch (coloring is the
  frontend's job).

Register both in the `generate_handler!` macro in `src-tauri/src/lib.rs` (alongside the other
`worktree::*` commands).

**Tests** (in the existing `#[cfg(test)] mod tests`): `assert_eq!` on `diff_stat_args` /
`file_diff_args`; `parse_numstat` on a normal sample, a binary (`-`/`-`) line, and empty input.

### Frontend

**`src/worktrees/api.ts`** — typed wrappers + mirrored types (camelCase):

```ts
export interface DiffFile { path: string; added: number; removed: number; binary: boolean }
export interface DiffResult { base: string; files: DiffFile[] }
export const worktreeDiff = (worktreePath, repoPath, base) =>
  invoke<DiffResult>("worktree_diff", { worktreePath, repoPath, base });
export const worktreeFileDiff = (worktreePath, repoPath, base, path) =>
  invoke<string>("worktree_file_diff", { worktreePath, repoPath, base, path });
```

**`src/views/CockpitView.tsx`:** a `Home | Diff` tab bar at the top of the centre column
(local `useState<"home" | "diff">("home")`). Home renders the existing widgets (Todo/Timer);
Diff resolves `cockpitWorktreeId` → a `Worktree` (a plain `worktrees.find`, since only the
worktree case has a diff) and renders `<DiffView key={worktree.id} worktree={worktree} />`, or a
"Select a worktree…" message when the right column is empty/holds a scratch. The worktree column
(`SlotColumn`/`WorktreeBody`) is **unchanged** — no `showDiff` prop, no tabs there.

**`src/views/worktree-column/DiffView.tsx`** (new):
- On mount + on refresh: `worktreeDiff(worktree.worktreePath, worktree.repoPath, "")`.
- Header: `as of HH:MM:SS` label + refresh button (reuse `RestartIcon`, spin while loading —
  as `SlackTile` does).
- Body: inline message on error (git stderr) or empty (`No changes vs <base>`). Otherwise a
  file list — each row = path + green `+N` / red `-N`. Clicking a row lazily calls
  `worktreeFileDiff(...)` and expands colorized unified-diff hunks below it.

**`src/views/worktree-column/diffLines.ts`** (new, pure, unit-tested):
`parseHunks(patch: string) -> { kind: "add" | "del" | "ctx" | "hunk"; text: string }[]`
(map `+`/`-`/context/`@@` lines; drop `diff --git`/`index`/`+++`/`---` file headers). Frontend
tints each kind.

### CSS — `src/views/CockpitView.css`

The `Home | Diff` tab bar (`.cockpit-view__tabs`/`__tab`/`__tab--active`: an underlined-active
treatment) plus the `.wt-diff*` classes (stat list + colorized hunks) live here, since the diff
now renders in the centre column. Existing tokens (`--font-mono`, `--surface-raised`, `--border`,
`--radius-sm`). Two theme tokens added in `src/theme/tokens.css`: `--diff-add` (green) and
`--diff-del` (red) for the `+N`/`-N` stats and hunk line tints. `WorktreeColumn.css` is
untouched.

## Isolation / boundaries

- **`worktree_diff` / `worktree_file_diff`** — inputs: paths + base; output: serde struct /
  raw patch. No shared state, testable via the pure argv-builders + `parse_numstat`.
- **`DiffView`** — inputs: a `Worktree`; owns its own fetch + expand state; depends only on the
  two `api.ts` wrappers. Understandable without reading `SlotColumn`.
- **`SlotColumn`/`WorktreeBody`** — the `showDiff` prop is the single opt-in seam; default-off
  guarantees the non-Cockpit views are unaffected.

## Verification

- **Rust:** `cargo test` — new `assert_eq!` tests for the argv-builders + `parse_numstat`
  (normal / binary / empty). `cargo build` clean.
- **JS:** `parseHunks` unit tests (add/del/ctx/hunk + header-stripping). Vite build clean.
- **End-to-end (run the app):**
  1. Assign a worktree with real branch changes (some committed, some uncommitted) to the
     **Cockpit** right column. Open the **Diff** tab → confirm the stat list shows the changed
     files with correct `+N`/`-N`; click a file → hunks expand, colorized; the `as of` timestamp
     shows; refresh recomputes and updates the timestamp.
  2. Edit a file in that worktree, hit refresh → the diff reflects the new change (snapshot
     freshness confirmed).
  3. Empty case: a worktree whose branch has no changes vs base → `No changes vs <base>`.
  4. **Regression:** the **Worktrees** and **Calm** views show **no** tab bar and are visually
     identical to before; a **scratch** entity in the Cockpit column shows no tab bar.

## Deferred

- Live/reactive diff updates while Claude edits (poll-while-visible or fs-watch) — belongs to
  the future **"Live worktree & Claude signals"** provider, not this iteration.
- Rename/copy detection niceties, word-level intra-line highlighting, side-by-side view.
- Persisting `base` on the `Worktree` model (we derive live).
