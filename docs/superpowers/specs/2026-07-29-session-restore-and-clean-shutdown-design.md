# Session restore + clean shutdown — design

**Date:** 2026-07-29
**Status:** approved, ready for a plan

## A. Problem

Quitting and reopening the app does not bring you back to where you were.

1. **The Worktrees view always shows the same three worktrees.** Slot assignments are session-only:
   `initSlots` (`src/views/slots.ts`) rebuilds them on every launch as "the first `SLOT_COUNT` worktrees
   with `status === "ongoing"`, in `cockpit.json` order". With six ongoing worktrees you get the same
   first three every time, regardless of what was on screen when you quit.
2. **Every worktree comes back Claude-only.** The `worktreePanes` store slice (which panes exist — Claude,
   the Run/host pane, extra shells — plus their collapse state) is session-only by design; the persisted
   `paneOpen` field was deliberately deleted in the 2026-07-10 lazy-panes iteration.
3. **Nothing is stopped on the way out.** `lib.rs` registers no window/run-event hook, so PTY children
   (login shells, `claude`, dev servers) are never explicitly killed — they die only as a side effect of
   process teardown, which is not guaranteed to reach grandchildren such as `npm run dev`.

**Goal:** reopening the app looks — and runs — like it did when it was shut, and shutting it leaves no
processes behind.

## B. Scope

In scope: killing PTY processes at exit; persisting and restoring the Worktrees-view slot assignments,
scratch terminals, per-worktree pane sets and their collapse state, and the last active view; resuming the
Claude conversation and re-running the dev server in restored panes.

Out of scope: terminal *scrollback* restore (a restored pane is a new process with an empty screen);
surviving a crash or force-quit (orphans remain possible, as today); changing the restart button's
behaviour; the `cockpitWorktreeId` pin (already persisted).

## C. Clean shutdown

`pty.rs` gains `PtyManager::kill_all()`: drain the whole registry, `child.kill()` each entry, drop the
masters. `child.kill()` is portable-pty's unix `ChildKiller` impl for `std::process::Child`: it sends
`SIGHUP` directly to the shell's pid (escalating to `SIGKILL` only if the shell is still alive after a
short grace period), and the shell — a session leader — forwards that HUP to its job-control children —
**that** is the mechanism that reaches grandchildren like `claude` and `npm run dev`; killing the login
shell with `SIGKILL` instead would not, since a killed-not-hupped shell never gets to relay anything.
Dropping the master is incidental here, not the mechanism: the master fd is dup'd three times (the
registry entry, the reader thread, the writer), so dropping one copy doesn't hang up the line. This
mirrors the existing per-pane `pty_kill`, which the pane Close button already relies on.

`lib.rs` switches from `.run(tauri::generate_context!())` to `.build(...)` + `.run(|app, event| …)` and
calls `kill_all()` on `RunEvent::Exit`, which covers both Cmd+Q and closing the last window.

A hard kill is safe for Claude: it writes its conversation transcript incrementally, so `--continue`
still finds the session afterwards.

## D. Persisted shape

A new **optional** `workspace` block in `cockpit.json`, next to the `cockpitWorktreeId` that already lives
there (same class of state). `layout.json` was considered and rejected: it is documented as *disposable*
geometry that silently falls back to defaults on corruption, which is too lossy for state the user asked
to survive.

```json
"workspace": {
  "slots": ["wt-1784043828818", null, "scratch-1"],
  "scratch": [{ "id": "scratch-1", "title": "Scratch 1" }],
  "scratchSeq": 1,
  "panes": {
    "wt-1784043828818": {
      "host": true,
      "extras": ["shell-1"],
      "seq": 1,
      "open": { "claude": true, "host": true, "shell-1": false }
    }
  }
}
```

Rust: `Option<Workspace>` with `skip_serializing_if = "Option::is_none"` — **not** `#[serde(default)]` on a
bare struct. The absent/empty distinction is load-bearing:

- **absent** (a pre-feature `cockpit.json`) → fall back to today's `initSlots` behaviour;
- **present with `slots: []`** → the user closed every column; restore that faithfully.

`panes` values are the existing `WorktreePaneSet` shape (`host`, `extras`, `seq`, `open`) serialised as-is.

The last active view is written into the existing `preferences.defaultView`, whose meaning ("the view you
open in") already matches. It has no UI today and currently holds a stale legacy `"main"`, so nothing the
user set is being overwritten.

## E. No duplicated state

Session state stays the single source of truth. The `workspace` block is composed at **save** time:
`scheduleSave` in `src/settings/store.ts` already snapshots `get()`, and gains one pure step,
`withWorkspace(cockpit, state)`, so whatever is written always carries the current slots, scratch
terminals and pane sets. The in-memory `cockpit` object therefore never holds a `workspace` copy that
could drift.

The session-mutating actions (`setSlot`, `addEmptySlot`, `removeSlot`, `swapSlots`, `placeNewEntity`,
`addScratch`, `removeScratch`, `renameScratch`, and the pane actions) each need to *trigger* a save; they
get it through a small `setSession()` wrapper (`set(partial)` then `scheduleSave(get)`). Because these
call sites only trigger a flush rather than copy state, a missed one merely delays persistence until the
next save instead of writing something wrong.

Accepted cost of reusing the existing 500 ms debounce: a change made in the final 500 ms before quitting is
lost. A `CloseRequested` handshake (Rust asks the webview to flush, then exits) was rejected — it would
block quit if the webview did not answer, to protect against a case the debounce already covers.

## F. Restore rules

Pure and unit-tested, in a new `src/settings/workspace.ts`:

- **Slots** restore in order with freshly minted keys — a slot `key` is React reconciliation identity and
  is meaningless on disk. Capped at `SLOT_COUNT` defensively.
- **An id that no longer resolves** (worktree deleted by another instance, or a hand-edited config) becomes
  an **empty column** rather than disappearing: the column count the user left is preserved, and the empty
  slot already renders a picker.
- **`scratchSeq`** restores as `max(persisted seq, highest n among restored scratch ids)`, so a
  hand-edited file cannot mint a colliding `scratch-<n>`.
- **`panes`** entries whose worktree id no longer exists are pruned.
- Restoration ignores `status`; the `ongoing` filter survives only in the legacy `initSlots` fallback.

## G. Restoring the processes

`WorktreeBody` renders panes purely from the pane set, so restoring the set brings the panes back with no
component change, and the host pane's autostart is already `worktree.host.startCmd` — a restored
`host: true` re-runs the dev server on its own. Extra shells and scratch panes come back bare, as they do
when freshly created.

The one new behaviour is the Claude pane. `claudePaneAutostart` (`src/worktrees/claudeCmd.ts`, already a
pure tested builder) gains a `restored` input, with this precedence:

1. **one-shot deduce prompt** → `claude '<prompt>'` (unchanged; wins over everything)
2. **restored pane** → `claude --continue || claude`
3. otherwise → `claude`

`|| claude` is the fallback for `claude --continue` exiting non-zero when the worktree has no prior
conversation (Claude was never used there, or the transcript was cleaned up); without it the pane would
land on a bare shell showing an error. Known trade-off: if you resume a session and then quit Claude with
a non-zero status, the fallback relaunches it fresh. The alternative — probing
`~/.claude/projects/<mangled-cwd>/` for a session file before choosing the command — was rejected as it
depends on an undocumented internal layout.

Known trade-off (pre-existing, not a regression from this branch): if the app quits between
`createWorktree` resolving and the Claude pane's first `pty_ensure`, `worktree.prompt` persists but the
session-only `initialPromptPending` flag does not, so on relaunch the pane takes the restored-branch path
and the deduce prompt is never auto-sent — the copy-prompt button remains as the fallback.

"Restored" is session-only state (`restoredWorktrees: Record<string, true>`), cleared on the Claude pane's
first spawn via the existing `onEnsured` hook — the same idiom as `initialPromptPending`. So only the first
spawn after launch continues; the pane's restart button and every later spawn run plain `claude`.

`init` seeds it from **every worktree id in the restored workspace** — the restored slot ids, the keys of
the restored `panes` map, and `cockpitWorktreeId` — not from the `panes` map alone: a worktree that was
sitting Claude-only has no `panes` entry at all (the map only gains one once Run/Add/collapse is used), and
that is the most common case. Because the flag is keyed per worktree rather than per view, a worktree shown
in the Cockpit or Calm view continues its conversation the same way.

## H. Files touched

| File | Change |
|---|---|
| `src-tauri/src/pty.rs` | `PtyManager::kill_all()` |
| `src-tauri/src/lib.rs` | `.build()` + `RunEvent::Exit` hook |
| `src-tauri/src/settings.rs` | `Workspace` / `PaneSet` structs on `CockpitConfig` |
| `src/settings/types.ts` | matching TS types |
| `src/settings/workspace.ts` | **new** — pure snapshot + restore helpers |
| `src/settings/store.ts` | `init` restore, save-time composition, `setSession` |
| `src/worktrees/claudeCmd.ts` | `restored` → `claude --continue \|\| claude` |
| `src/views/worktree-column/WorktreeBody.tsx` | thread the restored flag |
| `src/App.tsx` | persist the active view on switch |

## I. Testing

**Unit (pure):** workspace snapshot/restore round-trip; unresolvable id → empty slot; `scratchSeq` clamp;
pane pruning; autostart precedence (prompt > restored > plain). **Rust:** `Workspace` serde round-trip,
a pre-feature `cockpit.json` still loading, and `kill_all` draining the registry (spawn a `sleep 60` pty,
call it, assert the table is empty and the child is dead).

**Manual end-to-end** (not headlessly drivable — needs a human):

1. Arrange three specific tiles, at least one differing from "first three ongoing"; include a scratch
   terminal, one worktree with Run pressed (dev server up) and one collapsed extra shell; hold a Claude
   conversation in one pane.
2. Confirm the dev server holds its port (`lsof -i :<port>`).
3. Quit. Confirm the port is free and no orphan `claude` / `node` processes remain (`ps`).
4. Relaunch. Confirm: same view, same three tiles in the same order, the scratch terminal back, the dev
   server running again, the extra shell present and still collapsed, and the Claude pane continuing the
   previous conversation.
