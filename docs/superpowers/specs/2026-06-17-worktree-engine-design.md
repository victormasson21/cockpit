# Cockpit — Worktree Engine (sub-project 2, manual) — Design

> Status: approved, ready for an implementation plan. The differentiating core of
> the app: a worktree is a name + git location (repo/branch/worktree) + local host,
> shown as one composite tile that runs 3 live terminals and a links list.
>
> Product vision: `2026-06-16-cockpit-product-spec.md` (esp. "Right column —
> worktrees" + decomposition item 2). Plugs into sub-project 1:
> `2026-06-16-layout-shell-design.md`. Stack & conventions: `../../../CLAUDE.md`.

## Goal

Let the user **manually** create a connected git worktree and work in it: pick a
repo + branch, Cockpit runs `git worktree add`, then renders one composite tile
with 3 auto-wired terminals (git / local host / Claude Code), editable useful
links, and a recent-worktrees dropdown with status. **No AI deduction** — that is
sub-project 3, which will fill the same worktree model in automatically instead of
from a manual form.

This is where the real terminal work lands: `portable-pty` in the Rust core,
streaming over Tauri IPC to xterm.js in the webview — the first concrete instance
of the **provider + panel** pattern (a stateful Rust provider that emits events
and accepts commands, paired with a presentation-only React tile).

## Scope

**In scope**
- A worktree **data model** persisted in `cockpit.json` (new top-level
  `worktrees` array).
- A Rust **PTY provider**: a registry of live PTYs keyed by `(worktreeId, role)`,
  with spawn/write/resize/kill/attach commands and an output event stream.
- A Rust **git-worktree provider**: real `git worktree add` (existing branch *and*
  new-branch-from-base) into a managed location; remove-from-Cockpit.
- A React **composite `worktree` tile**: dropdown + collapsible new-worktree form +
  3 stacked xterm.js terminals + editable links.
- **Auto-start**: host + Claude Code terminals run their command on spawn.
- The quick-win **rename** `cockpit-scaffold` → `cockpit`.

**Out of scope** (later sub-projects)
- AI deduction of worktree params from a prompt/link (sub-project 3). We leave the
  seam: the form is collapsible so inference can populate then collapse it.
- Auto-status inference, deleting the on-disk git worktree from the UI, persisting
  terminal scrollback across relaunch, multiple simultaneous worktree tiles
  (the model supports it; no UI is built for it here), integrations/auth panels.

## Keystone decisions (locked during brainstorming)

1. **Worktree = composite tile over worktree-as-data.** Worktrees are domain data
   (a `worktrees` array); the `worktree` tile is a *viewer* whose config is just
   `{ worktreeId }`. A second worktree in the centre later is the same tile with a
   different id — no new machinery.
2. **Real `git worktree add`** — existing branch *and* new-branch-from-base. This
   is the differentiating value, not a terminal launcher.
3. **Rust owns PTY lifetime**, keyed by `(worktreeId, role)`. The React tile only
   attaches/detaches; switching worktrees leaves the previous worktree's dev
   server + Claude running in the background. Requires a bounded scrollback
   ring-buffer per PTY so re-attach replays recent output.

## A. Data model

New top-level `worktrees` array in `cockpit.json`, alongside the existing `tiles`
and `preferences`. Mirrored in the Rust `CockpitConfig` struct and the TS
`CockpitConfig` type (same dual-definition discipline as sub-project 1).

```jsonc
{
  "version": 1,
  "tiles": [ { "id": "wt-1", "type": "worktree", "config": { "worktreeId": "wt-elder-fix-login" } } ],
  "worktrees": [
    {
      "id": "wt-elder-fix-login",
      "name": "fix login",
      "repoPath": "/Users/me/Repos/elder-api",
      "branch": "victor/fix-login",
      "worktreePath": "/Users/me/CockpitWorktrees/elder-api/fix-login",
      "host": { "startCmd": "npm run dev", "address": "http://localhost:3000" },
      "links": [ { "label": "Ticket", "url": "https://linear.app/..." } ],
      "status": "ongoing"
    }
  ],
  "preferences": { "theme": "system", "defaultView": "main" }
}
```

- `status` ∈ `"ongoing" | "completed"` (TS-narrowed; Rust stores a plain
  `String`, matching how `Preferences` already works).
- The composite tile's config is `{ worktreeId: string }` only. Worktree models
  are the data; tiles point at them.
- `version` stays at `1`; adding an optional array is backward-compatible (serde
  `#[serde(default)]` so existing `cockpit.json` files without `worktrees` still
  load).

## B. Rust PTY provider — `src-tauri/src/pty.rs`

The real new tech, and the first **provider** in the provider+panel pattern.

- **Registry:** `HashMap<PtyId, LivePty>` behind Tauri-managed state
  (`Mutex`/`tauri::State`). `PtyId = "{worktreeId}:{role}"`, `role` ∈
  `git | host | claude`.
- **`LivePty`** holds the `portable-pty` master, the child handle, a boxed writer,
  and a bounded scrollback ring-buffer (~64 KB) of recent output bytes.
- **Spawn shape:** every PTY runs the user's `$SHELL` (fallback `/bin/zsh`) with
  `cwd = worktreePath`. Roles with an autostart command (`host` → `startCmd`,
  `claude` → `claude`) get that command written as the first input line. `git`
  gets no command (plain interactive shell). One spawn path for all three.
- **Output stream:** a reader thread per PTY reads master output and (a) appends to
  the ring-buffer and (b) emits a Tauri event `pty://{ptyId}` carrying the chunk.

**IPC commands** (added to the existing handler list; `load_settings`/
`save_settings` untouched):

| Command | Does |
|---|---|
| `pty_ensure(worktreeId, role, cwd, autostartCmd?)` | Spawn if absent; no-op if already alive. Idempotent — safe to call on every tile mount. |
| `pty_attach(ptyId) -> Vec<u8>` | Return buffered scrollback so the re-attaching tile can replay it. |
| `pty_write(ptyId, bytes)` | Forward keystrokes to the child. |
| `pty_resize(ptyId, cols, rows)` | Resize the PTY when xterm fits. |
| `pty_kill(ptyId)` | Kill the child + drop the entry (used by restart/stop). |

## C. Rust git-worktree provider — `src-tauri/src/worktree.rs`

- **`create_worktree(repoPath, name, branchSpec) -> worktreePath`**, where
  `branchSpec` is either:
  - *existing branch*: `git worktree add <path> <branch>`, or
  - *new branch from base*: `git worktree add -b <newBranch> <path> <baseBranch>`.
- **Managed location:** `~/CockpitWorktrees/<repo-basename>/<name>` (slugged). Keeps
  worktrees out of the main working tree and predictable.
- **`remove_worktree(id)`**: removes the Cockpit model entry and kills its 3 PTYs.
  It does **not** run `git worktree remove` / delete files on disk — safe default;
  an explicit "delete from disk" can come later.
- Pure, unit-testable seams: branch-spec → argv construction, and managed-path
  derivation, are pure functions tested without touching git.
- New IPC commands: `create_worktree`, (model removal is a frontend store edit;
  PTY kill on remove goes through `pty_kill`).

## D. React composite `worktree` tile — `src/tiles/worktree/`

One dockview panel, rendered top-to-bottom:

1. **Recent-worktrees dropdown** — lists all `worktrees` with their status badge;
   selecting one sets the tile's `config.worktreeId`. A control toggles the
   selected worktree's status ongoing↔completed.
2. **New-worktree form** (collapsible; expanded when there's no active worktree).
   Fields: name, repo path, *existing branch* OR *new branch + base*, start
   command, host address. Submit → `create_worktree` → append model to the store →
   select it. **Collapsible is the sub-project-3 seam**: inference will populate
   the fields then collapse the form to a confirm summary.
3. **3 stacked xterm.js terminals** (git / host / claude). A `useTerminal(ptyId)`
   hook owns one xterm instance: `pty_ensure` → `pty_attach` (write scrollback into
   the term) → subscribe to `pty://{ptyId}` → `pty_write` on key input →
   `pty_resize` via `@xterm/addon-fit`. Each pane has a restart/stop affordance
   (`pty_kill` then `pty_ensure`).
4. **Editable links list** — add/edit/remove `{ label, url }`; click opens via the
   existing `tauri-plugin-opener`. Persisted on the worktree model.

New frontend deps: `@xterm/xterm`, `@xterm/addon-fit`.

The tile is layout-dumb and config-only, exactly like the stub tiles: it never
knows whether it sits in the right column or expanded in the centre.

## E. PTY lifecycle & restart

- **Switch worktree in dropdown:** the tile detaches (unsubscribes from `pty://`
  events) and sends **no kill**. The previous worktree's host + Claude keep
  running; re-selecting re-attaches and replays scrollback.
- **App relaunch:** OS processes died with the app. On mount for the active
  worktree, the tile calls `pty_ensure` for all 3 roles → they auto-start fresh.
  Only the *active* worktree's terminals start on launch (not every worktree's —
  avoids spawning N dev servers).
- **Wedged process:** the per-pane restart affordance does `pty_kill` + `pty_ensure`.

## F. Persistence

- Worktree **models** persist in `cockpit.json` via the existing debounced Zustand
  store. The store gains the `worktrees` array + actions (add / update one /
  remove / set-active on the tile config). Rust `CockpitConfig` gains the matching
  field with `#[serde(default)]`.
- PTY **sessions** are deliberately not persisted — ephemeral OS processes;
  scrollback is in-memory only.
- **Status** is a manual field; the dropdown toggles it. No auto-status here.

## G. Error handling

Throughline (inherited from sub-project 1): **a bad worktree or PTY never takes
down the layout.**

| Failure | Behaviour |
|---|---|
| `git worktree add` fails (dirty tree, branch exists, path taken) | Surface git's stderr inline in the form; do not create the model. |
| Worktree path missing at attach time (deleted on disk) | Tile shows "worktree path not found" + a remove action; no PTY spawn. |
| PTY spawn fails (bad shell/cmd) | That pane shows the error; the other two panes are unaffected. |
| Child process exits | Pane shows `[process exited]`; restart affordance respawns. |
| Unknown `worktreeId` in tile config | Fall back to the dropdown / empty state (same spirit as `UnknownTile`). |
| Save fails | Inherited: keep in-memory state, non-blocking log/toast. |

## H. Testing

Mirrors sub-project 1: unit-test the pure/risky logic; manual for the GUI.

- **Rust:** `worktree.rs` — branch-spec → `git worktree add` argv (existing vs
  new-branch) and managed-path derivation, as pure functions. `pty.rs` — ring-buffer
  bounded append/replay and `PtyId` formatting. Live PTY spawn is integration-ish →
  light/manual.
- **TS:** pure helpers — worktree model creation/defaults, links-edit reducer,
  active-worktree selection. xterm/dockview interaction → manual.
- **Manual acceptance:** create a worktree (new branch) → 3 terminals appear, host
  + Claude auto-run; type in the git pane; switch worktrees and back → server still
  alive + scrollback replays; quit + relaunch → active worktree's terminals
  respawn; edit a link → opens in browser.
- **Headless verification the agent can run:** `cargo test`, `cargo build`,
  `npm test`, `npm run build`, `tsc --noEmit`. The GUI window the user eyeballs.

## I. Quick win — rename `cockpit-scaffold` → `cockpit`

Isolated, reviewable task: crate `name` in `Cargo.toml` (+ `lib.name` if needed),
`productName`/window title in `tauri.conf.json`, `name` in `package.json`. Bundle
id `com.cockpit.app` is already correct.

## Definition of done

- User can create a worktree (existing or new branch); `git worktree add` runs into
  the managed location.
- The composite tile shows 3 live terminals; host + Claude auto-run; git pane is
  interactive. All target the worktree path.
- Switching worktrees leaves prior processes alive; re-attaching replays scrollback.
- Quit + relaunch respawns the active worktree's 3 terminals.
- Links are editable and open in the browser; status toggles ongoing↔completed.
- Worktree models survive relaunch via `cockpit.json`; old configs without
  `worktrees` still load.
- Rust (`worktree.rs`, `pty.rs` pure logic) + TS (pure helpers) unit tests green;
  app builds and launches.
- `cockpit-scaffold` renamed to `cockpit`.
