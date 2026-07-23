# Responsive add/remove panel logic (Worktrees view)

**Date:** 2026-07-22
**Status:** approved, ready for plan
**Scope:** the **Worktrees view** column layout (Calm mirrors it; Cockpit's single column is untouched).

## Problem

Today the Worktrees view shows a fixed number of columns chosen by a manual header
**2 / 3 toggle** (`slotCount`). Every visible column — even empty ones — carries a
`Select…` dropdown, and the user must manually assign each slot. Swapping two tiles'
positions means fiddling with dropdowns. The layout doesn't respond to how many
worktrees are actually in play.

## Goal

Make the view **responsive to the number of assigned tiles**:

- **0 assigned** → no columns, just the `+` rail.
- **1 assigned** → single column, **centered**.
- **2 assigned** → today's 2-up layout.
- **3 assigned** → today's 3-up layout.

Adding or removing a tile **automatically reflows** between the 1/2/3 layouts. There is
no manual column-count toggle.

## Interaction model

- A slim **40px `+` rail** sits on the right-hand side of the Worktrees view. Clicking it
  **reveals one more column in the empty state** — the existing `⚙ Select… ⌄` header +
  "Nothing in this slot." body. The user then assigns a worktree/scratch via that
  dropdown.
- The `+` rail is **hidden when 3 columns are shown** (the cap).
- **Assigned tiles** keep their `Select…` dropdown (that's how you switch/reassign a
  column — and, for now, how you swap positions; see Out of scope).
- **Columns beyond what is shown are not rendered at all** — no lingering empty dropdown
  columns. "Empty" only exists as a `+`-added slot the user is actively about to fill.
- **Dismissing tiles:** the gear ⚙ menu appears on **empty slots too**, but with **only
  Close** (no Pin/Pause/Delete/Wipe). Assigned tiles keep the full menu. Close, Pause
  completion, and Delete/Wipe teardown all **remove the column and reflow** (rather than
  leaving a null column behind).

## Data model

Replace the fixed-length `slots: (string|null)[]` **and** the separate `slotCount` with a
**variable-length, keyed array**:

```ts
type Slot = { key: string; id: string | null }; // id === null → shown-but-empty slot
slots: Slot[];                                    // length 0..3; length IS the column count
```

- Each slot carries a **stable `key`** minted from a session `slotSeq` counter (same idiom
  as `scratchSeq` / `pendingSeq`). Stable keys mean removing a middle column and reflowing
  **does not remount the surviving columns' terminals** — today's `key={index}` would.
  Content changing within a column (switching worktrees) is still handled by the existing
  inner `key={worktree.id}` on `WorktreeBody`.
- Removed: `slotCount`, `setSlotCount`, `hideSlotsBeyond`, `MIN_SLOTS`, and all reads/writes
  of `preferences.panes`. `SLOT_COUNT = 3` (the cap) stays.
- **Back-compat:** the Rust `preferences.panes` field is left in place (serde ignores an
  unread field); old `cockpit.json` still loads. We simply stop reading/writing it from the
  frontend.

### Pure helpers (`src/views/slots.ts`)

All operate on `Slot[]` and are keyed, not index-based (splicing shifts indices):

- `initSlots(worktrees, mintKey)` — build `[{key,id}]` from the first `SLOT_COUNT`
  **ongoing** worktrees. Zero ongoing → `[]` (no columns).
- `addEmptySlot(slots, mintKey)` — append `{key, id:null}` if `length < SLOT_COUNT`; else
  no-op.
- `setSlotId(slots, key, id)` — set one column's content by key (id or null = empty-in-place).
- `removeSlot(slots, key)` — splice the column out; reflows.
- `placeEntity(slots, id, mintKey)` — placement for a newly created worktree/scratch/pending:
  fill the first empty (`id===null`) slot → else append if `length < SLOT_COUNT` → else
  **replace the rightmost** column's id (the bumped worktree keeps running, re-assignable).
- `clearEntity(slots, id)` — **splice** any column whose id matches a removed entity
  (worktree/scratch deletion reflows the layout).
- `swapSlotId(slots, from, to)` — replace matching ids in place, **keeping the key** (pending
  → real worktree stays in the same column).

`mintKey` is passed in (a `() => string` from the store's `slotSeq`) so the helpers stay
pure and unit-testable.

## Components

### `WorktreesView`

Renders `slots.length` `SlotColumn`s (keyed by `slot.key`) inside `.wt-view`, followed by an
`AddSlotRail` when `slots.length < SLOT_COUNT`.

- **Centering at 1:** a modifier (e.g. `.wt-view--single`) centers the lone column with a
  sensible max-width; 2/3 stay full-bleed equal columns.
- `AddSlotRail` — a 40px-wide full-height column with a large `+` button; click →
  `addEmptySlot`.

### `SlotColumn`

- New `onClose?: () => void` prop. Gear **Close**, `pauseActive` completion, and
  `TeardownConfirm` `onDone` call `onClose` when provided (Worktrees passes
  `() => removeSlot(key)`); otherwise fall back to `onSelect(null)` (Cockpit's single-column
  unassign, unchanged).
- Gear ⚙ now renders on **empty slots** too, showing **only Close**. Assigned worktree/scratch
  slots keep the full menu (Pin/Close/Pause/Delete/Wipe or Close/Delete for scratch).
- The `Select…` dropdown clear row still calls `onSelect(null)` = empty-in-place (keeps the
  column; distinct from Close which removes it).
- Signature moves from index-based `onSelect(id)` wiring to key-based in the Worktrees host,
  but `SlotColumn`'s own props stay `value` / `onSelect` / `onClose` — the host binds them to
  a specific `key`.

### `CalmView`

Mirrors Worktrees: renders the same shared `slots` (same `slot.key` keys), driven by
`slots.length`. **Kept decluttered — no `+` rail, no gear** (tile set is managed from the
Worktrees view; Calm just reflects it).

### `App`

Remove the header **2 / 3 panes toggle** block and the `.app__panes` / `.app__pane*` CSS.
Drop the `slotCount` / `setSlotCount` / `MIN_SLOTS` imports and usage.

### `CockpitView`

Unchanged. Its `SlotColumn` gets no `onClose`, so Close = `setCockpitWorktree(null)` as today.

## Store actions

- `slots: Slot[]`, `slotSeq: number` (session-only). `mintSlotKey()` bumps `slotSeq`.
- `init` builds slots via `initSlots(worktrees, mintKey)`; no more `slotCount` init or
  `preferences.panes` read.
- `addEmptySlot()`, `setSlot(key, id)`, `removeSlot(key)` — thin wrappers over the helpers.
- `placeNewEntity(id, view)`: Worktrees/Calm → `placeEntity`; Cockpit → `setCockpitWorktree(id)`
  **and** `placeEntity` into the shared slots only if there's room (fill-empty/append, never
  evict — matches the old `fillFreeSlot` "no eviction" intent).
- `clearEntity` / `swapSlotId` used by `removeWorktree`, `removeScratch`, and the deduce
  background chain — updated to the keyed helpers.
- Delete `setSlotCount` and the `preferences.panes` write.

## Testing

`slots.test.ts` rewritten for the keyed model with a deterministic `mintKey` (e.g. a counter
closure). Cases:

- `initSlots`: first 3 ongoing, skips completed, zero → `[]`.
- `addEmptySlot`: appends empty; no-op at cap 3.
- `setSlotId`: assign / clear-in-place by key.
- `removeSlot`: splices; surviving keys unchanged (reflow).
- `placeEntity`: fill-first-empty → append when room → replace-rightmost at cap.
- `clearEntity`: splices matching columns.
- `swapSlotId`: replaces id, **keeps key**; no-op when absent.

`npx vitest run`, `tsc`, and `vite build` all green. **No Rust changes**, so `cargo test`
is unaffected (still runs green).

## Out of scope (follow-up iterations)

1. **Reorder** — drag-to-swap tile positions. For now, reordering still goes through the
   dropdowns. Flagged for a follow-up.
2. **Calm decoupling** — a "sync" option so Calm can show a different tile set than Worktrees
   (today it mirrors the shared `slots`). Flagged for a follow-up.

## Non-goals / risks

- Terminal remounts on reflow — mitigated by stable per-column `key`s.
- Old persisted `preferences.panes` — harmlessly ignored (back-compat verified by the fact
  serde skips unknown/unread fields; no migration needed).
