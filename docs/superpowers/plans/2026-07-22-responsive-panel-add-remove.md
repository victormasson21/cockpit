# Responsive Panel Add/Remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Worktrees view's column layout responsive to the number of assigned tiles (1 centered / 2 / 3), with a 40px `+` rail to add a slot, replacing the manual 2/3 count toggle.

**Architecture:** Replace the fixed-length `slots: (string|null)[]` + `slotCount` with a variable-length, keyed `Slot[]` (`{ key, id }`) whose length IS the visible column count. Pure keyed reducers in `slots.ts`, thin store wrappers, responsive layout + `+` rail in `WorktreesView`, gear-on-empty + `onClose` in `SlotColumn`. Calm mirrors the shared slots (no rail/gear). No Rust changes.

**Tech Stack:** React 19 + TypeScript (Vite), Zustand store, Vitest. Frontend-only.

## Global Constraints

- **File-role comment** at top of every file; concise block comments on non-obvious logic (project convention).
- **Smallest change that works**; no unrelated refactors.
- **Cap:** `SLOT_COUNT = 3` columns max.
- **Session-only:** `slots` and `slotSeq` are never persisted. Stop reading/writing `preferences.panes` (leave the Rust field for back-compat).
- **Stable keys:** each column has a `key` so reflow never remounts surviving terminals.
- **No Rust changes.** Verify each task with `npx vitest run` (from repo root); final gate also `npx tsc --noEmit` + `npm run build`.

---

### Task 1: Keyed slot model + pure helpers (TDD)

**Files:**
- Modify: `src/views/slots.ts`
- Test: `src/views/slots.test.ts` (rewrite)

**Interfaces:**
- Consumes: `Worktree` from `../settings/types`.
- Produces:
  - `type Slot = { key: string; id: string | null }`
  - `type Slots = Slot[]`
  - `const SLOT_COUNT = 3`
  - `initSlots(worktrees: Worktree[], mintKey: () => string): Slots`
  - `addEmptySlot(slots: Slots, mintKey: () => string): Slots`
  - `setSlotId(slots: Slots, key: string, id: string | null): Slots`
  - `removeSlot(slots: Slots, key: string): Slots`
  - `placeEntity(slots: Slots, id: string, mintKey: () => string): Slots`
  - `fillEntity(slots: Slots, id: string, mintKey: () => string): Slots` (no-eviction variant for Cockpit-view create)
  - `clearEntity(slots: Slots, id: string): Slots` (splices matching columns)
  - `swapSlotId(slots: Slots, from: string, to: string): Slots` (keeps key)
  - Unchanged & re-exported: `resolveSlotEntity`, `ScratchTerminal`, `PendingWorktree`, `SlotEntity`.
  - **Removed:** `MIN_SLOTS`, `setSlotAt`, `assignNewWorktree`, `fillFreeSlot`, `hideSlotsBeyond`.

- [ ] **Step 1: Rewrite the test file** `src/views/slots.test.ts`:

```ts
// slots.test.ts — pure keyed-slot reducer behavior for the responsive Worktrees view.
import { describe, it, expect } from "vitest";
import {
  SLOT_COUNT, initSlots, addEmptySlot, setSlotId, removeSlot,
  placeEntity, fillEntity, clearEntity, swapSlotId, resolveSlotEntity,
  type Slots, type ScratchTerminal, type PendingWorktree,
} from "./slots";
import type { Worktree } from "../settings/types";

const wt = (id: string, status: Worktree["status"] = "ongoing"): Worktree => ({
  id, name: id, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status,
});

// Deterministic key minter for tests.
const minter = () => { let n = 0; return () => `k${++n}`; };
const ids = (s: Slots) => s.map((x) => x.id);

describe("slots", () => {
  it("initSlots takes the first 3 ongoing worktrees; zero → empty", () => {
    expect(ids(initSlots([wt("a"), wt("b")], minter()))).toEqual(["a", "b"]);
    expect(ids(initSlots([wt("a"), wt("b"), wt("c"), wt("d")], minter()))).toEqual(["a", "b", "c"]);
    expect(initSlots([], minter())).toEqual([]);
  });
  it("initSlots skips completed worktrees", () => {
    expect(ids(initSlots([wt("done", "completed"), wt("a")], minter()))).toEqual(["a"]);
  });
  it("initSlots mints a unique key per slot", () => {
    const s = initSlots([wt("a"), wt("b")], minter());
    expect(s.map((x) => x.key)).toEqual(["k1", "k2"]);
  });
  it("addEmptySlot appends an empty slot; no-op at the cap", () => {
    const mk = minter();
    const s1 = addEmptySlot([], mk);
    expect(s1).toEqual([{ key: "k1", id: null }]);
    const full: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(addEmptySlot(full, mk)).toBe(full); // referential no-op at cap 3
  });
  it("setSlotId assigns and clears one column by key", () => {
    const s: Slots = [{ key: "a", id: null }, { key: "b", id: "2" }];
    expect(setSlotId(s, "a", "9")).toEqual([{ key: "a", id: "9" }, { key: "b", id: "2" }]);
    expect(setSlotId(s, "b", null)).toEqual([{ key: "a", id: null }, { key: "b", id: null }]);
  });
  it("removeSlot splices a column, leaving other keys intact (reflow)", () => {
    const s: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(removeSlot(s, "b")).toEqual([{ key: "a", id: "1" }, { key: "c", id: "3" }]);
  });
  it("placeEntity fills the first empty slot", () => {
    const s: Slots = [{ key: "a", id: "1" }, { key: "b", id: null }];
    expect(placeEntity(s, "9", minter())).toEqual([{ key: "a", id: "1" }, { key: "b", id: "9" }]);
  });
  it("placeEntity appends a new column when there is room and no empty slot", () => {
    const mk = minter();
    expect(placeEntity([{ key: "a", id: "1" }], "9", mk)).toEqual([{ key: "a", id: "1" }, { key: "k1", id: "9" }]);
    expect(placeEntity([], "9", minter())).toEqual([{ key: "k1", id: "9" }]);
  });
  it("placeEntity replaces the rightmost column at the cap", () => {
    const s: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(placeEntity(s, "9", minter())).toEqual([{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "9" }]);
  });
  it("fillEntity fills an empty slot or appends when room, never evicts at the cap", () => {
    const cap: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(fillEntity(cap, "9", minter())).toBe(cap); // no eviction
    expect(fillEntity([{ key: "a", id: null }], "9", minter())).toEqual([{ key: "a", id: "9" }]);
    expect(fillEntity([{ key: "a", id: "1" }], "9", minter())).toEqual([{ key: "a", id: "1" }, { key: "k1", id: "9" }]);
  });
  it("clearEntity splices every column holding a removed id", () => {
    const s: Slots = [{ key: "a", id: "x" }, { key: "b", id: "y" }, { key: "c", id: "x" }];
    expect(clearEntity(s, "x")).toEqual([{ key: "b", id: "y" }]);
    expect(clearEntity([{ key: "a", id: "scratch-1" }], "scratch-1")).toEqual([]);
  });
  it("swapSlotId replaces the id in place and keeps the key; no-op when absent", () => {
    const s: Slots = [{ key: "a", id: "pending-1" }, { key: "b", id: "z" }];
    expect(swapSlotId(s, "pending-1", "wt-9")).toEqual([{ key: "a", id: "wt-9" }, { key: "b", id: "z" }]);
    expect(swapSlotId(s, "nope", "wt-9")).toEqual(s);
  });
  it("resolveSlotEntity finds worktree, then scratch, then pending, else null", () => {
    const scratch: ScratchTerminal[] = [{ id: "scratch-1", title: "Scratch 1" }];
    const pending: PendingWorktree[] = [{ id: "pending-1", prompt: "p", status: "deducing", view: "worktrees" }];
    expect(resolveSlotEntity(null, [wt("a")], scratch)).toBeNull();
    expect(resolveSlotEntity("a", [wt("a")], scratch)).toEqual({ kind: "worktree", worktree: wt("a") });
    expect(resolveSlotEntity("scratch-1", [wt("a")], scratch)).toEqual({ kind: "scratch", scratch: scratch[0] });
    expect(resolveSlotEntity("pending-1", [wt("a")], [], pending)).toEqual({ kind: "pending", pending: pending[0] });
    expect(resolveSlotEntity("ghost", [wt("a")], scratch)).toBeNull();
  });
  it("SLOT_COUNT is 3", () => { expect(SLOT_COUNT).toBe(3); });
});
```

- [ ] **Step 2: Run the tests — expect FAIL** (helpers not yet in new shape)

Run: `npx vitest run src/views/slots.test.ts`
Expected: FAIL (import/type errors, missing `addEmptySlot`/`removeSlot`/`placeEntity`/`fillEntity`/`setSlotId`).

- [ ] **Step 3: Rewrite `src/views/slots.ts`** — replace the whole file body below the `Worktree` import. Keep `resolveSlotEntity` and the entity types unchanged. New model + helpers:

```ts
// slots.ts — pure helpers for the Worktrees view's responsive column slots (session-only; not persisted).
// A slot = { key, id }: `key` is a stable per-column identity so reflow never remounts surviving
// terminals; `id` is the entity shown (null = a shown-but-empty slot the user is about to fill).
import type { Worktree } from "../settings/types";

export const SLOT_COUNT = 3; // max columns; layout is 1 (centered) / 2 / 3 by slots.length
export type Slot = { key: string; id: string | null };
export type Slots = Slot[];

// initSlots: on load, one column per ongoing worktree (capped); zero ongoing → no columns.
export function initSlots(worktrees: Worktree[], mintKey: () => string): Slots {
  return worktrees
    .filter((w) => w.status === "ongoing")
    .slice(0, SLOT_COUNT)
    .map((w) => ({ key: mintKey(), id: w.id }));
}

// addEmptySlot: the `+` rail — append one empty column, unless already at the cap (referential no-op).
export function addEmptySlot(slots: Slots, mintKey: () => string): Slots {
  if (slots.length >= SLOT_COUNT) return slots;
  return [...slots, { key: mintKey(), id: null }];
}

// setSlotId: set one column's content by key (id assigns; null empties it in place, keeping the column).
export function setSlotId(slots: Slots, key: string, id: string | null): Slots {
  return slots.map((s) => (s.key === key ? { ...s, id } : s));
}

// removeSlot: splice a column out entirely — the layout reflows down.
export function removeSlot(slots: Slots, key: string): Slots {
  return slots.filter((s) => s.key !== key);
}

// placeEntity: show a newly-created entity — fill the first empty slot, else append if there's room,
// else replace the rightmost column (the bumped entity keeps running, re-assignable via the dropdown).
export function placeEntity(slots: Slots, id: string, mintKey: () => string): Slots {
  const empty = slots.findIndex((s) => s.id === null);
  if (empty !== -1) return slots.map((s, i) => (i === empty ? { ...s, id } : s));
  if (slots.length < SLOT_COUNT) return [...slots, { key: mintKey(), id }];
  return slots.map((s, i) => (i === slots.length - 1 ? { ...s, id } : s));
}

// fillEntity: like placeEntity but NEVER evicts — fill an empty slot or append when there's room, else
// leave slots untouched. Used by Cockpit-view create (the Cockpit column is its own separate slot).
export function fillEntity(slots: Slots, id: string, mintKey: () => string): Slots {
  const empty = slots.findIndex((s) => s.id === null);
  if (empty !== -1) return slots.map((s, i) => (i === empty ? { ...s, id } : s));
  if (slots.length < SLOT_COUNT) return [...slots, { key: mintKey(), id }];
  return slots;
}

// clearEntity: an entity was deleted — splice out every column referencing it (layout reflows).
export function clearEntity(slots: Slots, id: string): Slots {
  return slots.filter((s) => s.id !== id);
}

// swapSlotId: replace one id with another in place, keeping the key (pending → real worktree stays put).
export function swapSlotId(slots: Slots, from: string, to: string): Slots {
  return slots.map((s) => (s.id === from ? { ...s, id: to } : s));
}
```

Leave everything from `// A scratch terminal:` onward (`ScratchTerminal`, `PendingWorktree`, `SlotEntity`, `resolveSlotEntity`) **unchanged**.

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npx vitest run src/views/slots.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/views/slots.ts src/views/slots.test.ts
git commit -m "feat: keyed variable-length slot model + reducers"
```

---

### Task 2: Store — keyed slots, key-based actions, drop slotCount

**Files:**
- Modify: `src/settings/store.ts`
- Modify: `src/App.tsx` (only the imports/usages that break from removing `slotCount`; the toggle UI is Task 4 — but the app must compile, so update the destructure now)

**Interfaces:**
- Consumes: helpers from Task 1.
- Produces (store state/actions):
  - `slots: Slots`, `slotSeq: number`
  - `addEmptySlot(): void`
  - `setSlot(key: string, id: string | null): void`
  - `removeSlot(key: string): void`
  - `placeNewEntity(id: string, view: View): void` (updated body)
  - **Removed:** `slotCount`, `setSlotCount`.

- [ ] **Step 1: Update the imports** at `src/settings/store.ts:7` (alias helpers that clash with action names):

```ts
import { initSlots, addEmptySlot as addEmptySlotFn, setSlotId, removeSlot as removeSlotFn, placeEntity, fillEntity, clearEntity, swapSlotId, SLOT_COUNT, type Slots, type ScratchTerminal, type PendingWorktree } from "../views/slots";
```

- [ ] **Step 2: Update the state type** (`src/settings/store.ts:49-54`) — replace those lines with:

```ts
  slots: Slots;
  slotSeq: number; // monotonic; mints stable per-column keys (session-only)
  addEmptySlot: () => void;
  setSlot: (key: string, id: string | null) => void;
  removeSlot: (key: string) => void;
  setCockpitWorktree: (id: string | null) => void;
  placeNewEntity: (id: string, view: View) => void;
```

- [ ] **Step 3: Update the initial state** — `src/settings/store.ts:118-119` become:

```ts
  slots: [],
  slotSeq: 0,
```

Remove the `panes: SLOT_COUNT` from the default cockpit preferences at line 115 (change `preferences: { theme: "system", defaultView: "worktrees", panes: SLOT_COUNT }` → `preferences: { theme: "system", defaultView: "worktrees" }`). *(If TS complains that `panes` is required, leave it optional in the type — see Step 8.)*

- [ ] **Step 4: Add a `withMint` store helper** near `scheduleSave` (~line 112) and use it everywhere keys are minted. This keeps `slotSeq` bookkeeping in one place:

```ts
// withMint: run `fn` with a key-minter, returning the produced slots plus the advanced slotSeq. Every
// minter call bumps a local counter; the caller returns { slots, slotSeq } from its set() so the store
// stays consistent. Keys are `slot-<n>` and monotonic (session-only; stable across reflow).
function withMint(st: { slotSeq: number }, fn: (mint: () => string) => Slots): { slots: Slots; slotSeq: number } {
  let seq = st.slotSeq;
  const mint = () => { seq += 1; return `slot-${seq}`; };
  return { slots: fn(mint), slotSeq: seq };
}
```

Then rewrite `init` (line 132):

```ts
  init: (s) => set((st) => {
    const { slots, slotSeq } = withMint(st, (m) => initSlots(s.cockpit.worktrees, m));
    return { cockpit: s.cockpit, layout: s.layout, loaded: true, slots, slotSeq, fontScale: clampZoom(s.cockpit.preferences.fontScale ?? 1) };
  }),
```

> **Import aliases:** the store actions `addEmptySlot`/`removeSlot`/`setSlot` clash with the pure helper names. Alias the helper imports: `import { ..., addEmptySlot as addEmptySlotFn, removeSlot as removeSlotFn, setSlotId, ... }`. `setSlot` (action) wraps `setSlotId` (no clash).

- [ ] **Step 5: Replace slot actions** — the old `setSlot` (line 174) and `setSlotCount` (lines 177-180). Replace both with:

```ts
  // Slots are session-only display state: which entity shows in each responsive column, keyed by slot.key.
  setSlot: (key, id) => set((st) => ({ slots: setSlotId(st.slots, key, id) })),
  // The `+` rail: append one empty column (no-op at the 3-column cap). withMint advances slotSeq.
  addEmptySlot: () => set((st) => withMint(st, (m) => addEmptySlotFn(st.slots, m))),
  // Close/Pause/teardown remove a column entirely; the layout reflows. No mint → slotSeq unchanged.
  removeSlot: (key) => set((st) => ({ slots: removeSlotFn(st.slots, key) })),
```

- [ ] **Step 6: Rewrite `placeNewEntity`** (lines 194-201). Cockpit's column is persisted (route through `setCockpitWorktree`); the shared slots use `withMint`:

```ts
  // View-dependent placement of a newly-created worktree/scratch/pending. Worktrees/Calm reflow the
  // shared slots (placeEntity); Cockpit sets its own persisted column and only fills a free shared slot
  // (fillEntity — no eviction).
  placeNewEntity: (id: string, view: View) => {
    if (view === "cockpit") get().setCockpitWorktree(id);
    set((st) => withMint(st, (m) => (view === "cockpit" ? fillEntity(st.slots, id, m) : placeEntity(st.slots, id, m))));
  },
```

- [ ] **Step 7: Update the entity-removal reducers** to the keyed `clearEntity`/`swapSlotId` (they already call these by name — only the array shape changed, so no code change is needed if signatures match). Verify these three sites still compile:
  - `removeWorktree` (line ~151): `set((st) => ({ slots: clearEntity(st.slots, id) }));` — unchanged, works on `Slot[]`.
  - `removeScratch` (line ~212): `slots: clearEntity(st.slots, id)` — unchanged.
  - `startDeduceWorktree` success (line ~260): `slots: swapSlotId(st.slots, pendingId, realId)` — unchanged.
  - `startDeduceWorktree` catch (line ~269): `slots: clearEntity(st.slots, pendingId)` — unchanged.

No edits expected here; just confirm.

- [ ] **Step 8: Make `panes` optional** in the preferences type. Open `src/settings/types.ts`, find the `preferences` type, and if `panes` is required (`panes: number`), change it to `panes?: number` (keep it so old configs still parse; we no longer write it). If it is already optional, no change.

- [ ] **Step 9: Fix `App.tsx`** so the app compiles. Removing `slotCount`/`setSlotCount` from the store breaks the header toggle JSX, so **do Task 4's App edits now, in the same working state** (they are split only for review clarity). Specifically: at `src/App.tsx:31` change the destructure to `const { loaded, init } = useSettings();`, delete the panes-toggle JSX block, and remove the `MIN_SLOTS, SLOT_COUNT` import (line 13). Details in Task 4, Steps 5–6.

- [ ] **Step 10: Run the full JS test suite**

Run: `npx vitest run`
Expected: PASS (store isn't directly unit-tested; this confirms nothing else broke).

- [ ] **Step 11: Commit** (together with Task 4's App edits — see sequencing note).

```bash
git add src/settings/store.ts src/settings/types.ts src/App.tsx
git commit -m "feat: store uses keyed slots; drop slotCount + panes pref"
```

---

### Task 3: `SlotColumn` — key-aware close + gear on empty

**Files:**
- Modify: `src/views/worktree-column/SlotColumn.tsx`

**Interfaces:**
- Consumes: store `setSlot`/`removeSlot` are called by the *host* (Task 4), not here. `SlotColumn` gains one prop.
- Produces: `SlotColumn` prop `onClose?: () => void`.

- [ ] **Step 1: Add the `onClose` prop** to the signature:

```tsx
export function SlotColumn({ value, onSelect, variant = "full", onPin, onClose }: { value: string | null; onSelect: (id: string | null) => void; variant?: "full" | "calm"; onPin?: (id: string) => void; onClose?: () => void }) {
```

- [ ] **Step 2: Add a `close` helper** near the top of the component body (after the `useState` lines):

```tsx
  // Close removes the whole column when the host provides onClose (Worktrees/Calm reflow); otherwise
  // it just unassigns (Cockpit's single persistent column). Menu-driven actions funnel through here.
  const close = () => { setMenuOpen(false); (onClose ?? (() => onSelect(null)))(); };
```

- [ ] **Step 3: Route `pauseActive` and teardown `onDone` through close.** In `pauseActive`, replace the final `onSelect(null);` with `close();` (and drop the now-redundant `setMenuOpen(false)` at its top since `close` does it — leave the early `setMenuOpen(false)` if it reads clearer; harmless). In the `TeardownConfirm` `onDone`, replace `onDone={() => { setConfirm(null); onSelect(null); }}` with `onDone={() => { setConfirm(null); close(); }}`.

- [ ] **Step 4: Show the gear on empty slots (Close only).** The menu currently renders only when `entity && entity.kind !== "pending"`. Change the header block so:
  - The gear button renders when `variant !== "calm"` AND `entity?.kind !== "pending"` (i.e. also when `entity` is null/empty).
  - Inside the popup, when there is **no entity** (empty slot) render only the Close row; otherwise render the existing full menu.

Replace the menu `<div className="wt-col__menu">…</div>` block with:

```tsx
        {variant !== "calm" && entity?.kind !== "pending" && (
          <div className="wt-col__menu">
            <button className="icon-btn wt-col__gear" aria-label="column settings" onClick={() => setMenuOpen((o) => !o)}><GearIcon /></button>
            {menuOpen && (
              <div className="wt-col__menu-pop" onMouseLeave={() => setMenuOpen(false)}>
                {/* Empty slot: only Close (removes the column). */}
                {!entity && <button onClick={close}><CloseIcon />Close</button>}
                {entity?.kind === "worktree" && onPin && (
                  <button onClick={() => { onPin(entity.worktree.id); setMenuOpen(false); }}><PinIcon />Cockpit</button>
                )}
                {entity && <button onClick={close}><CloseIcon />Close</button>}
                {entity?.kind === "worktree" ? (
                  <>
                    <button onClick={pauseActive}><PauseIcon />Pause</button>
                    <button className="wt-col__danger" onClick={() => { setConfirm("delete"); setMenuOpen(false); }}><BinIcon />Delete</button>
                    <button className="wt-col__danger" onClick={() => { setConfirm("wipe"); setMenuOpen(false); }}><GhostIcon />Wipe</button>
                  </>
                ) : entity?.kind === "scratch" ? (
                  <button className="wt-col__danger" onClick={deleteScratch}><BinIcon />Delete</button>
                ) : null}
              </div>
            )}
          </div>
        )}
```

*(The `!entity && Close` and `entity && Close` are mutually exclusive, so exactly one Close renders. The empty-slot header keeps its `Select…` dropdown from the existing `switcher`.)*

- [ ] **Step 5: Confirm the empty header still renders the switcher.** The existing header already renders `{switcher}` unconditionally for `!calmWorktree`. Empty slots (`entity === null`) hit the `!entity` body branch ("Nothing in this slot.") — verify that branch is untouched.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/worktree-column/SlotColumn.tsx
git commit -m "feat: SlotColumn onClose (remove column) + gear-on-empty (Close only)"
```

---

### Task 4: Responsive layout + `+` rail; remove the 2/3 toggle

**Files:**
- Modify: `src/views/WorktreesView.tsx`
- Modify: `src/views/WorktreesView.css`
- Modify: `src/views/CalmView.tsx`
- Modify: `src/App.tsx` (remove the panes toggle — commit with Task 2 per its sequencing note)
- Modify: `src/App.css` (remove `.app__panes` / `.app__pane*`)

**Interfaces:**
- Consumes: store `slots`, `setSlot`, `removeSlot`, `addEmptySlot`.

- [ ] **Step 1: Rewrite `WorktreesView.tsx`:**

```tsx
// WorktreesView.tsx — responsive Worktrees view: 1 (centered) / 2 / 3 columns by slots.length, plus a
// slim `+` rail (hidden at the 3-column cap) that appends an empty slot to fill.
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import { SLOT_COUNT } from "./slots";
import { PlusIcon } from "./icons";
import "./WorktreesView.css";

export function WorktreesView({ onPin }: { onPin: (id: string) => void }) {
  const slots = useSettings((s) => s.slots);
  const setSlot = useSettings((s) => s.setSlot);
  const removeSlot = useSettings((s) => s.removeSlot);
  const addEmptySlot = useSettings((s) => s.addEmptySlot);
  return (
    <div className={`wt-view${slots.length === 1 ? " wt-view--single" : ""}`}>
      {slots.map((slot) => (
        <SlotColumn
          key={slot.key}
          value={slot.id}
          onSelect={(id) => setSlot(slot.key, id)}
          onClose={() => removeSlot(slot.key)}
          onPin={onPin}
        />
      ))}
      {slots.length < SLOT_COUNT && (
        <button className="wt-view__add" aria-label="Add a panel" onClick={addEmptySlot}>
          <PlusIcon />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check `PlusIcon` exists** in `src/views/icons.tsx`.

Run: `grep -n "PlusIcon" src/views/icons.tsx`
Expected: a match (the lazy-panes "+ Add" uses it). If **no** match, add this export to `icons.tsx`:

```tsx
export const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
```

- [ ] **Step 3: Update `WorktreesView.css`:**

```css
/* WorktreesView.css — equal columns split by dividers; 1 column is centered; a slim `+` rail on the right. */
.wt-view { display: flex; height: 100%; }
/* Single assigned column: center it with a comfortable max width instead of full-bleed. */
.wt-view--single { justify-content: center; }
.wt-view--single > .wt-col { flex: 0 1 720px; }

/* `+` rail: a 40px full-height column that appends an empty slot. */
.wt-view__add {
  flex: 0 0 40px; height: 100%; display: flex; align-items: center; justify-content: center;
  background: none; border: none; border-left: 1px solid var(--divider);
  color: var(--tx-3); cursor: pointer; transition: color 200ms ease-out, background-color 200ms ease-out;
}
.wt-view__add:hover { color: var(--tx); background: var(--hover); }
.wt-view__add svg { width: 22px; height: 22px; }
```

*(The single-column `flex: 0 1 720px` gives a centered, bounded column; `.wt-col` is otherwise `flex: 1` from its own CSS. Verify `.wt-col` uses `flex: 1` — if it sets an explicit width, adjust the single rule to override it.)*

- [ ] **Step 4: Update `CalmView.tsx`** — same responsive mapping, **no rail, no onClose/onPin** (decluttered mirror):

```tsx
// CalmView.tsx — decluttered mirror of the Worktrees slots: each column shows only its worktree's
// Claude pane (variant="calm"). Reads the same shared slots; no `+` rail, no gear (managed from Worktrees).
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function CalmView() {
  const slots = useSettings((s) => s.slots);
  const setSlot = useSettings((s) => s.setSlot);
  return (
    <div className={`wt-view${slots.length === 1 ? " wt-view--single" : ""}`}>
      {slots.map((slot) => (
        <SlotColumn key={slot.key} value={slot.id} onSelect={(id) => setSlot(slot.key, id)} variant="calm" />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Remove the panes toggle from `App.tsx`.** Delete the whole `{view !== "cockpit" && ( <div className="app__panes"> … </div> )}` block (lines ~127-141). Remove the `MIN_SLOTS, SLOT_COUNT` import (line 13) — confirm nothing else in App uses them (`grep -n "SLOT_COUNT\|MIN_SLOTS" src/App.tsx` → no matches after removal).

- [ ] **Step 6: Remove the toggle CSS** from `src/App.css` — delete the `.app__panes`, `.app__pane`, `.app__pane:hover`, `.app__pane--active` rules (and the `/* Panes toggle … */` comment).

- [ ] **Step 7: Typecheck + build + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no TS errors; all tests PASS.

- [ ] **Step 8: Commit** (this is the same commit as Task 2's App edits if not already committed; otherwise a follow-up commit):

```bash
git add src/views/WorktreesView.tsx src/views/WorktreesView.css src/views/CalmView.tsx src/views/icons.tsx src/App.tsx src/App.css
git commit -m "feat: responsive 1/2/3 column layout + `+` rail; remove 2/3 toggle"
```

---

### Task 5: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: JS tests**

Run: `npx vitest run`
Expected: all PASS (slots suite rewritten; everything else unchanged).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: Vite build succeeds, no type errors.

- [ ] **Step 4: Rust unchanged (sanity)**

Run: `grep -rn "panes" src-tauri/src/ | head`
Expected: the `panes` field is still present in the Rust preferences struct (we intentionally left it for back-compat). No Rust edits were made.

- [ ] **Step 5: Manual-review checklist** (for the human GUI smoke, documented — cannot run headlessly):
  - 0 worktrees → empty view + `+` rail only.
  - Click `+` → one centered empty column with `Select… ⌄` + gear (Close only).
  - Assign via dropdown → column fills; `+` still shows (now 1 col).
  - `+` again → 2 columns; again → 3 columns; `+` rail disappears at 3.
  - Gear → Close on a middle column → reflows to fewer columns, other terminals **do not** flicker/restart.
  - Create a worktree at 3 columns → rightmost replaced.
  - Calm view mirrors the same columns, no `+`/gear.

---

## Notes on execution

- **Task 2 and Task 4's App.tsx edits are interdependent** (removing `slotCount` from the store breaks the toggle JSX). Land them in the same working tree state / commit. The split is for review clarity only.
- Keep each commit green (`npx vitest run` at minimum).
- No Rust changes anywhere.
