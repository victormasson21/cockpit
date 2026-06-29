# Cockpit worktree column — design

> Status: design approved (brainstorming complete). A **smaller iteration**: add a
> worktree pane to the Cockpit view's right column, reusing the existing `SlotColumn`
> machinery, backed by a **persisted** single slot, plus a view-dependent placement
> rule for newly-created worktrees/scratch. Stack/conventions: `CLAUDE.md`; backlog:
> `docs/ROADMAP.md`.

## Goal

Give the Cockpit view the right-hand worktree column from the product mockup: a
`SlotColumn` (picker + chips/path/3 terminals, or a scratch shell) that is **empty
until assigned** and whose assignment **persists across sessions**. Wire up a
view-dependent placement rule so creating a worktree/scratch lands it in the right
place depending on which view you're on.

## Scope

**In scope**
- Make `SlotColumn`'s selection **prop-driven** (`value` + `onSelect`) so it backs
  both the Worktrees view (session slots) and the Cockpit view (persisted slot) from
  one component.
- A **persisted** `cockpitWorktreeId` field in `cockpit.json` (Rust + TS).
- Render `SlotColumn` as the Cockpit view's right column (3-column layout).
- A **view-dependent placement rule** for newly-created worktrees and scratch.
- Cleanup: deleting the assigned entity clears the persisted slot.

**Out of scope (deferred)**
- Persisting the **Worktrees view's** own slots (still session-only; separate ROADMAP item).
- A shared/global "active worktree" across views (rejected in brainstorming — selections are independent).
- Any change to `WorktreeBody`/`ScratchBody`/the PTY layer.

## Key decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| What can be assigned | Worktrees **and** scratch (same picker as the Worktrees view). |
| Selection link | **Independent** — Cockpit has its own persisted slot, separate from the Worktrees view. |
| Persistence | `cockpitWorktreeId` in `cockpit.json`; a worktree selection survives restart, a scratch selection resolves to empty (scratch are session-only). |
| Reuse | One `SlotColumn`, made selection-source-agnostic via props. |
| Empty state | The existing `SlotColumn` empty body ("Nothing in this slot.") + picker. |

## Placement rule (view-dependent) — the core behaviour

When a new worktree **or** scratch is created, placement depends on the **active view**:

- **Cockpit view active:**
  1. `cockpitWorktreeId = newId` (replaces whatever is in the right column).
  2. If a free Worktrees-view slot exists → fill it. Else → **leave the Worktrees view unchanged** (no eviction).
- **Worktrees view active (and Calm, which shares those columns):**
  1. Fill the first free Worktrees-view slot; if none free → **replace the last visible slot** (index `slotCount - 1`).
  2. **Cockpit slot untouched.**

This is the same rule for worktrees and scratch.

## Architecture

Pure frontend + one persisted config field. No Rust provider/commands beyond the
serde shape; no PTY changes.

### `SlotColumn` — selection made prop-driven

Today `SlotColumn(slotIndex)` reads `slots[slotIndex]` and calls `setSlot(slotIndex, …)`
from the store, and its Hide action calls `setSlot(slotIndex, null)`. Refactor it so
**selection flows through props**:

```ts
SlotColumn({
  value: string | null,            // the currently-assigned entity id (or null)
  onSelect: (id: string | null) => void,  // picker change + Hide
  variant?: "full" | "calm",
})
```

- **Worktrees view** (`WorktreesView.tsx`, `CalmView.tsx`) passes
  `value={slots[i]}` and `onSelect={(id) => setSlot(i, id)}` — behaviour unchanged.
- **Cockpit view** passes `value={cockpit.cockpitWorktreeId ?? null}` and
  `onSelect={setCockpitWorktree}`.
- Delete still calls `removeWorktree`/`removeScratch` (store) — those already clear
  session slots and will additionally clear `cockpitWorktreeId` (see Cleanup).
- The picker still lists worktrees + scratch from the store directly (that part is
  not selection-source-specific).

### Config

```ts
// src/settings/types.ts — CockpitConfig gains:
cockpitWorktreeId?: string;
```
```rust
// src-tauri/src/settings.rs — CockpitConfig gains:
#[serde(rename = "cockpitWorktreeId", default, skip_serializing_if = "Option::is_none")]
pub cockpit_worktree_id: Option<String>,
```
`#[serde(default)]` → existing `cockpit.json` files still load (back-compat).

### Store (`src/settings/store.ts`)

- `setCockpitWorktree(id: string | null)` — persists via the existing `setCockpit`
  functional-updater + debounced save (sets/clears `cockpitWorktreeId`).
- `placeNewEntity(id: string, view: "cockpit" | "worktrees" | "calm")` — applies the
  placement rule:
  - `view === "cockpit"`: `cockpitWorktreeId = id`; `slots = fillFreeSlot(slots, id, slotCount)`.
  - else: `slots = assignNewWorktree(slots, id, slotCount)` (evict last **visible**); cockpit untouched.
- `addScratch()` is split: it **creates** the scratch entity (and returns the id) but
  **no longer assigns a slot** — placement is `placeNewEntity`'s job, called by the
  caller with the active view.
- `removeWorktree`/`removeScratch`: in addition to `clearEntity(slots, id)`, clear
  `cockpitWorktreeId` when it equals the removed id.

### Pure slot helpers (`src/views/slots.ts`)

- New: `fillFreeSlot(slots, id, visibleCount)` — fill the first empty slot **within the
  visible range**; if none free, return `slots` **unchanged** (no eviction).
- Change: `assignNewWorktree(slots, id, visibleCount)` — fill first empty slot in the
  visible range, else replace the **last visible** slot (`visibleCount - 1`) instead of
  the hard-coded `slots.length - 1`. (Correctness fix for the 2-column toggle.)

### Layout (`CockpitView.tsx` / `.css`)

Cockpit view becomes three columns: left **TILES** (~280px, unchanged) · center
widgets (flex) · right **worktree column** (a `SlotColumn` with a solid min-width so the
terminals are usable, e.g. `flex: 0 0 ~420px` or a min-width on a flexible column).
`App.tsx` passes the active `view` into the create paths so `placeNewEntity` can branch.

## Data flow — create

1. User creates a worktree (NewWorktreeForm) or scratch (Terminal button); the entity
   is added to the store (`addWorktree` / `addScratch`).
2. The caller (`App.tsx`, which owns `view`) calls `placeNewEntity(newId, view)`.
3. `placeNewEntity` applies the view-dependent rule above (persisted save handled by
   the existing `setCockpit` path; session `slots` updated in the same set).
4. The Cockpit right `SlotColumn` reads `cockpitWorktreeId`; the Worktrees view reads
   `slots`. Both `WorktreeBody`s attach to the same per-id PTYs (shared, no conflict).

## Error handling / edge cases

- Persisted `cockpitWorktreeId` pointing at a deleted/missing worktree → `resolveSlotEntity`
  returns null → the column shows the empty body + picker (graceful).
- A persisted **scratch** id after restart → not found (session-only) → empty (expected).
- Cockpit-view create with all Worktrees slots full → Cockpit slot set; Worktrees view
  left unchanged (no eviction), per the rule.

## Testing

Pure-function + reducer tests (the logic lives in `slots.ts` + store reducers; Vitest
`node` env, no DOM):
- `slots.ts`: `fillFreeSlot` (fills first free in range; unchanged when full); updated
  `assignNewWorktree` (evicts last **visible** slot, respects `visibleCount`).
- store: `placeNewEntity` both branches — Cockpit (sets cockpit slot + fills free slot
  / leaves Worktrees unchanged when full) and Worktrees (fills/evicts, cockpit
  untouched); `removeWorktree`/`removeScratch` clear `cockpitWorktreeId` when it matches.
- Rust `settings.rs`: `cockpitWorktreeId` round-trip + back-compat (config without it loads).

`SlotColumn` (prop refactor), `CockpitView` layout, and the empty state are
build-verified + GUI-checked.

## Reuse / forward seam

`SlotColumn` becoming selection-source-agnostic is the reusable win: any future place
that needs a worktree pane (a second Cockpit slot, an expanded centre tile) passes its
own `value`/`onSelect`. The persisted-slot pattern is the seam the deferred "persist
Worktrees-view slots" ROADMAP item can later follow.
