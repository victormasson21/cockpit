# Calm view decoupling — design

Date: 2026-08-04
Status: approved, not yet implemented

## Problem

Three defects make Calm feel broken, and they share one cause.

1. **Terminal content does not reflow when switching into or out of Calm** — Claude Code's TUI comes back
   with broken linebreaks and misplaced boxes.
2. **The focused-pane indicator (blue border) never appears in Calm.**
3. **The attention highlight (warm-red border + glow) never appears in Calm** — only the small text badge.

The cause is that **Calm is a second *mount* of the same panes, not a second *presentation* of them**.
`App.tsx` renders `{view === "calm" && <CalmView />}` alongside `{view === "worktrees" && <WorktreesView />}`,
so every switch unmounts one tree and mounts the other, disposing and rebuilding each xterm — even though
both views render the *same* `slots` from the store.

### Why the reflow breaks (the mechanism)

On each remount `useTerminal`:

1. creates a fresh `Terminal`, calls `fit.fit()` (`useTerminal.ts:103`) — at this point the initial resize
   event fires with **no listener attached**, because `term.onResize` is only registered at line 149;
2. calls `pane.ensure({ cols, rows })` — but `pty_ensure` **returns early on a live PTY** (`pty.rs:83`) and
   never applies the new size;
3. calls `pane.attach()` and writes the replayed scrollback.

Net effect: the PTY keeps whatever `cols`/`rows` it was first spawned with, forever. Claude Code never
receives `SIGWINCH`, so it never repaints — and bytes drawn for the old width are written into a terminal
of the new width. This is **not Calm-specific**; Calm merely exposes it worst, because its
`max-width: 760px` differs most from a full column's width. The same bug affects Cockpit ↔ Worktrees for a
pinned worktree, and changing a slot's worktree via the picker.

### Why focus and attention are invisible

Both cues are borders on a pane whose border Calm removes:

- `.wt-pane--focused:not(.wt-pane--attention) { border-color: var(--accent) }` loses to
  `.wt-col--calm .wt-pane { border: none }` (`WorktreePane.css:52`) on specificity — there is no border to
  colour.
- `.wt-col--calm .wt-pane--attention { border: none; box-shadow: none }` (`WorktreePane.css:61`) switches
  attention off deliberately, on the reasoning "a glow is a frame".

### The coupling behind all of it

Calm shares everything with Worktrees but expresses itself by *subtraction*:

| Site | Calm-specific |
|---|---|
| state | none of its own — same `slots` / `setSlot` |
| `SlotColumn.tsx` | `variant?: "full" \| "calm"`, 5 branches |
| `WorktreeBody.tsx` | `variant` + a calm-only `switcher?: ReactNode`, 6 branches |
| `WorktreePane.tsx` | the `lead` slot exists only to receive calm's switcher |
| `WorktreeColumn.css`, `WorktreePane.css` | 13 `.wt-col--calm` rules, all subtractive |
| `CalmView.tsx` | 16 lines; imports `WorktreesView.css` and applies `.wt-view--single` to a *different element* than Worktrees does |

Calm's only genuinely *additive* behaviour is moving the switcher into the Claude pane header.

## Solution

Three changes. A is the structural fix, B makes the fix hold on paths that legitimately remount, C restores
the two cues.

### A. One mount, two densities

Render the slot columns **once** and let the view toggle a class, instead of swapping component trees.

- `CalmView.tsx` is **deleted**. `WorktreesView` gains a `calm: boolean` prop and renders
  `.wt-view.wt-view--calm` when set. `App.tsx` renders it for both `view === "worktrees"` and
  `view === "calm"`, so React keeps the same element identity across the switch and no xterm is disposed.
- Calm's suppressions become CSS on `.wt-view--calm`: the `+` rail, the swap buttons, the column divider,
  the chips row, the Run/Add bar, and the host/extra panes. The gear menu stays a JS branch in
  `SlotColumn.tsx` (`variant !== "calm"`): it is what hides the gear specifically on scratch, pending and
  empty Calm columns, whose column header still renders in Calm (only a calm worktree skips the header
  outright, moving its switcher into the Claude pane instead).
- The width change then flows through the path xterm is designed for: `ResizeObserver` → `fit()` →
  `term.onResize` → `pty_resize` → `SIGWINCH` → Claude repaints itself. **No replay, no stale bytes.**

`variant` stops being a prop threaded through three components. `WorktreeBody` loses its `variant`
parameter and all six branches: the chips row, the Run/Add bar, the host pane, the extra shells and the
copy-prompt button all render always and are hidden by CSS in Calm.

The sixth branch is behaviour, not a region, and needs a decision: `paneProps` currently routes
collapse/expand through the store slice for `full` and leaves the pane self-managed for `calm`. With one
mount there is one component instance, so it must pick one — **it always routes through the slice**, and
Calm hides the chevron and expand buttons in CSS (it already hides them today). A Calm worktree therefore
has exactly one visible pane, which the slice already keeps open.

This also removes an inconsistency: Worktrees applies `.wt-view--single` to `.wt-view__cols` while
`CalmView` applied it to `.wt-view`. One component means one structure, so single-column centring behaves
identically in both densities.

**Retained by decision:** the switcher still moves into the Claude pane header in Calm, so the
`switcher` → `lead` prop chain survives. It is the one thing CSS cannot express, and it is the look Calm
was designed around. `SlotColumn` keeps a `variant` prop for that single decision only.

**Consequence to accept:** in Calm the host/extra panes are now *mounted but hidden* rather than absent.
They were already mounted whenever the user was on Worktrees, so no new PTY is spawned and no process
lifetime changes — but a hidden pane's container measures 0, so the `ResizeObserver` callback in
`useTerminal` must **skip `fit()` when the container has zero width or height**. We guard this ourselves
rather than relying on `FitAddon`'s internal handling, so a zero-size measurement can never be pushed to
the PTY as a bogus size.

**Restore is the exception to "no process lifetime changes":** that reasoning holds for switches within a
running session, but not for restoring the app straight onto Calm — the active view persists to
`preferences.defaultView`, and the restored workspace brings back `host: true` and any extra shells
regardless of view. Reopening onto Calm therefore does spawn those PTYs, including autostarting the dev
server, where the old, separately-mounted `CalmView` never rendered them and nothing spawned until the
user opened Worktrees. **Accepted deliberately:** restore is meant to bring back what was running, and
switching to Worktrees correctly shows it already live. Cost: a hidden pane binds a port, so a spawn
failure (`EADDRINUSE`, a crash) is invisible until the user leaves Calm.

### B. Resize the PTY on attach

In `useTerminal`, after wiring the output subscription, resize the PTY to the terminal's current dimensions
when the pane's container has measurable dimensions — guarded to prevent a hidden mount from locking the PTY
at xterm's default 80×24. This fixes the same defect on every path that genuinely remounts — Cockpit ↔
Worktrees for a pinned worktree, switching a slot's worktree in the picker, app restart.

**Ordering is load-bearing**, in this exact sequence:

1. `term.write(scrollback)` — catch the terminal up on history;
2. `pane.onOutput(...)` — subscribe;
3. `pane.resize(term.cols, term.rows)` — trigger the repaint.

The resize must come **after** the subscription: `SIGWINCH` makes Claude emit a full repaint, and if we are
not yet listening those bytes land in the Rust scrollback buffer instead of on screen, so the pane would
stay broken until the next attach.

### C. Give the Calm pane a border to light up

- Replace `.wt-col--calm .wt-pane { border: none }` with `border-color: transparent`. The 1px box is kept,
  so lighting it up causes **no layout shift**, and at rest the pane still floats.
- **Delete** `.wt-col--calm .wt-pane--attention { border: none; box-shadow: none }`.

Focus then shows `--accent`, attention shows `--bad` + glow, and the `:not(.wt-pane--attention)` selector
continues to guarantee attention outranks focus. The `Attention` text badge is unchanged.

This reverses the earlier "a glow is a frame" decision: a cue the user cannot see is worse than a frame,
and Calm is where an unattended Claude pane is most likely to be sitting.

## Testing

The suite is pure-logic only, and every one of these changes lives in React effects, CSS, or IPC ordering —
so **none of it is unit-testable as written**, and no test is invented to pretend otherwise. Existing tests
must stay green (`slots`, `paneSet`, `paneLifecycle`, store slices are untouched).

`npm install` is required first: this worktree has no `node_modules`.

GUI smoke is the acceptance gate:

1. Claude running in a Worktrees column → switch to Calm → **the TUI repaints at the new width**, no broken
   linebreaks; switch back → repaints again.
2. Same check with 2 and 3 assigned columns, and with the window resized between switches.
3. Click into a Calm terminal → **quiet blue border**; click away → it goes.
4. Let a Claude pane bell in Calm → **warm-red border + glow + badge**; type a reply → all three clear.
5. Bell while on Worktrees, then switch to Calm → the highlight is still there (store state survives, and
   now so does the mount).
6. Run a dev server + add an extra terminal on Worktrees, switch to Calm and back → **both panes are still
   alive with their scrollback**, and Calm showed neither.
7. Pinned worktree: Cockpit ↔ Worktrees → repaints correctly (this is change B alone, on a path that still
   remounts).

## Out of scope

- **Decoupling Calm's slot selection.** Calm keeps sharing `slots` with Worktrees: "same work, one density"
  matches the product spec's framing of Calm as a decluttered read of the same worktrees, and a separate
  selection would mean a second slot array, a second restore block in the persisted `workspace`, and a
  picker in the view whose whole point is fewer controls.
- **Keeping the Cockpit view mounted too.** Cockpit renders a different entity (`cockpitWorktreeId`), so
  merging it buys only the remount fix that change B already delivers, at the cost of holding every tile
  and terminal live at once.
- **The animated background.** This spec is the gardening that makes Calm worth keeping; the background is
  a separate iteration on top of it.
- Persisting which panes are open per view, and any change to pane process lifetime beyond the restore
  consequence recorded in Solution A (that one is inherent to session restore, not a scope choice made
  here).
