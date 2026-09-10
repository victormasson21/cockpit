# Repo finder + VS Code button — design

Date: 2026-09-10

Two changes, in order. The first makes cockpit's repo list complete in one gesture;
the second adds an editor button to a worktree column that uses that list to work out
which folders to open.

## Why in this order

The button's only interesting question is *which folders* to open when a Claude session
spans repos. The answer comes from scanning known repos for a working tree on the same
branch. Today the list is 9 hand-added repos out of ~26 on disk, so the scan would miss
most of them. Fixing the list first makes the button's detection worth having.

## Part 1 — repo finder

### Behaviour

The Settings "+ Browse for repo…" picker allows multiple folder selection. Every returned
path is resolved by what is on disk, not by how it was picked — the dialog returns only a
path, and "I selected folder X" and "I was standing inside X with nothing selected" are the
same string, so no gesture-based rule is implementable.

Per returned path:

| Path                        | Resolution                                    |
| --------------------------- | --------------------------------------------- |
| A git working tree          | its primary repo root                         |
| A subdirectory of one       | its primary repo root                         |
| A linked worktree           | the primary repo root it belongs to           |
| Anything else               | descend for repos, depth 3, stop at each repo |

One git call resolves the first three: `git rev-parse --path-format=absolute
--git-common-dir` returns the primary's `.git` for a clone, a subdirectory *and* a linked
worktree, so its parent is always the primary root. Verified on git 2.39.

Descent skips dotfile-prefixed directories and `node_modules`, and stops descending as soon
as a directory resolves to a repo, so vendored checkouts and submodules inside a repo are
not added separately. Results are deduped, order preserved.

Consequences worth stating: picking `~/Repos` adds all ~26 repos; picking `~/Repos/elder`
adds its 20; picking `~/CockpitWorktrees` adds the 5 primaries its worktrees belong to
rather than 13 worktrees. The depth cap plus the skips are the only guard against picking
something enormous; the per-row ✕ in the editor is the undo.

### Implementation

Rust, in `worktree.rs` beside the existing `resolve_repo_root`:

- `primary_root(dir) -> Option<String>` — the one git call above, parent of the result.
- `collect_repos(dir, depth, out)` — the bounded walk.
- `#[tauri::command] discover_repos(paths: Vec<String>) -> Vec<String>` — map each path
  through the table above, dedupe.

`resolve_repo_root` stays for its other caller (`ExistingBranchForm`).

Frontend:

- `api.ts` — `discoverRepos(paths)`.
- `KnownReposEditor.browse()` — `open({ directory: true, multiple: true })`, one
  `discoverRepos` round trip, `addKnownRepo` per result.
- `summarisePicks(found, existing)` — pure, returns which paths are new and which were
  already known, so the inline message can read "Added 18 · 2 already known" instead of
  today's single error string. Unit-tested next to `mergeHost`.

No new persisted state, no migration: `knownRepos` keeps its shape and the 9 saved host
configs are untouched.

### Out of scope

Run/install-command autodetection. When it lands it goes in as a third tier in
`resolveHost` (worktree's own → saved override → detected) so a detected value is a
fallback and never overwrites what the user typed.

## Part 2 — VS Code button

### Behaviour

A button in the chips row at the top of a worktree column — the row that already holds ⓘ,
the Linear/PR chips and the user links. Clicking it opens the worktree in VS Code. The
branch needs no handling: opening the worktree directory *is* the branch.

When the session spans repos, the button opens a multi-root window. Roots are detected at
click time: for each known repo, list its working trees and take any whose branch equals
this worktree's branch. That covers a sibling worktree on the same branch and a sibling
repo whose primary checkout is on it.

- One root → open that folder.
- Several → write a generated `<name>.code-workspace` next to the config files and open it.

VS Code launches via the CLI inside the app bundle
(`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`), because `code` is
not on the user's PATH.

Known gap: a session that edited a sibling repo on a *different* branch is not detected. A
later iteration can let the user pin extra roots onto the worktree, persisted alongside
`links`.

### Implementation

Rust:

- `worktree.rs` — `#[tauri::command] branch_roots(branch, repo_paths) -> Vec<String>`,
  reusing the existing `parse_worktree_branches` on `git worktree list --porcelain`.
- `editor.rs` (new, one file per subprocess family, as `git.rs` / `github.rs` /
  `deduce.rs` / `slack.rs` already are) — the bundle CLI constant, `workspace_json(paths)`
  (pure, unit-tested), and `#[tauri::command] open_in_editor(app, name, paths)`: one path
  spawns the CLI on the folder, several write the workspace file via the existing
  `settings::atomic_write` and spawn the CLI on that.

Frontend:

- `api.ts` — `branchRoots(branch, repoPaths)`, `openInEditor(name, paths)`.
- `WorktreeBody` — a chip button beside the derived chips; its `title` lists the roots it
  will open, so a multi-root click is never a surprise.

### Testing

`cargo test` covers `primary_root`, the depth cap, the skip rules, dedupe, and
`workspace_json`; the existing tempdir repo helpers in `worktree.rs` tests already create
real repos. `vitest` covers `summarisePicks`. Then a real click-through in the app: pick
`~/Repos`, confirm the count, open a worktree that has a same-branch sibling.
