# Worktrees view + reusable theme — design

> Status: approved in brainstorming, pending spec review.
> Supersedes the dockview layout decision for the app's views (see "Decision reversal" below).
> Stack context lives in `CLAUDE.md`; product vision in `2026-06-16-cockpit-product-spec.md`.

## Goal

Make the app usable and good-looking by (1) introducing a **reusable dark theme**
and (2) building a dedicated **Worktrees view** — three side-by-side columns, each
displaying one running worktree (the output of the deduce flow). This is primarily
a **styling + view-structure pass**: no new backend providers, no live PTY/git
state detection.

The app gains three named views — **Cockpit · Worktrees · Calm** — but only
**Worktrees** is built out for this MVP. Cockpit becomes a themed placeholder;
Calm is a light decluttered reuse of the Worktrees layout.

## Decision reversal: drop dockview

`CLAUDE.md` and the product spec currently record **dockview** as the resolved
layout engine, chosen for free-form user-rearrangeable tiling. We are **retiring
that decision**:

- The emerging product is a handful of **opinionated, hand-designed layouts**, not
  a free-form dock the user shuffles. Free-form tiling was flagged "needs dedicated
  exploration" and was never validated against real use.
- dockview ships its own themed chrome (tab bars, drag handles, borders,
  watermark). Matching the clean mockup means *suppressing* the very features
  dockview exists to provide, while paying a perpetual CSS-override cost.
- This aligns with stated priorities: **#1 lean & native** (drop a heavyweight dep
  serving one tile) and the convention **"fewer dependencies, fewer abstractions
  until one is needed."**

Views become plain React components laid out with CSS flex/grid over a shared
token theme. Targeted resize/reorder can return later as a deliberate feature if
it ever earns its place.

## The worktree ↔ slot model (core mental model)

Worktrees and columns are **not** 1:1.

- A **worktree** is an independent running entity: created via the deduce flow,
  running until Deleted. There can be **more worktrees than columns**.
- The Worktrees view has **exactly 3 fixed column slots** (no horizontal scroll).
  A slot is a *display location*, not a worktree.
- Each slot shows **one assigned worktree, or nothing**. The slot's title is a
  **`⌄` dropdown picker** listing all running worktrees — choosing one assigns it
  to that slot. An empty slot shows a "Select worktree" dropdown.
- Each column has a **`⚙` settings menu** (top-right) with exactly two actions:
  - **Hide** — unassign the worktree from this slot (the worktree keeps running);
    the slot reverts to the "Select worktree" dropdown.
  - **Delete** — delete the worktree entirely and stop its PTYs (existing
    `removeWorktree` + `pty_kill`; the on-disk directory is preserved, as today).

### Slot state — session-only this pass (no Rust change)

Slot→worktree assignments live in the **Zustand store as session state**
(`slots: (worktreeId | null)[]`, length 3). They are **not persisted to disk** this
pass — persisting would require adding a field to the Rust `CockpitConfig` serde
struct, and we are keeping the backend untouched.

- **On load:** auto-assign the first 3 running (`ongoing`) worktrees to slots 0–2.
- **On Create:** fill the first empty slot with the new worktree; if all 3 are
  full, the worktree is still created + running and selectable in every dropdown,
  just not auto-displayed.
- **On Hide:** set that slot to `null`.
- **On Delete:** remove the worktree from the model + kill PTYs, and clear any slot
  referencing it.

Persisting slot layout across restarts is a **deferred follow-up** (one Rust field).

## Theme system

A single set of **CSS custom properties** (design tokens) — the dark palette from
the mockup — on `:root` in **`src/theme/tokens.css`**, imported once in `main.tsx`.
Components style via **plain colocated `.css` files** with namespaced class names
(e.g. `WorktreeColumn.css`) consuming `var(--…)`. No CSS-in-JS, no CSS-modules
build config — boring and greppable.

Token groups (exact values tuned to the mockup during implementation):

- **Backgrounds:** `--bg` (app), `--surface` (column/pane), `--surface-raised`
  (header bars, menus), `--overlay` (modal scrim).
- **Borders:** `--border`, `--border-subtle`.
- **Text:** `--text`, `--text-secondary`, `--text-muted`.
- **Accent:** `--accent` (teal, used by the segmented control + primary button).
- **Semantic:** `--attention` (amber). (DONE/PAUSED and ahead/behind colors are
  out of scope — not built.)
- **Scale:** `--space-1…6`, `--radius`, `--radius-sm`.
- **Fonts:** `--font-ui` (sans), `--font-mono` (terminals + paths).

This token set is the reusable foundation the other views inherit.

## App shell

`App.tsx` becomes a themed shell, replacing the dockview `Layout`:

- **Header:** brand (`cockpit v0.x`) left · **segmented control**
  (`Cockpit · Worktrees · Calm`) center · **`+ New worktree`** button right.
- **Body:** renders the active view component directly
  (`CockpitView` | `WorktreesView` | `CalmView`).
- Active view is store state; the persisted `preferences.defaultView` seeds it on
  load. `defaultView`'s type widens from `"main" | "calm"` to
  `"cockpit" | "worktrees" | "calm"`; legacy `"main"` (or any unknown value) maps
  to `"worktrees"`.

## Worktrees view

`src/views/WorktreesView.tsx` (+ `.css`):

- Renders **3 `WorktreeColumn`s**, one per slot index (0–2).
- Columns are equal-width via CSS (`flex: 1` within a fixed 3-up row); no
  horizontal scroll.
- Reads `cockpit.worktrees` (the running list, for dropdowns) and the store's
  `slots` (which worktree is in which column).

## WorktreeColumn

`src/views/worktree-column/WorktreeColumn.tsx` (+ `.css`) — the restyle of today's
`WorktreeTile`, now a single-worktree column bound to a slot index.

Props: `{ slotIndex: number; variant?: "full" | "calm" }`.

Top-to-bottom when a worktree is assigned:

- **Header:** status dot (amber on Attention, neutral otherwise) · worktree name
  as a **`⌄` dropdown** (the worktree picker for this slot) · `⚙` settings menu
  (Hide / Delete) at top-right.
- **Chip row:** derived chips (see below).
- **Path line:** `repo · branch · …/worktreePath` in mono/muted.
- **Three terminal panes**, each a themed `WorktreePane`. `WorktreePane` calls the
  unchanged **`useTerminal`** hook directly and owns the themed header bar + the
  xterm container div — **absorbing today's `TerminalPane`** (its plain title +
  restart move into the themed header). PTY wiring is untouched:
  - `localhost` (host) — header shows the start command + a restart `↻` control.
  - `git` — header shows just "git" (no ahead/behind badge).
  - `Claude Code` — header shows the **Attention badge** (visual stub; renders off
    this pass — see below).
  - Every pane header has a **chevron (`⌄`) collapse toggle**. Collapsed → only the
    header bar shows. **Open panes `flex: 1`** so they always expand to fill the
    available vertical space and split it evenly among themselves; collapsing a pane
    gives its space to the others (one open pane fills the whole column). Collapse
    state is per-column component state keyed by role (default: all open). The xterm
    stays **mounted but hidden** when collapsed (e.g. `height: 0`/`hidden`, not
    unmounted) so the existing `ResizeObserver` in `useTerminal` re-fits and
    `pty_resize`s automatically on re-expand — no new resize logic needed. The PTY
    itself lives in Rust and is unaffected.
- **Links** row at the bottom (reused `LinksList`).

When the slot is empty: the column renders only the header with a "Select
worktree" dropdown (the `⚙` menu is hidden/disabled), inviting selection.

`variant="calm"` renders **only the header + the Claude Code pane** (for the Calm
view); `variant="full"` (default) renders everything above.

### Chip derivation (pure, tested)

`src/views/worktree-column/chips.ts` exports `worktreeChips(w: Worktree): Chip[]`,
deriving display chips from existing data only:

- **Linear** — regex `\b[A-Z]{2,}-\d+\b` (case-insensitive) on `name`/`branch`,
  displayed uppercase. Links to the matching Linear URL in `w.links` if present.
- **PR** — `\bpr-(\d+)\b` (case-insensitive) on `name`/`branch` → `PR #N`. Links
  to the matching GitHub PR URL in `w.links` if present.
- **Issue** — `\bissue-(\d+)\b` → `Issue #N`, link from `w.links` if present.
- **Preview** — port parsed from `host.address` → `Preview :PORT`; clicking opens
  `host.address` via `openUrl`.
- **CI** — a **static stub chip** (visually present, not wired). Deferred to a
  future provider sub-project.

Each `Chip` is `{ kind, label, url? }`; the component renders `url`-bearing chips
as clickable (via `openUrl`).

### Attention badge — visual stub

The Claude pane's Attention badge + the header's amber status dot are built with
real styling but **not driven by any live signal** this pass (render in the
off/neutral state; a sample/forced state may be shown in tests/storybook only).
Detecting "Claude is calling" from PTY output is real backend work deferred to a
provider sub-project. No other Claude states (DONE/PAUSED) are built.

## New-worktree modal

`src/views/NewWorktreeModal.tsx` (+ a small generic `src/views/Modal.tsx` for the
scrim/centering) — a themed centered overlay hosting the **existing
`NewWorktreeForm` unchanged** (deduce → pre-fill → Create logic untouched, only
re-skinned). Opened by the header `+ New worktree` button. On Create:
`onCreated(id)` adds the worktree to `cockpit.worktrees` (existing path) and the
store assigns it to the first empty slot (or leaves it dropdown-only if full); the
modal closes.

`NewWorktreeForm`, `LinksList`, and `KnownReposEditor` are **reused as-is**
(re-themed via CSS only).

## Cockpit + Calm (secondary)

- **`CockpitView`** — minimal themed placeholder ("coming soon" / empty state),
  inheriting the theme. No tiles.
- **`CalmView`** — renders the 3 slots using `WorktreeColumn variant="calm"`
  (header + Claude pane only), matching the spec's "most important tile per
  worktree."

## Files

**New:**
- `src/theme/tokens.css`
- `src/views/WorktreesView.tsx` (+ `.css`)
- `src/views/CockpitView.tsx`
- `src/views/CalmView.tsx`
- `src/views/Modal.tsx`, `src/views/NewWorktreeModal.tsx` (+ `.css`)
- `src/views/worktree-column/WorktreeColumn.tsx` (+ `.css`)
- `src/views/worktree-column/WorktreePane.tsx`
- `src/views/worktree-column/chips.ts` (+ `chips.test.ts`)
- `src/views/slots.ts` (+ `slots.test.ts`) — pure slot reducers
  (`assignFirstEmpty`, `hide`, `deleteWorktree`, `initFromWorktrees`).

**Modified:**
- `App.tsx` — themed shell + view switching (no dockview).
- `src/main.tsx` — import `tokens.css`.
- `src/settings/types.ts` — widen `defaultView`.
- `src/settings/store.ts` — drop dockview geometry `setView`; add session slot
  state + slot actions.
- `package.json` — remove `dockview`.

**Deleted:**
- `src/layout/Layout.tsx`, `src/layout/UnknownTile.tsx`
- `src/settings/reconcile.ts`, `src/settings/reconcile.test.ts`
- `src/tiles/registry.ts`, `src/tiles/registry.test.ts`, `src/tiles/index.ts`
- `src/tiles/clock/ClockTile.tsx`, `src/tiles/notes/NotesTile.tsx`
- `src/tiles/worktree/WorktreeTile.tsx` (replaced by `WorktreeColumn`)
- `src/worktrees/TerminalPane.tsx` (absorbed into `WorktreePane`; `useTerminal`,
  `ptyId`, `api`, `model` are reused unchanged)

`Settings.layout` / `LayoutConfig` stays in the types and continues to round-trip
to Rust untouched (we simply stop reading/writing view geometry) — avoids a Rust
change. The `tiles` array in `cockpit.json` likewise stays in the model but is
unused by the UI this pass.

## Testing

- **`chips.test.ts`** — Linear/PR/Issue regex extraction (incl. lowercase branch
  vs. uppercase name), port parsing, link matching from `w.links`, CI-stub
  presence.
- **`slots.test.ts`** — `initFromWorktrees` takes first 3 ongoing; `assignFirstEmpty`
  fills the first `null`; `hide` clears one slot; `deleteWorktree` removes the
  worktree and clears referencing slots.
- Existing `model.test.ts` / `store.test.ts` stay green (adjusted for removed
  geometry `setView`); `reconcile.test.ts` is deleted with `reconcile`.
- **No Rust changes** → `cargo test` unaffected.

## Docs

- **`CLAUDE.md`** — retire dockview "as-built" notes; record the CSS-token theme +
  hand-built-views architecture and the 3-slot worktree model.
- **Product spec** — three named views; dockview decision reversed with rationale;
  Worktrees-replaces-Main.

## Out of scope (deferred)

- Persisting slot assignments to disk (needs one Rust field).
- Live Claude "Attention" detection; git ahead/behind; CI integration.
- DONE/PAUSED Claude states.
- Cockpit dashboard content; per-column resize/reorder; add/remove slots.
- "Mark completed" action (dropped from the per-column menu for now).
