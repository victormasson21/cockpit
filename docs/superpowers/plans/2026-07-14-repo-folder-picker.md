# Repo Folder Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed-path input in Settings → Known repos with a "Browse…" button that opens the OS-native folder picker, validating and normalizing the pick to its git repo root before adding.

**Architecture:** Add the Tauri dialog plugin for the native folder picker (frontend). A new thin Rust command `resolve_repo_root` runs `git -C <dir> rev-parse --show-toplevel` to both validate the pick is a git work tree and normalize it to the repo root. `KnownReposEditor` wires Browse → picker → `resolveRepoRoot` → `addKnownRepo`, surfacing errors inline.

**Tech Stack:** Tauri v2 (Rust + `@tauri-apps/plugin-dialog`), React 19 + TS, Zustand store, Vitest + `cargo test`.

## Global Constraints

- Tauri v2; plugin crates pinned at `"2"`. React 19 + TS (Vite). Zustand store.
- Top-of-file role comment on every file (one line unless more is needed); concise block comments on non-obvious logic (project CLAUDE.md convention).
- Build the smallest thing that works; fewest files/deps/abstractions.
- Rust I/O commands are `#[tauri::command(async)]` (they run off the macOS main thread); pure arg-builders are split out and unit-tested per `worktree.rs` convention.
- Theme tokens only in components (e.g. `--bad` for error text, `--space-1/2`, `--fs-sm`); no literal colours.
- Both `npm run build` + `npx vitest run` and `cargo test` green before merge.

Spec: `docs/superpowers/specs/2026-07-14-repo-folder-picker-design.md`.

---

### Task 1: Rust `resolve_repo_root` command + pure arg-builder

**Files:**
- Modify: `src-tauri/src/worktree.rs` (add pure `repo_root_args` near the other `*_args` builders ~line 137; add the `resolve_repo_root` command near `worktree_status` ~line 298; add tests in the existing `#[cfg(test)]` module, reusing `init_test_repo`)
- Modify: `src-tauri/src/lib.rs:35` (register command in `generate_handler!`)

**Interfaces:**
- Produces (Rust): `pub fn repo_root_args(path: &str) -> Vec<String>` → `["-C", path, "rev-parse", "--show-toplevel"]`; `#[tauri::command(async)] pub fn resolve_repo_root(path: String) -> Result<String, String>`.
- Produces (IPC): command name `resolve_repo_root`, param `{ path: string }`, returns the repo root `string` on Ok / error `string` on Err. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)]` module in `src-tauri/src/worktree.rs`:

```rust
#[test]
fn repo_root_args_builds_rev_parse_toplevel() {
    assert_eq!(
        repo_root_args("/some/dir"),
        vec!["-C", "/some/dir", "rev-parse", "--show-toplevel"]
    );
}

#[test]
fn resolve_repo_root_returns_root_for_a_repo() {
    let repo = init_test_repo();
    let path = repo.path().to_string_lossy().to_string();
    let root = resolve_repo_root(path).unwrap();
    // canonicalize both sides: macOS /var is a symlink to /private/var, so git's
    // --show-toplevel and tempdir()'s path can differ only by that prefix.
    let got = std::fs::canonicalize(&root).unwrap();
    let want = std::fs::canonicalize(repo.path()).unwrap();
    assert_eq!(got, want);
}

#[test]
fn resolve_repo_root_normalizes_a_subdirectory_to_the_root() {
    let repo = init_test_repo();
    let sub = repo.path().join("pkg/inner");
    std::fs::create_dir_all(&sub).unwrap();
    let root = resolve_repo_root(sub.to_string_lossy().to_string()).unwrap();
    let got = std::fs::canonicalize(&root).unwrap();
    let want = std::fs::canonicalize(repo.path()).unwrap();
    assert_eq!(got, want);
}

#[test]
fn resolve_repo_root_errors_for_a_non_repo() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().to_string();
    let err = resolve_repo_root(path.clone()).unwrap_err();
    assert!(err.contains("Not a git repository"), "got: {err}");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test resolve_repo_root repo_root_args`
Expected: FAIL to compile — `cannot find function repo_root_args` / `resolve_repo_root`.

- [ ] **Step 3: Write the implementation**

Add the pure arg-builder near the other `*_args` fns (after `delete_branch_args`, ~line 137):

```rust
// git args to print a path's repo root; non-zero exit if the path is not inside a work tree.
pub fn repo_root_args(path: &str) -> Vec<String> {
    vec!["-C".into(), path.into(), "rev-parse".into(), "--show-toplevel".into()]
}
```

Add the command near `worktree_status` (~line 298):

```rust
// Validate a picked folder is a git work tree and normalize it to its repo root.
// One `rev-parse --show-toplevel` does both: non-zero exit => not a repo; stdout => the root.
#[tauri::command(async)]
pub fn resolve_repo_root(path: String) -> Result<String, String> {
    let out = Command::new("git")
        .args(repo_root_args(&path))
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Not a git repository: {path}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
```

Register it in `src-tauri/src/lib.rs` in `generate_handler!` after `worktree::worktree_file_diff,` (line 35):

```rust
            worktree::resolve_repo_root,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test resolve_repo_root repo_root_args`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the crate still builds**

Run: `cd src-tauri && cargo build`
Expected: Finishes without errors (dialog plugin not needed for this task).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/worktree.rs src-tauri/src/lib.rs
git commit -m "feat(worktree): resolve_repo_root command validates + normalizes a picked repo path"
```

---

### Task 2: Add + register the Tauri dialog plugin

**Files:**
- Modify: `package.json` (add `@tauri-apps/plugin-dialog` dependency)
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-dialog = "2"`)
- Modify: `src-tauri/src/lib.rs:18` (register the plugin)
- Modify: `src-tauri/capabilities/default.json` (add `"dialog:default"` permission)

**Interfaces:**
- Produces: the `@tauri-apps/plugin-dialog` `open` API is available to the frontend, and the `dialog:*` commands are permitted for the `main` window. Consumed by Task 3.

- [ ] **Step 1: Install the JS plugin**

Run: `npm install @tauri-apps/plugin-dialog`
Expected: `package.json` gains `"@tauri-apps/plugin-dialog": "^2..."` under dependencies; lockfile updates.

- [ ] **Step 2: Add the Rust plugin crate**

Edit `src-tauri/Cargo.toml` — add under `[dependencies]` alongside `tauri-plugin-opener`:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 3: Register the plugin**

Edit `src-tauri/src/lib.rs` line 18 — add the dialog plugin right after the opener plugin:

```rust
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 4: Grant the capability**

Edit `src-tauri/capabilities/default.json` — add `"dialog:default"` to `permissions`:

```json
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default"
  ]
```

- [ ] **Step 5: Verify both builds**

Run: `cd src-tauri && cargo build` then `cd .. && npm run build`
Expected: Both succeed. Cargo compiles `tauri-plugin-dialog`; tsc/Vite build clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(deps): add Tauri dialog plugin for native folder picker"
```

---

### Task 3: Wire Browse into KnownReposEditor

**Files:**
- Modify: `src/worktrees/api.ts` (add `resolveRepoRoot` wrapper)
- Modify: `src/views/KnownReposEditor.tsx` (replace text field with Browse button + error state)
- Modify: `src/views/KnownReposEditor.css` (error text style; keep `.known-repos__add` layout)
- Test: `src/views/KnownReposEditor.test.ts` (unchanged — `mergeHost` test kept)

**Interfaces:**
- Consumes: IPC `resolve_repo_root` (Task 1); `open` from `@tauri-apps/plugin-dialog` (Task 2); `addKnownRepo` from the store (existing, dedupes by path).
- Produces: `export const resolveRepoRoot = (path: string) => invoke<string>("resolve_repo_root", { path })`.

- [ ] **Step 1: Add the api wrapper**

Edit `src/worktrees/api.ts` — add near the other invoke wrappers:

```ts
// Resolve a picked folder to its git repo root; rejects with a message if the folder is not a repo.
export const resolveRepoRoot = (path: string) =>
  invoke<string>("resolve_repo_root", { path });
```

- [ ] **Step 2: Rewrite the add-repo UI**

Edit `src/views/KnownReposEditor.tsx`. Replace the `useState`/`add` for `path` and the `.known-repos__add` block with a Browse flow. Full new file:

```tsx
// KnownReposEditor.tsx — Settings pane: add (via native folder picker) / remove known repo paths
// + edit each repo's saved host default (start cmd + address).
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../settings/store";
import { resolveRepoRoot } from "../worktrees/api";
import type { HostConfig } from "../settings/types";
import "./KnownReposEditor.css";

// Merge a partial host edit onto the current host, seeding the missing half so HostConfig stays complete
// (both startCmd and address are always present). Pure so the seeding rule is unit-tested without a DOM.
export function mergeHost(current: HostConfig | undefined, patch: Partial<HostConfig>): HostConfig {
  return { startCmd: "", address: "", ...current, ...patch };
}

export function KnownReposEditor() {
  const { cockpit, addKnownRepo, removeKnownRepo, setRepoHost } = useSettings();
  const repos = cockpit.knownRepos;
  const [error, setError] = useState<string | null>(null);

  // Open the native folder picker; validate + normalize the pick to its repo root, then add it.
  const browse = async () => {
    setError(null);
    const picked = await open({ directory: true, multiple: false, title: "Select a repo folder" });
    if (typeof picked !== "string") return; // cancelled (null) — silent no-op.
    try {
      addKnownRepo(await resolveRepoRoot(picked)); // store dedupes by path.
    } catch (e) {
      setError(String(e));
    }
  };

  // Patch one field of a repo's host default; seed the missing half from the current host (or empty).
  const editHost = (repoPath: string, patch: Partial<HostConfig>) => {
    setRepoHost(repoPath, mergeHost(repos.find((r) => r.path === repoPath)?.host, patch));
  };

  return (
    <div className="known-repos">
      <strong>Known repos</strong>
      {repos.length === 0 && <div className="known-repos__empty">Add a repo so deduction can pick one.</div>}
      {repos.map((r) => (
        <div key={r.path} className="known-repos__row">
          <div className="known-repos__head">
            <span className="known-repos__path">{r.path}</span>
            <button className="icon-btn" aria-label="remove repo" onClick={() => removeKnownRepo(r.path)}>✕</button>
          </div>
          {/* Host default: editable start command (carries the install step) + address. Saved per repo for future deduces. */}
          <input placeholder="start command (e.g. pnpm install && pnpm run dev)" value={r.host?.startCmd ?? ""}
            onChange={(e) => editHost(r.path, { startCmd: e.target.value })} />
          <input placeholder="host address (e.g. http://localhost:5173)" value={r.host?.address ?? ""}
            onChange={(e) => editHost(r.path, { address: e.target.value })} />
        </div>
      ))}
      <div className="known-repos__add">
        <button onClick={browse}>+ Browse for repo…</button>
      </div>
      {error && <div className="known-repos__error">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Add the error style**

Edit `src/views/KnownReposEditor.css` — append:

```css
/* inline error when a picked folder is not a git repo. */
.known-repos__error { font-size: var(--fs-sm); color: var(--bad); }
```

- [ ] **Step 4: Verify tsc + existing tests + build**

Run: `npx vitest run src/views/KnownReposEditor.test.ts && npm run build`
Expected: `mergeHost` tests PASS; tsc + Vite build clean (no unused-import or type errors).

- [ ] **Step 5: Commit**

```bash
git add src/worktrees/api.ts src/views/KnownReposEditor.tsx src/views/KnownReposEditor.css
git commit -m "feat(settings): pick a known repo via native folder picker"
```

---

### Task 4: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full JS test + build**

Run: `npx vitest run && npm run build`
Expected: all JS tests PASS; build clean.

- [ ] **Step 2: Full Rust test + build**

Run: `cd src-tauri && cargo test && cargo build`
Expected: all Rust tests PASS (4 new); build clean, no warnings introduced.

- [ ] **Step 3: Manual GUI smoke (human)**

Note in the final summary that GUI acceptance is pending human eyeball (native macOS dialog can't be driven headlessly). Checklist to hand to the user:
- Settings → Known repos → "+ Browse for repo…" opens the native folder picker.
- Selecting a git repo adds its root path to the list.
- Selecting a subfolder of a repo adds the repo *root* (not the subfolder).
- Selecting a non-repo folder shows the inline "Not a git repository: …" error and adds nothing.
- Cancelling the dialog does nothing (no error).
- Re-picking an already-listed repo is a silent no-op.
```
