# To Do Tile — Inline Edit + Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make To Do items editable inline (click text → input) and reorderable within their section via native HTML5 drag-and-drop.

**Architecture:** A pure `reorderWithinState` helper in `todo.ts` does the array math (tested in isolation). Two new store actions (`editTodo`, `reorderTodo`) wrap it and the existing edit map. `TodoTile.tsx` holds local UI state (`editingId`, `editDraft`, `dragOverId`) and wires clicks + native DnD handlers. No dependency, no `cockpit.json` schema change — order is intrinsic to the existing `todos: TodoItem[]` array.

**Tech Stack:** React 19 + TypeScript, Zustand store, Vitest. Native browser `draggable`/`onDragStart`/`onDragOver`/`onDrop` (no DnD library).

## Global Constraints

- Build the simplest thing that works; fewest deps/files/abstractions (CLAUDE.md).
- Top-of-file role comment + concise block comments explaining intent, not syntax (CLAUDE.md).
- No new npm dependency.
- No `cockpit.json` schema/serde change — `todos: TodoItem[]` unchanged; ordering is array order.
- `TodoItem` is `{ id: string; text: string; state: TodoState }`; `TodoState = "todo" | "in_progress" | "done"` (`src/settings/types.ts`).
- Reordering is constrained to a single section: a drop only reorders when dragged and target items share the same `state`; cross-section drops are no-ops.
- Save of empty/whitespace edit text deletes the item.

---

### Task 1: `reorderWithinState` pure helper

**Files:**
- Modify: `src/tiles/todo/todo.ts`
- Test: `src/tiles/todo/todo.test.ts`

**Interfaces:**
- Consumes: `TodoItem` from `../../settings/types`.
- Produces: `reorderWithinState(items: TodoItem[], draggedId: string, targetId: string): TodoItem[]` — returns a new array with `draggedId` moved to `targetId`'s index; **no-op (returns a copy in original order)** when the two items are not both present or do not share the same `state`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tiles/todo/todo.test.ts`:

```typescript
import { nextState, groupByState, reorderWithinState } from "./todo";

describe("reorderWithinState", () => {
  const items = [
    item("a", "todo"),
    item("b", "todo"),
    item("c", "todo"),
    item("d", "in_progress"),
  ];

  it("moves an item down to the target's position within the same section", () => {
    // drag a onto c → order becomes b, c, a (a lands at c's slot)
    const r = reorderWithinState(items, "a", "c");
    expect(r.map((i) => i.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up to the target's position within the same section", () => {
    // drag c onto a → c lands at a's slot
    const r = reorderWithinState(items, "c", "a");
    expect(r.map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("is a no-op when dragged and target are in different sections", () => {
    const r = reorderWithinState(items, "a", "d");
    expect(r.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is a no-op for an unknown id", () => {
    const r = reorderWithinState(items, "a", "zzz");
    expect(r.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is a no-op when dragging onto itself", () => {
    const r = reorderWithinState(items, "b", "b");
    expect(r.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});
```

Note: keep the existing `import { nextState, groupByState } from "./todo";` line — replace it with the combined import above (do not leave a duplicate `nextState`/`groupByState` import).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tiles/todo/todo.test.ts`
Expected: FAIL — `reorderWithinState is not a function` (or an import/type error).

- [ ] **Step 3: Write the implementation**

Append to `src/tiles/todo/todo.ts`:

```typescript
// Move draggedId to targetId's position, but ONLY within one section: reorder is a
// no-op unless both ids exist and share the same state (cross-section drops change
// nothing — state changes are the glyph-click's job). Returns a new array.
export function reorderWithinState(
  items: TodoItem[],
  draggedId: string,
  targetId: string,
): TodoItem[] {
  const dragged = items.find((i) => i.id === draggedId);
  const target = items.find((i) => i.id === targetId);
  if (!dragged || !target || dragged.id === target.id || dragged.state !== target.state) {
    return [...items];
  }
  const without = items.filter((i) => i.id !== draggedId);
  const targetIdx = without.findIndex((i) => i.id === targetId);
  without.splice(targetIdx, 0, dragged);
  return without;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tiles/todo/todo.test.ts`
Expected: PASS (all `reorderWithinState` cases + the existing `nextState`/`groupByState` suites).

- [ ] **Step 5: Commit**

```bash
git add src/tiles/todo/todo.ts src/tiles/todo/todo.test.ts
git commit -m "feat(todo): reorderWithinState pure helper for in-section reordering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Store actions `editTodo` + `reorderTodo`

**Files:**
- Modify: `src/settings/store.ts` (interface block ~lines 19-21; imports line 5; actions block ~lines 100-105)

**Interfaces:**
- Consumes: `reorderWithinState` from `../tiles/todo/todo`; existing `setCockpit`.
- Produces: `editTodo: (id: string, text: string) => void` — sets a todo's text; **an empty/whitespace `text` removes the item**. `reorderTodo: (draggedId: string, targetId: string) => void` — reorders via the helper.

- [ ] **Step 1: Extend the import**

Modify line 5 of `src/settings/store.ts`:

```typescript
import { nextState, reorderWithinState } from "../tiles/todo/todo";
```

- [ ] **Step 2: Declare the actions in the interface**

In `interface SettingsState`, immediately after `removeTodo: (id: string) => void;`, add:

```typescript
  editTodo: (id: string, text: string) => void;
  reorderTodo: (draggedId: string, targetId: string) => void;
```

- [ ] **Step 3: Implement the actions**

In the store body, immediately after the `removeTodo` action implementation, add:

```typescript
  // Save edited text; empty/whitespace text deletes the item (treated as "cleared it").
  editTodo: (id, text) =>
    get().setCockpit((c) => {
      const trimmed = text.trim();
      return trimmed
        ? { ...c, todos: c.todos.map((t) => (t.id === id ? { ...t, text: trimmed } : t)) }
        : { ...c, todos: c.todos.filter((t) => t.id !== id) };
    }),
  // Reorder within a section via the pure helper (cross-section drops are no-ops).
  reorderTodo: (draggedId, targetId) =>
    get().setCockpit((c) => ({ ...c, todos: reorderWithinState(c.todos, draggedId, targetId) })),
```

- [ ] **Step 4: Verify types + existing tests compile**

Run: `npx vitest run src/tiles/todo/todo.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts
git commit -m "feat(todo): editTodo + reorderTodo store actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Inline editing in `TodoTile`

**Files:**
- Modify: `src/tiles/todo/TodoTile.tsx`
- Modify: `src/tiles/todo/todo.css`

**Interfaces:**
- Consumes: `editTodo` from the store; existing `addTodo`/`cycleTodo`/`removeTodo`.
- Produces: click-to-edit behavior on the `.todo__text` span (rendered as an `<input>` while editing).

- [ ] **Step 1: Add local edit state + the store action**

In `TodoTile.tsx`, update the store destructure and add edit state:

```typescript
  const { cockpit, addTodo, cycleTodo, removeTodo, editTodo } = useSettings();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
```

- [ ] **Step 2: Add edit helpers**

Below the existing `add` function, add:

```typescript
  const startEdit = (id: string, text: string) => { setEditingId(id); setEditDraft(text); };
  const commitEdit = () => { if (editingId) editTodo(editingId, editDraft); setEditingId(null); };
```

- [ ] **Step 3: Render text as an input while editing**

Replace the `<span className="todo__text">{t.text}</span>` line with:

```tsx
                  {editingId === t.id ? (
                    <input
                      className="todo__edit"
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="todo__text" onClick={() => startEdit(t.id, t.text)}>{t.text}</span>
                  )}
```

- [ ] **Step 4: Style the edit input + click affordance**

In `src/tiles/todo/todo.css`, add:

```css
.todo__text { cursor: text; }
.todo__edit {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  color: var(--text);
  background: var(--surface-2, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}
```

Note: `.todo__text` already has `flex: 1; min-width: 0;` — leave those; only append `cursor: text;` (either extend the existing rule or add this one).

- [ ] **Step 5: Manually verify (build)**

Run: `npx vitest run src/tiles/todo/todo.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors. (Behavior — click text → input, Enter/blur saves, Escape cancels, empty deletes — verified in-app at the review checkpoint.)

- [ ] **Step 6: Commit**

```bash
git add src/tiles/todo/TodoTile.tsx src/tiles/todo/todo.css
git commit -m "feat(todo): click-to-edit inline todo text

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Drag-to-reorder in `TodoTile`

**Files:**
- Modify: `src/tiles/todo/TodoTile.tsx`
- Modify: `src/tiles/todo/todo.css`

**Interfaces:**
- Consumes: `reorderTodo` from the store.
- Produces: each `.todo__row` is `draggable`; dropping a row on another row in the same section reorders (via `reorderTodo`).

- [ ] **Step 1: Add drag state + the store action**

Update the destructure and add drag state:

```typescript
  const { cockpit, addTodo, cycleTodo, removeTodo, editTodo, reorderTodo } = useSettings();
```
```typescript
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
```

- [ ] **Step 2: Make the row draggable + wire handlers**

Replace the row's opening `<div>` (the `todo__row` element) with:

```tsx
                <div
                  key={t.id}
                  className={`todo__row todo__row--${t.state}${dragOverId === t.id ? " todo__row--drop-target" : ""}`}
                  draggable={editingId !== t.id}
                  onDragStart={() => setDraggingId(t.id)}
                  onDragOver={(e) => { e.preventDefault(); if (t.id !== draggingId) setDragOverId(t.id); }}
                  onDragLeave={() => setDragOverId((cur) => (cur === t.id ? null : cur))}
                  onDrop={() => { if (draggingId) reorderTodo(draggingId, t.id); setDraggingId(null); setDragOverId(null); }}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                >
```

Note: `draggable={editingId !== t.id}` keeps text selection working while editing that row.

- [ ] **Step 3: Style the grab cursor + drop target**

In `src/tiles/todo/todo.css`, add:

```css
.todo__row { cursor: grab; }
.todo__row--drop-target { border-top: 2px solid var(--accent, var(--text-secondary)); }
```

- [ ] **Step 4: Verify types + existing tests**

Run: `npx vitest run src/tiles/todo/todo.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/todo/TodoTile.tsx src/tiles/todo/todo.css
git commit -m "feat(todo): drag-to-reorder todos within a section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full JS test suite**

Run: `npx vitest run`
Expected: PASS (all existing suites + the new `reorderWithinState` cases).

- [ ] **Step 2: Type-check + Vite build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; Vite build succeeds.

- [ ] **Step 3: In-app GUI check**

Launch the app; on the Cockpit view's To Do tile confirm:
- Click a todo's text → edits in place; Enter/blur saves; Escape reverts; clearing text deletes it.
- Drag a todo within its section → it reorders; the reordered position survives a reload (persisted).
- Dragging across sections does nothing (state is still changed only by clicking the glyph).

- [ ] **Step 4: Update CLAUDE.md "As-built notes"**

Add a bullet under the To Do/Timer note recording: inline click-to-edit (empty deletes), native-DnD reorder within a section via `reorderWithinState`, no schema change, new store actions `editTodo`/`reorderTodo`, and the final test counts.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record To Do inline edit + reorder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Inline edit (click → input, Enter/blur save, Escape cancel, empty deletes) → Task 3 + `editTodo` (Task 2). ✓
- Reorder within section via native DnD → Task 4 + `reorderWithinState` (Task 1) + `reorderTodo` (Task 2). ✓
- Pure tested helper → Task 1. ✓
- No dep / no schema change → held throughout (Global Constraints). ✓
- Tests: reorder up/down, cross-section no-op, unknown id, self-drop → Task 1. Deletion-on-empty is covered by the in-app check + the store action; a store-level unit test is omitted because the store has no existing unit-test harness (matches the codebase's current test surface — pure helpers are the tested unit). ✓

**Placeholder scan:** none — every code/CSS/command step is concrete.

**Type consistency:** `reorderWithinState(items, draggedId, targetId)` signature identical in Tasks 1, 2. `editTodo(id, text)` / `reorderTodo(draggedId, targetId)` identical in Tasks 2, 3, 4. `TodoItem` shape matches `types.ts`.
