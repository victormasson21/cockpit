# To Do list tabs — design

**Date:** 2026-07-30
**Status:** approved, ready for plan

## Problem

The To Do tile holds one flat list. Everything competes for the same space, so a
backlog item for one project sits next to an unrelated one and the tile stops
being scannable as it grows.

Splitting the backlog by project is the fix — but splitting *everything* by
project hides in-flight work: you'd have to visit each tab to answer "what have I
started?". So tabs scope the backlog only.

## Rule

**Unstarted work is per-list. Touched work is global.**

- `TODO` items show for the **active list only**.
- `IN PROGRESS` and `DONE` show items from **all lists**, each row prefixed with
  the name of the list it belongs to.

List membership is a permanent property of an item; only the *display* rule
varies by state. Cycling an item to `in_progress` moves it into the global
section without changing which list owns it; cycling back returns it to that
list's `TODO`.

## Layout

```
 Work | Cockpit | Personal | +      <- tab bar
------------------------------------
TODO                                <- active list only, no prefix
  ( ) ship the tabs feature
  ( ) pin the Slack fields
  [ Add a to-do...            ]     <- adds to the active tab
------------------------------------
IN PROGRESS                         <- all lists
  (o) Work · review PR #412
  (o) Cockpit · spec the tabs
------------------------------------
> DONE (4)                          <- all lists, collapsed by default
```

The add input sits directly under the `TODO` rows rather than at the tile bottom,
because it adds to the active tab and should be adjacent to it.

`DONE` is collapsed behind a `> DONE (n)` toggle so cross-list finished work never
crowds the tile. Its collapse state is session-only local component state,
defaulting to collapsed.

Sections still hide when empty (existing behaviour). The tile-level
"No todos yet" message shows only when `todos` is entirely empty.

## Data model

New field on the persisted config:

```ts
interface TodoList { id: string; name: string }

// cockpit.json
todoLists: TodoList[]
activeTodoList?: string
```

`TodoItem` gains an optional `listId`.

**No migration write.** Two pure resolvers keep legacy files working:

- `resolveLists(lists)` — returns `lists` when non-empty, else a synthesised
  `[{ id: "default", name: "General" }]`.
- `listIdOf(item, lists)` — returns `item.listId ?? lists[0].id`.

Consequences, all deliberate:

- A pre-feature `cockpit.json` renders exactly as it does today: one tab named
  "General" holding every item.
- An item whose `listId` points at a deleted list falls back to the first list
  rather than vanishing.
- The in-memory config never holds a copy of a list it hasn't persisted — the
  synthesised default lives only in the resolver's return value. This mirrors the
  `workspace` block's absent-vs-empty distinction: absent means "pre-feature,
  fall back", not "the user removed everything".

`activeTodoList` **persists** across restarts (precedent:
`preferences.defaultView`). An `activeTodoList` naming a list that no longer
exists resolves to the first list.

## Interactions

| Action | Behaviour |
|--------|-----------|
| Switch list | Click a tab. |
| Add list | `+` opens an inline name input in the tab bar. Enter creates and switches to it; Escape cancels; an empty name cancels. |
| Rename list | Click the **active** tab's name to turn it into an input. Enter saves, Escape reverts. An empty name **reverts** — deliberately *not* delete-on-empty like todo rows, since an unnamed list is meaningless. |
| Delete list | `✕` on the active tab, rendered only when that list holds zero items **and** is not the last remaining list. |

Deletion being gated on emptiness is the entire safety story — no confirm dialog,
and no path where items are silently lost. "Holds zero items" counts items in
every state, not just the visible `TODO` ones.

Row-level behaviour is **unchanged**: glyph cycling, inline edit, delete, the drag
handle, and `CreateWorktreeButton`.

### Reorder needs no logic change

`reorderWithinState`'s existing same-state guard is already sufficient:

- In the `TODO` section only the active list's rows are on screen, so the
  pointer hit-test can never resolve a row from another list — a cross-list
  `TODO` drag is unreachable, not merely rejected.
- In the global `IN PROGRESS` / `DONE` sections a cross-list drag reorders the
  flat `todos` array, which is display order only. That is acceptable: the rows
  carry their list prefix, so the result is unsurprising.

## Code shape

**`src/tiles/todo/todo.ts`** (existing pure module, unit-tested) gains:

- `resolveLists(lists)` — always returns at least one list
- `listIdOf(item, lists)` — effective list id
- `listNameOf(item, lists)` — display name for the row prefix
- `activeTodos(items, lists, activeId)` — the active list's `todo` items
- `canDeleteList(lists, items, id)` — the emptiness + last-list gate

`nextState`, `groupByState`, and `reorderWithinState` are unchanged.
`groupByState` is reused to bucket the global `IN PROGRESS` / `DONE` sections.

**`src/settings/store.ts`** gains `addTodoList` / `renameTodoList` /
`removeTodoList` / `setActiveTodoList`; `addTodo` stamps the active list id onto
the new item.

**`src/tiles/todo/TodoTile.tsx`** renders the tab bar, the active-list `TODO`
section, the two global sections, and the `DONE` collapse toggle.

**`src/tiles/todo/todo.css`** gains tab-bar styling and a `.todo__list-tag`
prefix span: dim `--tx-3` at `--fs-xs`, `flex: 0 0 auto` with its own
`max-width` + ellipsis, so a long list name cannot eat the row — the item text
keeps `flex: 1; min-width: 0` and truncates first. This ordering matters because
the Cockpit centre column has a 320px floor.

**`src-tauri/src/settings.rs`** gains `todo_lists: Vec<TodoList>`,
`active_todo_list: Option<String>`, and `TodoItem.list_id: Option<String>`, all
`#[serde(default)]` so old files load unchanged.

## Testing

The frontend suite is pure-logic only (no component tests) — that convention
holds here.

- **JS:** the five new helpers in `todo.test.ts`, covering the legacy path
  (empty `todoLists` → synthesised default), an item pointing at a deleted list,
  the `canDeleteList` gate (non-empty list, last list), and `activeTodos`
  filtering by both list and state.
- **Rust:** serde back-compat (a `cockpit.json` with no `todoLists` and items
  with no `listId` still loads) plus a round-trip, mirroring the existing
  `cockpit_without_todos_field_still_loads` / `todos_round_trip` pair.

## Out of scope

- Reordering or renaming tabs by drag.
- Moving an item between lists (create it in the right list; a cross-list
  reassignment UI is speculative until the need shows up).
- A per-list count badge on the tabs.
- Any change to the Timer tile or the shared `<Tile>` shell.
