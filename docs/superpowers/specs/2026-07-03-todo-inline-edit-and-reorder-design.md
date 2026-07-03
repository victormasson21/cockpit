# To Do tile — inline edit + reorder (design)

Date: 2026-07-03

Two enhancements to the existing `TodoTile` (`src/tiles/todo/`): make items
**editable inline** and **reorderable within their section**. The tile keeps its
3-section grouping (TODO / IN PROGRESS / DONE). No new dependencies; no
`cockpit.json` schema change (the `todos: TodoItem[]` array order already carries
ordering).

## 1. Inline editing

- Click a todo's text → it becomes a text `<input>` in place, seeded with the
  current text. Local component state holds `{ editingId, editDraft }`.
- **Enter** or **blur** saves; **Escape** cancels and reverts.
- Saving empty/whitespace text **deletes** the item (treated as "cleared it").
- New store action `editTodo(id, text)` — a trivial `todos.map` next to the
  existing `addTodo`/`cycleTodo`/`removeTodo`.

## 2. Reordering within a section (native HTML5 DnD)

- Each row gets `draggable` + `onDragStart` / `onDragOver` / `onDrop`. No DnD
  library — fits the codebase's "fewest dependencies" priority.
- Reordering is **constrained to the row's own section**: a drop only reorders
  when the dragged and target items share the same `state`. A cross-section drop
  is a no-op (changing state stays the glyph-click's job), which keeps the
  grouping coherent.
- Ordering logic is a **pure, tested helper** in `todo.ts`:
  `reorderWithinState(items, draggedId, targetId): TodoItem[]` — moves
  `draggedId` to `targetId`'s position **only when both share the same state**,
  preserving every other item's relative order; returns the full reordered array
  (exactly what the store persists). No-op (returns input order) on cross-section
  drops or unknown ids.
- New store action `reorderTodo(draggedId, targetId)` calling the helper.
- Affordance: `cursor: grab` on rows; a drop-target highlight
  (`todo__row--drop-target`, a top border) driven by a local `dragOverId` state.

## Data flow

`TodoTile` local UI state (`editingId`, `editDraft`, `dragOverId`) → store
actions `editTodo` / `reorderTodo` → `setCockpit` persists to `cockpit.json`.
Order is intrinsic to the `todos` array → **no schema/serde change**, fully
back-compatible.

## Testing (`todo.test.ts`)

- `reorderWithinState`: same-section move up, move down, no-op on cross-section
  drop, no-op on unknown id, relative order of untouched items preserved.
- Deletion-on-empty-save rule: a small store-level assertion.

## Files touched

- `src/tiles/todo/todo.ts` — add `reorderWithinState`.
- `src/tiles/todo/TodoTile.tsx` — inline edit + DnD handlers.
- `src/tiles/todo/todo.css` — edit input, `cursor: grab`, drop-target style.
- `src/settings/store.ts` — add `editTodo`, `reorderTodo` (+ interface decls).
- `src/tiles/todo/todo.test.ts` — reorder tests.

## Deferred / non-goals

- Cross-section drag to change state (glyph click already does this).
- Drag animations / a DnD library (@dnd-kit) — YAGNI for a small local widget.
- Keyboard reordering (arrow buttons) — native drag is the chosen mechanism.
