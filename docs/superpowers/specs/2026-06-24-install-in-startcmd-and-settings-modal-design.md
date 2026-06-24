# Install-before-start + Settings modal — design

Date: 2026-06-24
Status: approved, ready for implementation

## Problem

The `host` pane autostarts a worktree's `host.startCmd` (e.g. `pnpm run dev`) by typing it
as the first line into a fresh login shell (`src-tauri/src/pty.rs` autostart). But a new
worktree lives in its own directory under `~/CockpitWorktrees/…` with **no `node_modules`** —
git worktrees share git objects, not installed dependencies. So the deduced `pnpm run dev`
fails until the user manually runs `pnpm install`. This affects every JS repo
(npm/yarn/pnpm/bun), including this Tauri app itself.

Secondary: the known-repos management (paths + saved host defaults) currently lives inline in
the deduce form (`KnownReposEditor` inside `NewWorktreeForm`). Saved host start commands are
only reachable via the in-flow "save host as default" button — there is no place to view or
hand-edit them.

## Decisions (from brainstorming)

- **Fold install into `startCmd`** (not a separate `installCmd` field, not a create-time
  Rust step). The install becomes part of the start-command string from deduction onward.
- **Do both parts together**: the install fix (#1) and a Settings modal (#2). They compose —
  the Settings modal is the surface where the combined `pnpm install && pnpm run dev` string
  is viewed and hand-edited per repo.

## Part 1 — Fold `install` into the start command (Rust, `deduce.rs`)

New pure helper, applied to the deduced `start_cmd` immediately before `deduce_worktree`
returns:

```rust
// Prepend the package manager's install so a fresh worktree (no node_modules) can run the dev server.
// Pure + testable: the caller supplies the two filesystem facts.
pub fn with_install(start_cmd: &str, has_package_json: bool, pm: &str) -> String {
    if start_cmd.trim().is_empty()        // nothing to start → nothing to install for
        || start_cmd.contains("install")  // already has one (saved default / re-deduce) → don't double it
        || !has_package_json {            // non-JS repo (e.g. cargo) → leave alone
        return start_cmd.to_string();
    }
    format!("{pm} install && {start_cmd}")
}
```

The caller computes:
- `has_package_json` — `Path::new(repo_path).join("package.json").exists()`
- `pm` — reuse `package_manager_from_lockfiles(...)` against the repo's lockfiles

Effect: `pnpm run dev` → `pnpm install && pnpm run dev`; a Tauri repo's `pnpm run tauri dev`
→ `pnpm install && pnpm run tauri dev`; a pure-Rust repo's `cargo run` is left untouched.

**One chokepoint:** restructure the `match detect_source(...)` in `deduce_worktree` into an
expression producing `Result<DeducedWorktree, String>`; bind `let mut deduced = (match { … })?;`
then apply `with_install` once and return `Ok(deduced)`. Keeps the fold in a single place
instead of four arms.

**Saved-default interaction (named, accepted):** when deduce picks a repo with a saved host
default, the frontend uses the saved `startCmd` over the freshly-folded one
(`NewWorktreeForm.tsx`). So the invariant becomes: *a saved host default's start command should
already include its install.* New saves capture the folded string automatically; the Settings
modal (Part 2) is where a pre-existing default gets install added by hand. No migration — this
personal app has few/no saved defaults today.

## Part 2 — Settings modal (frontend only; no Rust/serde change)

The Rust config already persists per-repo host (`KnownRepo { path, host: Option<HostConfig> }`
in `settings.rs`), and the store already has `setRepoHost`. Part 2 is a UI relocation.

- **Trigger:** a `⚙` button in the header's `.app__actions` (`App.tsx`), opening a
  `SettingsModal` built on the existing generic `Modal`.
- **Content:** the known-repos list, enhanced. Per repo row: the path, a **start command**
  input and an **address** input (both editable, wired to `setRepoHost`), and remove (`✕`).
  Plus the add-repo row from today's `KnownReposEditor`.
- **Move, not duplicate:** delete the inline `<KnownReposEditor />` from `NewWorktreeForm`.
  The deduce form keeps its prompt → deduce → fields flow and its "save host as default"
  shortcut button. Its empty-state hint changes from "Add a known repo *above*…" to point at
  Settings.
- **Component:** fold `KnownReposEditor`'s logic into `SettingsModal.tsx` (its only consumer is
  moving), so there is one component rather than two.

## Testing

- **Rust:** unit tests for `with_install` — empty → unchanged; already-has-install →
  unchanged; no `package.json` → unchanged; pnpm/npm/yarn/bun → correctly prefixed.
- **Frontend:** add a light test that Settings-modal edits flow into `setRepoHost`
  (`setRepoHost` itself is already covered in `store.test.ts`). No new store logic.

## Out of scope

- No separate `installCmd` field.
- No Rust serde changes, no migration of existing saved defaults.
- `FORM_DEFAULTS.startCmd` (manual-entry default `npm run dev`) stays as-is — deduce is the
  path that gains install; fully-manual entry can add it or use Settings.
