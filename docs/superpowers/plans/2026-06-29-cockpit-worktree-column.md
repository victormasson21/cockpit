# Cockpit worktree column — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted worktree pane to the Cockpit view's right column by reusing `SlotColumn` (made selection-source-agnostic), backed by a new `cockpitWorktreeId` config field, with a view-dependent placement rule for newly-created worktrees/scratch.

**Architecture:** Pure frontend + one persisted config field. `SlotColumn`'s selection becomes prop-driven (`value` + `onSelect`) so it backs both the Worktrees view (session slots) and the Cockpit view (persisted `cockpitWorktreeId`). New pure slot helper `fillFreeSlot` (no-eviction) and a `visibleCount`-aware `assignNewWorktree` (evict last *visible*) implement the placement rule, applied by a view-aware store action `placeNewEntity`.

**Tech Stack:** React 19 + TypeScript, Zustand store, Rust serde (Tauri config), Vitest (pure + store reducer tests), `cargo test`.

## Global Constraints

- **No new dependencies, no Rust provider/commands/threads, no PTY changes.**
- **Reuse, don't duplicate:** one `SlotColumn` serves both views via `value`/`onSelect` props. The Worktrees/Calm views' behaviour must be unchanged after the refactor.
- **Persisted, secrets-free config:** `cockpitWorktreeId` is `#[serde(default)]` on the Rust `CockpitConfig`; existing `cockpit.json` files must still load (keep existing back-compat tests green).
- **Placement rule (view-dependent), applied identically to worktrees AND scratch:**
  - **Cockpit view active:** set `cockpitWorktreeId = newId` (replace); then fill a free Worktrees-view slot **if one exists**, else leave the Worktrees view unchanged (NO eviction).
  - **Worktrees/Calm view active:** fill the first free Worktrees-view slot; if none free, replace the **last visible** slot (index `slotCount - 1`); Cockpit slot untouched.
- **Cleanup:** removing a worktree/scratch that equals `cockpitWorktreeId` clears it (alongside the existing session-slot clear).
- **`assignNewWorktree` stays backward-compatible:** add an optional `visibleCount` arg defaulting to `slots.length` so existing 2-arg callers/tests are unaffected.
- **Frontend tests are pure-function / store-reducer only** (Vitest `node` env, no DOM). `SlotColumn`/`CockpitView` rendering is build-verified + GUI-checked.
- **Theme tokens only**; file-top role comments; concise block comments on non-obvious wiring.

**Test commands:**
- JS (one file): `npx vitest run <path>` · all: `npm test`
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml <name>`
- Builds: `npm run build` · `cargo build --manifest-path src-tauri/Cargo.toml`

---

## File Structure

**Modify:**
- `src/views/slots.ts` (+ `slots.test.ts`) — add `fillFreeSlot`; `visibleCount` arg on `assignNewWorktree`.
- `src-tauri/src/settings.rs` — `cockpitWorktreeId` field (+ tests).
- `src/settings/types.ts` — `CockpitConfig.cockpitWorktreeId?`.
- `src/settings/store.ts` (+ `store.test.ts`) — `setCockpitWorktree`, `placeNewEntity`, split `addScratch`, remove `assignNewWorktreeSlot`, cleanup in `removeWorktree`/`removeScratch`.
- `src/views/worktree-column/SlotColumn.tsx` — selection via `value`/`onSelect` props.
- `src/views/WorktreesView.tsx`, `src/views/CalmView.tsx` — pass `value`/`onSelect`.
- `src/views/CockpitView.tsx` (+ `CockpitView.css`) — right-column `SlotColumn` + 3-col layout.
- `src/App.tsx`, `src/views/NewWorktreeModal.tsx` — thread the active `view` into placement.

---

## Task 1: Slot helpers — `fillFreeSlot` + `visibleCount`-aware `assignNewWorktree`

**Files:**
- Modify: `src/views/slots.ts`
- Test: `src/views/slots.test.ts`

**Interfaces:**
- Produces: `fillFreeSlot(slots: Slots, id: string, visibleCount: number): Slots` (fills first empty slot in `0..visibleCount`; if none, returns slots unchanged). `assignNewWorktree(slots: Slots, id: string, visibleCount?: number): Slots` (fills first empty in range, else replaces index `visibleCount-1`; `visibleCount` defaults to `slots.length`).

- [ ] **Step 1: Write the failing tests**

In `src/views/slots.test.ts`, add inside `describe("slots", …)`:
```ts
  it("assignNewWorktree evicts the last VISIBLE slot when full", () => {
    // visibleCount 2 → only slots 0,1 are visible; full visible range evicts index 1
    expect(assignNewWorktree(["a", "b", null], "d", 2)).toEqual(["a", "d", null]);
    // visibleCount 3 (default) keeps the old behavior
    expect(assignNewWorktree(["a", "b", "c"], "d", 3)).toEqual(["a", "b", "d"]);
    expect(assignNewWorktree(["a", "b", "c"], "d")).toEqual(["a", "b", "d"]);
  });
  it("fillFreeSlot fills the first empty slot in range, else leaves slots unchanged", () => {
    expect(fillFreeSlot(["a", null, null], "b", 3)).toEqual(["a", "b", null]);
    expect(fillFreeSlot(["a", "b", "c"], "d", 3)).toEqual(["a", "b", "c"]); // full → unchanged
    expect(fillFreeSlot(["a", "b", null], "d", 2)).toEqual(["a", "b", null]); // slot 2 not visible → unchanged
  });
```
Add `fillFreeSlot` to the import on line 3.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/views/slots.test.ts`
Expected: FAIL — `fillFreeSlot` is not exported; the `visibleCount`-eviction assertion fails.

- [ ] **Step 3: Implement in `slots.ts`**

Replace the existing `assignNewWorktree` (lines 19-24) with:
```ts
// assignNewWorktree: show a newly-created worktree — fill the first empty slot within the visible
// range, or displace the LAST VISIBLE slot when the visible range is full (the bumped worktree keeps
// running and stays in the dropdowns). visibleCount defaults to the whole array for legacy callers.
export function assignNewWorktree(slots: Slots, id: string, visibleCount: number = slots.length): Slots {
  const empty = slots.slice(0, visibleCount).indexOf(null);
  return setSlotAt(slots, empty === -1 ? visibleCount - 1 : empty, id);
}

// fillFreeSlot: place a worktree only if the visible range has a free slot; otherwise leave slots
// untouched (NO eviction). Used by the Cockpit-view placement branch.
export function fillFreeSlot(slots: Slots, id: string, visibleCount: number): Slots {
  const empty = slots.slice(0, visibleCount).indexOf(null);
  return empty === -1 ? slots : setSlotAt(slots, empty, id);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/views/slots.test.ts`
Expected: all slots tests pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/views/slots.ts src/views/slots.test.ts
git commit -m "feat(slots): fillFreeSlot + visibleCount-aware assignNewWorktree"
```

---

## Task 2: Config — `cockpitWorktreeId` field (Rust + TS)

**Files:**
- Modify: `src-tauri/src/settings.rs`, `src/settings/types.ts`
- Test: inline `#[cfg(test)]` in `settings.rs`

**Interfaces:**
- Produces (Rust): `CockpitConfig.cockpit_worktree_id: Option<String>` (`#[serde(rename = "cockpitWorktreeId", default, skip_serializing_if = "Option::is_none")]`).
- Produces (TS): `CockpitConfig.cockpitWorktreeId?: string`.

- [ ] **Step 1: Write the failing Rust tests**

In `src-tauri/src/settings.rs` `#[cfg(test)] mod tests`, add:
```rust
#[test]
fn cockpit_without_cockpit_worktree_id_still_loads() {
    let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.cockpit_worktree_id, None);
}

#[test]
fn cockpit_worktree_id_round_trips() {
    let json = r#"{"version":1,"tiles":[],"worktrees":[],"cockpitWorktreeId":"wt-3","preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.cockpit_worktree_id.as_deref(), Some("wt-3"));
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: FAIL — `CockpitConfig` has no field `cockpit_worktree_id`.

- [ ] **Step 3: Add the field**

In `src-tauri/src/settings.rs` `CockpitConfig`, after the `todos` field:
```rust
    // The Cockpit view's single right-column worktree slot (persisted; the Worktrees-view slots are session-only).
    #[serde(rename = "cockpitWorktreeId", default, skip_serializing_if = "Option::is_none")]
    pub cockpit_worktree_id: Option<String>,
```
In `impl Default for CockpitConfig`, add `cockpit_worktree_id: None,`.

- [ ] **Step 4: Mirror in TypeScript**

In `src/settings/types.ts` `CockpitConfig`, add: `cockpitWorktreeId?: string;`

- [ ] **Step 5: Run — expect PASS + TS build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: all settings tests pass (incl. existing back-compat).
Run: `npm run build`
Expected: type-checks clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/settings.rs src/settings/types.ts
git commit -m "feat(cockpit): persist cockpitWorktreeId in cockpit.json"
```

---

## Task 3: Store — persisted slot, view-dependent placement, cleanup, addScratch split

**Files:**
- Modify: `src/settings/store.ts`
- Test: `src/settings/store.test.ts`

**Interfaces:**
- Consumes: `fillFreeSlot` (Task 1), `cockpitWorktreeId` config (Task 2).
- Produces (store actions): `setCockpitWorktree(id: string | null): void`; `placeNewEntity(id: string, view: "cockpit" | "worktrees" | "calm"): void`. `addScratch()` now only creates the entity (no slot assignment). `assignNewWorktreeSlot` is removed. `removeWorktree`/`removeScratch` also clear `cockpitWorktreeId` when it matches.

- [ ] **Step 1: Update the store tests (RED)**

In `src/settings/store.test.ts`:

Replace the `assignNewWorktreeSlot fills the first empty slot` test (lines 93-97) with:
```ts
  it("placeNewEntity on worktrees view fills the first empty slot; cockpit untouched", () => {
    useSettings.setState({ slots: ["wt-1", null, null], slotCount: 3 });
    useSettings.getState().placeNewEntity("wt-2", "worktrees");
    expect(useSettings.getState().slots).toEqual(["wt-1", "wt-2", null]);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("placeNewEntity on worktrees view evicts the last visible slot when full", () => {
    useSettings.setState({ slots: ["a", "b", "c"], slotCount: 3 });
    useSettings.getState().placeNewEntity("d", "worktrees");
    expect(useSettings.getState().slots).toEqual(["a", "b", "d"]);
  });

  it("placeNewEntity on cockpit view sets the cockpit slot and fills a free Worktrees slot", () => {
    useSettings.setState({ slots: ["wt-1", null, null], slotCount: 3, cockpit: structuredClone(baseCockpit) });
    useSettings.getState().placeNewEntity("wt-9", "cockpit");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-9");
    expect(useSettings.getState().slots).toEqual(["wt-1", "wt-9", null]);
  });

  it("placeNewEntity on cockpit view leaves the Worktrees view unchanged when full (no eviction)", () => {
    useSettings.setState({ slots: ["a", "b", "c"], slotCount: 3, cockpit: structuredClone(baseCockpit) });
    useSettings.getState().placeNewEntity("wt-9", "cockpit");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-9");
    expect(useSettings.getState().slots).toEqual(["a", "b", "c"]);
  });

  it("setCockpitWorktree sets and clears the persisted slot", () => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit) });
    useSettings.getState().setCockpitWorktree("wt-5");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-5");
    useSettings.getState().setCockpitWorktree(null);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });
```

Replace the `addScratch creates a scratch entity and auto-displays it in a slot` test (lines 106-112) with:
```ts
  it("addScratch creates a scratch entity without assigning a slot", () => {
    const id = useSettings.getState().addScratch();
    const st = useSettings.getState();
    expect(id).toBe("scratch-1");
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.slots).toEqual([null, null, null]); // placement is placeNewEntity's job now
  });
```

Replace the `removeScratch drops the entity and clears its slot` test (lines 114-120) with:
```ts
  it("removeScratch drops the entity and clears its slot", () => {
    const id = useSettings.getState().addScratch();
    useSettings.getState().setSlot(0, id);
    useSettings.getState().removeScratch(id);
    const st = useSettings.getState();
    expect(st.scratchTerminals).toEqual([]);
    expect(st.slots).toEqual([null, null, null]);
  });
```

Add a cleanup test inside the same `describe`:
```ts
  it("removeWorktree clears it from the cockpit slot too", () => {
    useSettings.setState({ cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt], cockpitWorktreeId: "wt-1" }, slots: ["wt-1", null, null] });
    useSettings.getState().removeWorktree("wt-1");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/settings/store.test.ts`
Expected: FAIL — `placeNewEntity`/`setCockpitWorktree` undefined; `addScratch` still assigns a slot; `assignNewWorktreeSlot` gone.

- [ ] **Step 3: Implement the store changes**

In `src/settings/store.ts`:

Update the import on line 6 to include `fillFreeSlot`:
```ts
import { initSlots, setSlotAt, assignNewWorktree, fillFreeSlot, clearEntity, hideSlotsBeyond, SLOT_COUNT, type Slots, type ScratchTerminal } from "../views/slots";
```

In the `SettingsState` interface: remove `assignNewWorktreeSlot: (id: string) => void;` and add:
```ts
  setCockpitWorktree: (id: string | null) => void;
  placeNewEntity: (id: string, view: "cockpit" | "worktrees" | "calm") => void;
```

Replace `removeWorktree` (lines 69-72) with:
```ts
  removeWorktree: (id) => {
    get().setCockpit((c) => ({
      ...c,
      worktrees: c.worktrees.filter((w) => w.id !== id),
      cockpitWorktreeId: c.cockpitWorktreeId === id ? undefined : c.cockpitWorktreeId,
    }));
    set((st) => ({ slots: clearEntity(st.slots, id) }));
  },
```

Replace `assignNewWorktreeSlot` (line 88) with:
```ts
  // Persisted Cockpit-view right-column slot (omit from JSON when cleared).
  setCockpitWorktree: (id) => get().setCockpit((c) => ({ ...c, cockpitWorktreeId: id ?? undefined })),
  // View-dependent placement of a newly-created worktree/scratch (see spec).
  placeNewEntity: (id, view) => {
    if (view === "cockpit") {
      get().setCockpit((c) => ({ ...c, cockpitWorktreeId: id }));
      set((st) => ({ slots: fillFreeSlot(st.slots, id, st.slotCount) }));
    } else {
      set((st) => ({ slots: assignNewWorktree(st.slots, id, st.slotCount) }));
    }
  },
```

Replace `addScratch` (lines 90-99) with (drop the slot assignment):
```ts
  // Scratch terminals are session-only single-shell entities; a monotonic seq keeps ids/titles unique.
  // Creation only — placement into a slot is placeNewEntity's job (view-dependent).
  addScratch: () => {
    const n = get().scratchSeq + 1;
    const id = `scratch-${n}`;
    set((st) => ({ scratchSeq: n, scratchTerminals: [...st.scratchTerminals, { id, title: `Scratch ${n}` }] }));
    return id;
  },
```

Replace `removeScratch` (lines 100-104) with (also clear the cockpit slot):
```ts
  removeScratch: (id) => {
    get().setCockpit((c) => ({ ...c, cockpitWorktreeId: c.cockpitWorktreeId === id ? undefined : c.cockpitWorktreeId }));
    set((st) => ({ scratchTerminals: st.scratchTerminals.filter((s) => s.id !== id), slots: clearEntity(st.slots, id) }));
  },
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/settings/store.test.ts`
Expected: all store tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat(cockpit): persisted slot + view-dependent placeNewEntity + cleanup"
```

---

## Task 4: `SlotColumn` selection made prop-driven (+ Worktrees/Calm callers)

**Files:**
- Modify: `src/views/worktree-column/SlotColumn.tsx`, `src/views/WorktreesView.tsx`, `src/views/CalmView.tsx`

**Interfaces:**
- Consumes: store `slots`/`setSlot` (existing).
- Produces: `SlotColumn({ value: string | null; onSelect: (id: string | null) => void; variant?: "full" | "calm" })`.

- [ ] **Step 1: Refactor `SlotColumn.tsx` signature + selection wiring**

Change the signature (line 13) from `{ slotIndex, variant = "full" }: { slotIndex: number; variant?: "full" | "calm" }` to:
```tsx
export function SlotColumn({ value, onSelect, variant = "full" }: { value: string | null; onSelect: (id: string | null) => void; variant?: "full" | "calm" }) {
```
Change the store destructure (line 14) to drop `setSlot` (no longer used here):
```tsx
  const { cockpit, removeWorktree, removeScratch, scratchTerminals } = useSettings();
```
Change `const activeId = slots[slotIndex];` to:
```tsx
  const activeId = value;
```
Change the picker `onChange` (the `<select … onChange>`) from `onChange={(e) => setSlot(slotIndex, e.target.value || null)}` to:
```tsx
          onChange={(e) => onSelect(e.target.value || null)}
```
Change the Hide button (`onClick={() => { setSlot(slotIndex, null); setMenuOpen(false); }}`) to:
```tsx
                <button onClick={() => { onSelect(null); setMenuOpen(false); }}>Hide</button>
```
(Leave `deleteActive`, the gear menu, `resolveSlotEntity`, and the body rendering unchanged.)

- [ ] **Step 2: Update `WorktreesView.tsx`**

```tsx
// WorktreesView.tsx — the Worktrees view: 2–3 fixed column slots side by side (count from the header toggle).
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function WorktreesView() {
  const slots = useSettings((s) => s.slots);
  const slotCount = useSettings((s) => s.slotCount);
  const setSlot = useSettings((s) => s.setSlot);
  return (
    <div className="wt-view">
      {Array.from({ length: slotCount }, (_, i) => (
        <SlotColumn key={i} value={slots[i]} onSelect={(id) => setSlot(i, id)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update `CalmView.tsx`**

```tsx
// CalmView.tsx — decluttered view: each slot shows only its worktree's Claude Code pane (variant="calm").
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function CalmView() {
  const slots = useSettings((s) => s.slots);
  const slotCount = useSettings((s) => s.slotCount);
  const setSlot = useSettings((s) => s.setSlot);
  return (
    <div className="wt-view">
      {Array.from({ length: slotCount }, (_, i) => (
        <SlotColumn key={i} value={slots[i]} onSelect={(id) => setSlot(i, id)} variant="calm" />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Build + tests**

Run: `npm run build`
Expected: type-checks + bundles clean (no remaining `slotIndex` references).
Run: `npm test`
Expected: all JS tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/views/worktree-column/SlotColumn.tsx src/views/WorktreesView.tsx src/views/CalmView.tsx
git commit -m "refactor(worktree-column): SlotColumn selection via value/onSelect props"
```

---

## Task 5: Cockpit right column + placement wiring + layout (whole-feature gate)

**Files:**
- Modify: `src/views/CockpitView.tsx`, `src/views/CockpitView.css`, `src/App.tsx`, `src/views/NewWorktreeModal.tsx`

**Interfaces:**
- Consumes: `SlotColumn` (Task 4), store `cockpit.cockpitWorktreeId`/`setCockpitWorktree`/`placeNewEntity`/`addScratch` (Task 3).

- [ ] **Step 1: Render the right-column `SlotColumn` in `CockpitView.tsx`**

```tsx
// CockpitView.tsx — dashboard view: left TILES column (Slack) + center local widgets + right worktree column.
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const cockpitWorktreeId = useSettings((s) => s.cockpit.cockpitWorktreeId ?? null);
  const setCockpitWorktree = useSettings((s) => s.setCockpitWorktree);
  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
      </aside>
      <div className="cockpit-view__center">
        <TodoTile />
        <TimerTile />
      </div>
      <aside className="cockpit-view__worktree">
        <SlotColumn value={cockpitWorktreeId} onSelect={setCockpitWorktree} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Layout CSS in `CockpitView.css`**

Append (and ensure `.cockpit-view` is a 3-column flex row; the existing `.cockpit-view`, `.cockpit-view__tiles`, `.cockpit-view__center` rules stay):
```css
.cockpit-view__worktree { flex: 0 0 440px; display: flex; flex-direction: column; min-height: 0; }
.cockpit-view__worktree > * { flex: 1; min-height: 0; }
```

- [ ] **Step 3: Thread the active `view` into placement in `App.tsx`**

Update the store destructure (line 29) to pull `placeNewEntity` too:
```tsx
  const { loaded, init, addScratch, placeNewEntity, slotCount, setSlotCount } = useSettings();
```
Change the Terminal button (line 80) to place the new scratch via the active view:
```tsx
          <button className="app__new" onClick={() => placeNewEntity(addScratch(), view)}>Terminal</button>
```
Pass `view` to the modal (line 89):
```tsx
      {creating && <NewWorktreeModal initialMode={creating} view={view} onClose={() => setCreating(null)} />}
```

- [ ] **Step 4: Use `placeNewEntity` in `NewWorktreeModal.tsx`**

Update `src/views/NewWorktreeModal.tsx` — accept the `view` prop and place via it instead of `assignNewWorktreeSlot`:
```tsx
  const { placeNewEntity } = useSettings();
  const created = (id: string) => { placeNewEntity(id, view); onClose(); };
```
Add `view` to the component's props type (alongside `initialMode`/`onClose`): `view: "cockpit" | "worktrees" | "calm"`.

- [ ] **Step 5: Whole-feature gate — build + both suites**

Run: `npm run build`
Expected: clean (no remaining `assignNewWorktreeSlot` references).
Run: `npm test`
Expected: all JS tests pass.
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/CockpitView.tsx src/views/CockpitView.css src/App.tsx src/views/NewWorktreeModal.tsx
git commit -m "feat(cockpit): right-column worktree pane + view-dependent placement wiring"
```

---

## Self-Review

**1. Spec coverage:**
- `SlotColumn` prop-driven → Task 4. ✅
- `cockpitWorktreeId` persisted (Rust + TS, back-compat) → Task 2. ✅
- `setCockpitWorktree`, `placeNewEntity`, cleanup, addScratch split → Task 3. ✅
- `fillFreeSlot` + `visibleCount` eviction → Task 1. ✅
- View-dependent placement rule (Cockpit vs Worktrees/Calm) → Task 3 (`placeNewEntity`) + Task 5 (App/modal pass `view`). ✅
- 3-column Cockpit layout + right column → Task 5. ✅
- Empty-until-assigned → reused `SlotColumn` empty body (no new code). ✅
- Cleanup-on-delete clears cockpit slot → Task 3. ✅
- Testing (slots helpers, store reducers both branches + cleanup, Rust round-trip/back-compat) → Tasks 1,2,3. ✅

**2. Placeholder scan:** No abstract steps — every code step has complete code; edge cases (full Worktrees view on Cockpit-create → no eviction; deleted/missing/scratch id → empty via `resolveSlotEntity`) are concretely handled. ✅

**3. Type consistency:** `fillFreeSlot(slots, id, visibleCount)` / `assignNewWorktree(slots, id, visibleCount?)` signatures match between Task 1 definition and Task 3 use. `placeNewEntity(id, view)` and `setCockpitWorktree(id|null)` match between the interface (Task 3), the store impl (Task 3), and the callers (Task 5 App/modal, CockpitView). `SlotColumn({value, onSelect, variant})` matches between Task 4 definition and all three callers (WorktreesView, CalmView, CockpitView). `cockpitWorktreeId` (TS) ↔ `cockpit_worktree_id` + `rename="cockpitWorktreeId"` (Rust) parity. The `view` union `"cockpit" | "worktrees" | "calm"` matches App's `View` type, the modal prop, and `placeNewEntity`'s param. ✅

> Note: `SlotColumn`, `CockpitView`, and the layout are not unit-tested (node Vitest env, no DOM); they're build-verified + GUI-checked. The behavioural logic (placement rule, slot helpers, cleanup) lives in tested reducers/pure functions — that's where the risk is.
