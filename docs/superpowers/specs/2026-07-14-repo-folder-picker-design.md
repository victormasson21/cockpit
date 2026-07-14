# Repo folder picker (Settings → Known repos)

**Date:** 2026-07-14
**Status:** design approved, pending implementation plan

## Goal

In **Settings → Known repos**, replace the typed-path input in `KnownReposEditor`
with a **"Browse…"** button that opens the OS-native folder picker. The picked
folder is validated as a git repo — and normalized to its repo root — before
being added. No path typing is ever required.

## Motivation

Adding a known repo today means hand-typing (or pasting) an absolute path into a
text field. That's error-prone and unfriendly. A native folder picker makes the
common case one click, and validating the pick catches non-repo folders that
would otherwise silently break deduce / worktree creation later.

## Changes

### 1. Tauri dialog plugin (native picker)

- Add `@tauri-apps/plugin-dialog` (JS) and `tauri-plugin-dialog = "2"` (Cargo).
- Register it in `src-tauri/src/lib.rs`: `.plugin(tauri_plugin_dialog::init())`.
- Add `"dialog:default"` to `src-tauri/capabilities/default.json` permissions
  (alongside `core:default`, `opener:default`).

### 2. Rust command — validate + normalize (`src-tauri/src/worktree.rs`)

New command, following the existing git-provider style:

```
resolve_repo_root(path: String) -> Result<String, String>
```

- Runs `git -C <path> rev-parse --show-toplevel`.
- **Ok** → the trimmed repo root path (stdout, newline-stripped).
- **Err** → `"Not a git repository: <path>"`.

This one command does both jobs:
- **Validates** — `rev-parse` exits non-zero when `path` is not inside a work
  tree, so non-repo folders are rejected.
- **Normalizes** — a pick anywhere inside a repo resolves to the repo root, so
  dedupe (`knownRepos` is keyed by `path`) and the GitHub source's
  origin-remote matching stay clean.

Pure, unit-tested helpers per repo convention:
- `repo_root_args(path) -> Vec<String>` → `["-C", path, "rev-parse", "--show-toplevel"]`.
- output trimming (strip trailing newline) either inline-tested or via a tiny
  pure helper.

Register the command in `lib.rs`'s `invoke_handler`.

### 3. Frontend api wrapper (`src/worktrees/api.ts`)

```ts
// Resolve a picked folder to its git repo root; rejects with a message if not a repo.
export const resolveRepoRoot = (path: string) =>
  invoke<string>("resolve_repo_root", { path });
```

### 4. `src/views/KnownReposEditor.tsx`

- Remove the `path` text field and its `useState`.
- Add a **"Browse…"** button whose click handler calls
  `open({ directory: true, multiple: false, title: "Select a repo folder" })`
  from `@tauri-apps/plugin-dialog`.
- On the returned value:
  - `null` (user cancelled) → silent no-op.
  - a path string → `resolveRepoRoot(path)`:
    - **Ok** → `addKnownRepo(root)` (store dedupes; re-picking a known repo is a
      silent no-op, unchanged).
    - **Err** → set a local `error` state, rendered inline near the button.
- Keep the empty-state hint ("Add a repo path so deduction can pick one.").
- Host-default editing (start command + address inputs per row) is **unchanged**.

## Data flow

```
Browse click
  → native folder picker (plugin-dialog open, directory: true)
  → selected dir path (or null on cancel)
  → resolve_repo_root  (git -C <dir> rev-parse --show-toplevel)
  → repo root path
  → addKnownRepo(root)  (store dedupes)
  → persisted in cockpit.json
```

Errors surface inline. Cancel is a no-op. Re-picking an already-known repo is a
silent no-op (existing dedupe in `addKnownRepo`).

## Error handling

| Case | Behaviour |
|------|-----------|
| Folder is not a git repo | Inline error: "Not a git repository: `<path>`" |
| Dialog cancelled (`null`) | No-op, no error |
| Folder is a repo subdirectory | Normalized to the repo root, then added |
| Repo already known | Silent no-op (dedupe) |

## Testing

- **Rust:** pure test for `repo_root_args`; a command test running
  `resolve_repo_root` against a temp git repo (Ok, returns root) and a plain
  non-repo dir (Err), following `worktree.rs`'s existing git-test style.
- **JS:** the existing `mergeHost` test in `KnownReposEditor.test.ts` is kept.
  The Browse flow is plugin/DOM-heavy with negligible pure logic to extract, so
  no new JS unit test is forced.
- Both `npm run build` + `npx vitest run` and `cargo test` green before merge.

## Non-goals

- Multi-select of folders.
- A recent-folders / suggestions list.
- Auto-filling the host default (start command / address) on add.
- Any git-repo *content* validation beyond "is a work tree."
- Changing the host-default editing UI.
