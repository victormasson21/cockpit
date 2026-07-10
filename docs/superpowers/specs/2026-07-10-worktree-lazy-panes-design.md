# Worktree lazy panes — Claude-first column, Run/Add terminals, pin-to-Cockpit

**Date:** 2026-07-10
**Status:** approved (brainstorm 2026-07-10)
**Supersedes:** the fixed 3-pane worktree body (host/git/claude) and the persisted `paneOpen`
arrangement (CLAUDE.md "Terminal pane expand + close buttons" note). Any future plan that
assumes a worktree always has host/git panes must be read against this spec.

## Goal

A worktree column starts as **one Claude terminal at full height**. The localhost and git
terminals are no longer spawned at creation:

- **`▶ Run`** starts the localhost terminal on demand (runs `host.startCmd`, as today).
- **`+ Add`** opens a plain extra shell cd'd into the worktree (no command), up to **2**.
- Both buttons sit at the **bottom of the column, below the panes, ~50% width each**.
- A **pin button** in the chips/links row (Worktrees view **only**) sets/unsets this worktree
  as the Cockpit view's right-column worktree (`cockpitWorktreeId`).

Decisions from the brainstorm:

| Question | Decision |
|---|---|
| Dedicated git pane | **Removed entirely** — Add-shells cover it |
| Extra shells | **Cap 2**; open panes share height by equal flex (today's behavior) |
| Close on host/extra panes | **Removes the pane** (kill PTY + drop from set); Claude keeps respawn-bare |
| Persistence | **Session-only** — restart ⇒ every worktree is Claude-only again |
| Run while host running | Disabled (not hidden) |
| Run with blank `startCmd` | Disabled with a hint (checkout-created worktrees) |
| Extra shells & attention | **Armed** (like scratch shells — user may run Claude in one) |
| Pin button | Toggle, active state when already pinned |

## Model — session-only store slice (no new Rust surface; one config-field deletion)

New slice in `src/settings/store.ts`, mirroring `scratchTerminals`:

```ts
// per-worktree dynamic pane set; absent entry = Claude only, open.
worktreePanes: Record<string, WorktreePaneSet>
type WorktreePaneSet = {
  host: boolean;            // Run pressed and pane not closed
  extras: string[];         // extra-shell roles, e.g. ["shell-1", "shell-3"], max 2
  seq: number;              // monotonic per worktree — closed panes' roles are never reused,
                            // so a new pane can't attach to a dead pane's scrollback
  open: Record<string, boolean>; // collapse state per role (claude/host/shell-n); absent = open
};
```

Actions (reducers as pure tested helpers in `src/views/slots.ts` or a new
`src/worktrees/paneSet.ts`): `runHost(id)`, `addPane(id)` (no-op at cap), `removePane(id, role)`,
`togglePane(id, role)`, `expandPane(id, role)` (open me, collapse current siblings).
`removeWorktree` also drops the entry.

- **PTY roles:** `claude` (always), `host` (Run), `shell-<n>` (Add). All reuse the unchanged
  `pty_ensure` (`cwd = worktreePath`; autostart only for host = `host.startCmd` and claude =
  existing `claudePaneAutostart`).
- **Attention:** `isAttentionRole` (`src/worktrees/ptyId.ts`) extends to `role === "claude" ||
  role === "shell" || role.startsWith("shell-")`.
- **`paneOpen` is deleted:** the Rust `pane_open` field + `PaneOpen` struct, the TS
  `PaneOpenState` type, and `WorktreeBody`'s persisted open-state wiring all go. Old
  `cockpit.json` files still load — serde ignores unknown fields.

## UI

**`WorktreeBody` (full variant):** chips/links row (+ pin), path line, then panes in order
**Claude → host (if running) → extras**; all open panes flex-fill equally, collapsed ones shrink
to their header (unchanged CSS behavior). Below the panes, a `wt-col__actions` bar:

- **`▶ Run`** (play icon): `runHost(id)` → host pane mounts, `pty_ensure` autostarts
  `host.startCmd`. Disabled while `host === true` or `startCmd` is blank (title hint
  "no start command configured").
- **`+ Add`**: `addPane(id)` → new `shell-<seq>` pane, no autostart. Disabled at 2 extras.

**`WorktreePane` chrome unchanged** (restart · close · expand · chevron), one behavior change:
an optional `onClose` prop overrides the built-in respawn-bare close. Host/extra panes pass
`onClose` = kill PTY (`pty_kill`) + `removePane`; the Claude pane omits it (respawn-bare, as
today — it can't be removed). Expand/collapse route through the slice (`expandPane`/`togglePane`)
across whatever siblings currently exist.

**Pin button:** rendered in the chips row only when a new `pinnable` prop is true — threaded
`WorktreesView → SlotColumn → WorktreeBody`. Calm and Cockpit views don't pass it. Click toggles
`setCockpitWorktree(id)` / `setCockpitWorktree(null)`; active styling when
`cockpitWorktreeId === id`.

**Untouched:** Calm view (single Claude pane, no buttons), Cockpit right column (same new body,
no pin), scratch terminals, Checkout, the deduce flow (new worktrees simply no longer spawn
host/git), `useTerminal`, and all Rust code except the `pane_open` config-field deletion.

## Teardown / Pause

`killWorktreePtys` (`src/worktrees/teardown.ts`) drops the fixed `WORKTREE_ROLES` list and kills
the **live pane set from the store**: `claude` + `host` (if set) + `extras`. Complete by
construction — the pane set and the Rust PTY registry are both session-scoped, so no PTY can
exist outside the slice. (`git`/`host` ids from pre-upgrade sessions can't survive an app
restart.)

## Error handling

- Failed host/extra spawn: unchanged in-pane `[failed to start: …]` (spec §G behavior).
- `pty_kill` on close is idempotent (Ok on missing id) — a pane whose PTY already died removes
  cleanly.
- Run/Add during pending teardown: the gear menu already gates pending entities; teardown kills
  by the live set, so a just-added pane is still covered.

## Testing

- Pure reducer tests: cap-at-2, seq monotonicity (no role reuse after remove), removePane,
  expandPane collapses current siblings only, togglePane default-open.
- `isAttentionRole` cases for `shell-<n>`.
- Teardown tests updated: kills the dynamic set (worktree with host+2 extras vs Claude-only).
- Model tests updated for the deleted `PaneOpenState`.
- Rust: config round-trip test updated (drop `pane_open`), plus a legacy-field load test
  (old JSON with `paneOpen` still parses).

## Docs to update (part of this iteration)

- **CLAUDE.md as-built notes:** the 3-pane descriptions, the "Terminal pane expand + close
  buttons" note (persisted `paneOpen` is gone), the teardown "3 PTYs" wording, this spec's
  as-built note.
- **ROADMAP.md:** no queued item is invalidated, but re-read the Worktrees & Checkout items
  against this spec ("path not found" banner now concerns fewer always-on panes).
