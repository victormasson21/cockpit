# To Do list tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the To Do tile's backlog into user-named tabs while keeping in-progress and done items visible across all lists.

**Architecture:** A new `todoLists: TodoList[]` + `activeTodoList?: string` on the persisted `cockpit.json`, and an optional `listId` on each `TodoItem`. No migration write: two pure resolvers (`resolveLists`, `listIdOf`) make an empty `todoLists` behave as a single synthesised "General" list, so pre-feature configs render exactly as they do today. The tile renders a tab bar, a per-list `TODO` section, then global `IN PROGRESS` and collapsed `DONE` sections whose rows carry a list-name prefix.

**Tech Stack:** React 19 + TypeScript (Vite), Zustand store, Rust/serde for the persisted config, Vitest (frontend) + `cargo test` (Rust).

**Spec:** `docs/superpowers/specs/2026-07-30-todo-list-tabs-design.md`

## Global Constraints

- **Frontend tests are pure-logic + store-level only.** No component/DOM tests — the existing suite has no React rendering tests and this feature adds none. `src/tiles/todo/todo.test.ts` and `src/settings/store.test.ts` are the two test files touched.
- **Every new persisted field must be `#[serde(default)]` in Rust** so an existing `cockpit.json` loads unchanged. Optional fields also carry `skip_serializing_if = "Option::is_none"` to keep saved files clean.
- **No migration write.** An empty `todoLists` is resolved at read time, never rewritten on load.
- **Default list is `{ id: "default", name: "General" }`** — exact values.
- **Comment conventions (CLAUDE.md):** one concise line at the top of every file stating its role, and one concise line above each significant block explaining intent, not syntax. Match the density of the surrounding code.
- **Smallest change that works.** Do not restyle or refactor anything the tabs don't require.
- **Only these colour/size tokens** (all exist): `--tx-hi`, `--tx`, `--tx-2`, `--tx-3`, `--accent`, `--bdr`, `--bad`, `--fs-2xs`, `--fs-xs`, `--fs-sm`, `--space-1`, `--space-2`. No literal colours — `todo.css` is not an allowed literal-colour site.
- **Test commands:** `npx vitest run` (frontend), `cargo test --manifest-path src-tauri/Cargo.toml` (Rust), `npm run build` (tsc + Vite).

---

### Task 1: Persisted shape — TS types, Rust config, back-compat

Adds the fields and proves an existing `cockpit.json` still loads. Nothing renders differently yet.

**Files:**
- Modify: `src/settings/types.ts:37-38` (add `TodoList`, extend `TodoItem`), `src/settings/types.ts:61-72` (extend `CockpitConfig`)
- Modify: `src-tauri/src/settings.rs:124-130` (`TodoItem` + new `TodoList`), `:193-216` (`CockpitConfig`), `:225-244` (`Default`)
- Modify: `src/settings/store.ts:145` (default cockpit literal)
- Modify: `src/settings/store.test.ts:14-21`, `src/settings/workspace.test.ts:14` (both hold `CockpitConfig` literals that must satisfy the new required field)
- Test: `src-tauri/src/settings.rs` (`mod tests`, near the existing `cockpit_without_todos_field_still_loads` at `:444`)

**Interfaces:**
- Consumes: nothing.
- Produces: TS `interface TodoList { id: string; name: string }`; `TodoItem.listId?: string`; `CockpitConfig.todoLists: TodoList[]` (required) and `CockpitConfig.activeTodoList?: string`. Rust `pub struct TodoList { pub id: String, pub name: String }`; `TodoItem.list_id: Option<String>`; `CockpitConfig.todo_lists: Vec<TodoList>` and `active_todo_list: Option<String>`.

- [ ] **Step 1: Write the failing Rust tests**

Add to the `mod tests` block in `src-tauri/src/settings.rs`, next to `cockpit_without_todos_field_still_loads`:

```rust
    #[test]
    fn cockpit_without_todo_lists_field_still_loads() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"todos":[{"id":"t1","text":"ship it","state":"todo"}],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).expect("pre-tabs config should load");
        assert!(cfg.todo_lists.is_empty());
        assert_eq!(cfg.active_todo_list, None);
        assert_eq!(cfg.todos[0].list_id, None);
    }

    #[test]
    fn todo_lists_round_trip() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"todoLists":[{"id":"l1","name":"Work"}],"activeTodoList":"l1","todos":[{"id":"t1","text":"ship it","state":"todo","listId":"l1"}],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).expect("config should load");
        assert_eq!(cfg.todo_lists.len(), 1);
        assert_eq!(cfg.todo_lists[0].id, "l1");
        assert_eq!(cfg.todo_lists[0].name, "Work");
        assert_eq!(cfg.active_todo_list.as_deref(), Some("l1"));
        assert_eq!(cfg.todos[0].list_id.as_deref(), Some("l1"));
        let back = serde_json::to_string(&cfg).expect("serialize");
        assert!(back.contains(r#""todoLists""#));
        assert!(back.contains(r#""activeTodoList":"l1""#));
        assert!(back.contains(r#""listId":"l1""#));
    }

    // A list-less item must not gain a null listId on save: absent stays absent, so a file written by
    // this build still loads on a build without the field.
    #[test]
    fn todo_without_list_omits_list_id_when_saved() {
        let item = TodoItem { id: "t1".into(), text: "x".into(), state: "todo".into(), list_id: None };
        let back = serde_json::to_string(&item).expect("serialize");
        assert!(!back.contains("listId"), "expected listId omitted, got {back}");
    }
```

- [ ] **Step 2: Run the Rust tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml todo`
Expected: FAIL to **compile**, with errors like `no field 'todo_lists' on type 'CockpitConfig'` and `struct 'TodoItem' has no field named 'list_id'`. A compile failure is the correct red state here.

- [ ] **Step 3: Add the Rust fields**

In `src-tauri/src/settings.rs`, replace the `TodoItem` struct (currently at `:124-130`) with:

```rust
// One named to-do list = one tab in the To Do tile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoList {
    pub id: String,
    pub name: String,
}

// One to-do item: stable id + text + lifecycle state ("todo" | "in_progress" | "done"; TS narrows the domain).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub state: String,
    // Which list owns this item. Absent on pre-tabs files and omitted when None — the frontend resolves
    // an absent id to the first list, so no migration write is needed.
    #[serde(rename = "listId", default, skip_serializing_if = "Option::is_none")]
    pub list_id: Option<String>,
}
```

In `CockpitConfig` (`:193-216`), add these two fields directly after the existing `pub todos: Vec<TodoItem>,`:

```rust
    // The To Do tile's tabs. Empty means a pre-tabs file: the frontend resolves that to one synthesised
    // "General" list rather than rewriting the config on load.
    #[serde(default, rename = "todoLists")]
    pub todo_lists: Vec<TodoList>,
    #[serde(rename = "activeTodoList", default, skip_serializing_if = "Option::is_none")]
    pub active_todo_list: Option<String>,
```

In `impl Default for CockpitConfig` (`:225-244`), add after `todos: vec![],`:

```rust
            todo_lists: vec![],
            active_todo_list: None,
```

- [ ] **Step 4: Run the Rust tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — all existing tests plus the 3 new ones. Note the existing `todos_round_trip` must still pass unchanged.

- [ ] **Step 5: Add the TypeScript fields**

In `src/settings/types.ts`, replace line 38 (`export interface TodoItem …`) region so it reads:

```ts
export type TodoState = "todo" | "in_progress" | "done";
// A named to-do list = one tab in the To Do tile.
export interface TodoList { id: string; name: string }
// `listId` is optional: absent (or dangling) resolves to the first list via listIdOf() in
// tiles/todo/todo.ts, so a pre-tabs cockpit.json loads with no migration.
export interface TodoItem { id: string; text: string; state: TodoState; listId?: string }
```

In `CockpitConfig` (`:61-72`), add directly after `todos: TodoItem[];`:

```ts
  todoLists: TodoList[];
  activeTodoList?: string;
```

- [ ] **Step 6: Add `todoLists: []` to the three `CockpitConfig` literals**

`src/settings/store.ts:145` — the default cockpit object; insert `todoLists: [],` immediately after `todos: [],`.

`src/settings/store.test.ts:19` — insert `todoLists: [],` immediately after `todos: [],`.

`src/settings/workspace.test.ts:14` — the line currently reads `version: 1, tiles: [], worktrees: [], knownRepos: [], todos: [],`; make it `version: 1, tiles: [], worktrees: [], knownRepos: [], todos: [], todoLists: [],`.

- [ ] **Step 7: Verify the frontend still typechecks and passes**

Run: `npm run build && npx vitest run`
Expected: tsc clean, Vite build clean, all existing frontend tests PASS. If tsc reports a missing `todoLists` on another `CockpitConfig` literal, add `todoLists: []` there too.

- [ ] **Step 8: Commit**

```bash
git add src/settings/types.ts src/settings/store.ts src/settings/store.test.ts src/settings/workspace.test.ts src-tauri/src/settings.rs
git commit -m "feat: todoLists + per-item listId in the persisted config"
```

---

### Task 2: Pure resolvers in `todo.ts`

The whole no-migration story lives here. Six small pure functions, each unit-tested.

**Files:**
- Modify: `src/tiles/todo/todo.ts` (append; do not touch `nextState`, `groupByState`, or `reorderWithinState`)
- Test: `src/tiles/todo/todo.test.ts` (append)

**Interfaces:**
- Consumes: `TodoList`, `TodoItem` from Task 1.
- Produces, all exported from `src/tiles/todo/todo.ts`:
  - `DEFAULT_LIST: TodoList`
  - `resolveLists(lists: TodoList[]): TodoList[]`
  - `activeListId(lists: TodoList[], active?: string): string`
  - `listIdOf(item: TodoItem, lists: TodoList[]): string`
  - `listNameOf(item: TodoItem, lists: TodoList[]): string`
  - `activeTodos(items: TodoItem[], lists: TodoList[], activeId: string): TodoItem[]`
  - `canDeleteList(lists: TodoList[], items: TodoItem[], id: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/tiles/todo/todo.test.ts`. Note the existing `item()` helper at the top of that file builds `{ id, text: id, state }` — add a second helper rather than changing it, so the existing tests keep working:

```ts
// A list-scoped item; the file's existing item() helper stays list-less on purpose (legacy shape).
const listed = (id: string, state: TodoItem["state"], listId?: string): TodoItem => ({ id, text: id, state, listId });
const L = (id: string, name: string) => ({ id, name });

describe("resolveLists", () => {
  it("synthesises the default list when none are persisted", () => {
    expect(resolveLists([])).toEqual([{ id: "default", name: "General" }]);
  });
  it("passes real lists through untouched", () => {
    const lists = [L("l1", "Work"), L("l2", "Cockpit")];
    expect(resolveLists(lists)).toBe(lists);
  });
});

describe("activeListId", () => {
  it("falls back to the first list when the active id is absent", () => {
    expect(activeListId([L("l1", "Work"), L("l2", "Cockpit")], undefined)).toBe("l1");
  });
  it("falls back to the first list when the active id no longer exists", () => {
    expect(activeListId([L("l1", "Work")], "gone")).toBe("l1");
  });
  it("keeps a live active id", () => {
    expect(activeListId([L("l1", "Work"), L("l2", "Cockpit")], "l2")).toBe("l2");
  });
  it("resolves to the synthesised default when no lists are persisted", () => {
    expect(activeListId([], undefined)).toBe("default");
  });
});

describe("listIdOf", () => {
  it("resolves a legacy item with no listId to the synthesised default", () => {
    expect(listIdOf(item("a", "todo"), [])).toBe("default");
  });
  it("resolves a legacy item with no listId to the first real list", () => {
    expect(listIdOf(item("a", "todo"), [L("l1", "Work"), L("l2", "Cockpit")])).toBe("l1");
  });
  it("resolves a dangling listId to the first list rather than losing the item", () => {
    expect(listIdOf(listed("a", "todo", "deleted"), [L("l1", "Work")])).toBe("l1");
  });
  it("keeps a live listId", () => {
    expect(listIdOf(listed("a", "todo", "l2"), [L("l1", "Work"), L("l2", "Cockpit")])).toBe("l2");
  });
});

describe("listNameOf", () => {
  it("names the owning list", () => {
    expect(listNameOf(listed("a", "in_progress", "l2"), [L("l1", "Work"), L("l2", "Cockpit")])).toBe("Cockpit");
  });
  it("names the synthesised default for a legacy item", () => {
    expect(listNameOf(item("a", "done"), [])).toBe("General");
  });
});

describe("activeTodos", () => {
  const lists = [L("l1", "Work"), L("l2", "Cockpit")];
  const items = [
    listed("a", "todo", "l1"),
    listed("b", "todo", "l2"),
    listed("c", "in_progress", "l1"),
    listed("d", "done", "l1"),
    listed("e", "todo", "l1"),
  ];
  it("keeps only todo-state items from the active list, in input order", () => {
    expect(activeTodos(items, lists, "l1").map((i) => i.id)).toEqual(["a", "e"]);
  });
  it("excludes in_progress and done even for the active list", () => {
    expect(activeTodos(items, lists, "l1").map((i) => i.state)).toEqual(["todo", "todo"]);
  });
  it("includes legacy list-less items when the first list is active", () => {
    expect(activeTodos([item("z", "todo")], lists, "l1").map((i) => i.id)).toEqual(["z"]);
  });
});

describe("canDeleteList", () => {
  const lists = [L("l1", "Work"), L("l2", "Cockpit")];
  it("allows deleting an empty, non-last list", () => {
    expect(canDeleteList(lists, [listed("a", "todo", "l1")], "l2")).toBe(true);
  });
  it("refuses a list holding a todo item", () => {
    expect(canDeleteList(lists, [listed("a", "todo", "l2")], "l2")).toBe(false);
  });
  it("refuses a list holding a done item (all states count, not just visible ones)", () => {
    expect(canDeleteList(lists, [listed("a", "done", "l2")], "l2")).toBe(false);
  });
  it("refuses the last remaining list", () => {
    expect(canDeleteList([L("l1", "Work")], [], "l1")).toBe(false);
  });
  it("refuses an unknown list id", () => {
    expect(canDeleteList(lists, [], "nope")).toBe(false);
  });
  it("refuses when no lists are persisted (the synthesised default is never deletable)", () => {
    expect(canDeleteList([], [], "default")).toBe(false);
  });
});
```

Extend the import on line 2 of that file to:

```ts
import {
  nextState, groupByState, reorderWithinState,
  resolveLists, activeListId, listIdOf, listNameOf, activeTodos, canDeleteList,
} from "./todo";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tiles/todo/todo.test.ts`
Expected: FAIL — `resolveLists is not a function` (or a tsc/esbuild error about the missing exports).

- [ ] **Step 3: Implement the resolvers**

Append to `src/tiles/todo/todo.ts`, and extend its type import on line 2 to `import type { TodoItem, TodoList, TodoState } from "../../settings/types";`:

```ts
// The list a pre-tabs config resolves into: one tab holding every existing item. Materialised into
// `todoLists` only when the user first adds a list or a to-do (see the store) — never on load.
export const DEFAULT_LIST: TodoList = { id: "default", name: "General" };

// Always yields at least one list. An empty `todoLists` means "pre-tabs file", NOT "the user wants zero
// tabs" — a tile with no tab has nowhere to put an item.
export function resolveLists(lists: TodoList[]): TodoList[] {
  return lists.length ? lists : [DEFAULT_LIST];
}

// The active tab, defaulting to the first list. Covers both a config that never had one and one naming
// a list since deleted.
export function activeListId(lists: TodoList[], active?: string): string {
  const resolved = resolveLists(lists);
  return resolved.some((l) => l.id === active) ? (active as string) : resolved[0].id;
}

// An item's effective list. An absent or dangling listId falls back to the first list, so an item can
// never become unreachable by deleting a list out from under it.
export function listIdOf(item: TodoItem, lists: TodoList[]): string {
  const resolved = resolveLists(lists);
  return resolved.some((l) => l.id === item.listId) ? (item.listId as string) : resolved[0].id;
}

// Display name for the row prefix in the cross-list IN PROGRESS / DONE sections.
export function listNameOf(item: TodoItem, lists: TodoList[]): string {
  const id = listIdOf(item, lists);
  return resolveLists(lists).find((l) => l.id === id)!.name;
}

// The active tab's backlog: todo-state items owned by that list, input order preserved.
export function activeTodos(items: TodoItem[], lists: TodoList[], activeId: string): TodoItem[] {
  return items.filter((i) => i.state === "todo" && listIdOf(i, lists) === activeId);
}

// A list is deletable only when it holds nothing (in any state) and isn't the last one standing. This is
// the entire safety story for deletion: no confirm dialog, and no path that silently drops items.
export function canDeleteList(lists: TodoList[], items: TodoItem[], id: string): boolean {
  const resolved = resolveLists(lists);
  if (resolved.length <= 1 || !resolved.some((l) => l.id === id)) return false;
  return !items.some((i) => listIdOf(i, lists) === id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tiles/todo/todo.test.ts`
Expected: PASS — the 5 pre-existing describe blocks plus the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/todo/todo.ts src/tiles/todo/todo.test.ts
git commit -m "feat: pure list resolvers for the To Do tile tabs"
```

---

### Task 3: Store actions

Four new list actions plus stamping the active list onto new items.

**Files:**
- Modify: `src/settings/store.ts` — the `SettingsState` interface near `:30-34`, the import on `:5`, and the todo action block at `:207-224`
- Test: `src/settings/store.test.ts` (append a new describe block)

**Interfaces:**
- Consumes: `DEFAULT_LIST`, `activeListId`, `canDeleteList` from Task 2; the config fields from Task 1.
- Produces, on the store: `addTodoList(name: string): string` (returns the new list's id), `renameTodoList(id: string, name: string): void`, `removeTodoList(id: string): void`, `setActiveTodoList(id: string): void`. `addTodo(text: string): void` keeps its signature but now stamps `listId`.

- [ ] **Step 1: Write the failing tests**

Append to `src/settings/store.test.ts`:

```ts
describe("todo list (tab) actions", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true });
  });

  // The load-bearing case: adding the first tab must materialise "General" too, or every pre-tabs item
  // would silently jump into the new tab (listIdOf falls back to lists[0]).
  it("addTodoList on a pre-tabs config materialises General first, keeping legacy items in it", () => {
    useSettings.setState((st) => ({
      cockpit: { ...st.cockpit, todos: [{ id: "old", text: "legacy", state: "todo" }] },
    }));
    const newId = useSettings.getState().addTodoList("Work");
    const c = useSettings.getState().cockpit;
    expect(c.todoLists.map((l) => l.name)).toEqual(["General", "Work"]);
    expect(c.todoLists[0].id).toBe("default");
    expect(c.activeTodoList).toBe(newId);
    // the legacy item still has no listId, and still resolves to General
    expect(c.todos[0].listId).toBeUndefined();
  });

  it("addTodoList switches to the new list and returns its id", () => {
    const a = useSettings.getState().addTodoList("Work");
    const b = useSettings.getState().addTodoList("Cockpit");
    const c = useSettings.getState().cockpit;
    expect(c.todoLists.map((l) => l.name)).toEqual(["General", "Work", "Cockpit"]);
    expect(c.activeTodoList).toBe(b);
    expect(a).not.toBe(b);
  });

  it("addTodo stamps the active list", () => {
    const work = useSettings.getState().addTodoList("Work");
    useSettings.getState().addTodo("ship it");
    const todos = useSettings.getState().cockpit.todos;
    expect(todos).toHaveLength(1);
    expect(todos[0].listId).toBe(work);
  });

  it("addTodo on a pre-tabs config materialises General and stamps it", () => {
    useSettings.getState().addTodo("ship it");
    const c = useSettings.getState().cockpit;
    expect(c.todoLists).toEqual([{ id: "default", name: "General" }]);
    expect(c.todos[0].listId).toBe("default");
  });

  it("renameTodoList trims and saves", () => {
    const id = useSettings.getState().addTodoList("Work");
    useSettings.getState().renameTodoList(id, "  Day job  ");
    expect(useSettings.getState().cockpit.todoLists.find((l) => l.id === id)!.name).toBe("Day job");
  });

  // Unlike editTodo, an empty name reverts rather than deleting — a nameless tab is meaningless.
  it("renameTodoList ignores an empty name", () => {
    const id = useSettings.getState().addTodoList("Work");
    useSettings.getState().renameTodoList(id, "   ");
    expect(useSettings.getState().cockpit.todoLists.find((l) => l.id === id)!.name).toBe("Work");
  });

  it("removeTodoList drops an empty list and re-points the active tab", () => {
    const work = useSettings.getState().addTodoList("Work");
    useSettings.getState().removeTodoList(work);
    const c = useSettings.getState().cockpit;
    expect(c.todoLists.map((l) => l.name)).toEqual(["General"]);
    expect(c.activeTodoList).toBe("default");
  });

  it("removeTodoList refuses a list that still holds an item", () => {
    const work = useSettings.getState().addTodoList("Work");
    useSettings.getState().addTodo("ship it");
    useSettings.getState().removeTodoList(work);
    expect(useSettings.getState().cockpit.todoLists.map((l) => l.name)).toEqual(["General", "Work"]);
  });

  it("setActiveTodoList switches tabs", () => {
    useSettings.getState().addTodoList("Work");
    useSettings.getState().setActiveTodoList("default");
    expect(useSettings.getState().cockpit.activeTodoList).toBe("default");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/settings/store.test.ts`
Expected: FAIL — `addTodoList is not a function`.

- [ ] **Step 3: Implement the actions**

In `src/settings/store.ts`, extend the import on line 5 to:

```ts
import { nextState, reorderWithinState, activeListId, canDeleteList, DEFAULT_LIST } from "../tiles/todo/todo";
```

Add to the `SettingsState` interface, directly after `reorderTodo` (`:34`):

```ts
  addTodoList: (name: string) => string;
  renameTodoList: (id: string, name: string) => void;
  removeTodoList: (id: string) => void;
  setActiveTodoList: (id: string) => void;
```

Replace the existing `addTodo` (`:208-209`) with:

```ts
  // New items land in the active tab. Materialising DEFAULT_LIST on a pre-tabs config keeps existing
  // list-less items resolving to that same "General" tab rather than to a newly added one.
  addTodo: (text) =>
    get().setCockpit((c) => ({
      ...c,
      todoLists: c.todoLists.length ? c.todoLists : [DEFAULT_LIST],
      todos: [
        ...c.todos,
        { id: crypto.randomUUID(), text, state: "todo", listId: activeListId(c.todoLists, c.activeTodoList) },
      ],
    })),
```

Add the four list actions after `reorderTodo` (`:224`):

```ts
  // Tabs. Adding the first one must also materialise the synthesised "General", otherwise every
  // pre-tabs item would silently jump into the new list (listIdOf falls back to lists[0]).
  addTodoList: (name) => {
    const id = crypto.randomUUID();
    get().setCockpit((c) => {
      const base = c.todoLists.length ? c.todoLists : [DEFAULT_LIST];
      return { ...c, todoLists: [...base, { id, name }], activeTodoList: id };
    });
    return id;
  },
  // An empty name reverts (a nameless tab is meaningless) — deliberately not editTodo's delete-on-empty.
  renameTodoList: (id, name) =>
    get().setCockpit((c) => {
      const trimmed = name.trim();
      if (!trimmed) return c;
      return { ...c, todoLists: c.todoLists.map((l) => (l.id === id ? { ...l, name: trimmed } : l)) };
    }),
  // Guarded here as well as in the UI, so "an emptied, non-last list" holds however it's called.
  removeTodoList: (id) =>
    get().setCockpit((c) => {
      if (!canDeleteList(c.todoLists, c.todos, id)) return c;
      const remaining = c.todoLists.filter((l) => l.id !== id);
      return {
        ...c,
        todoLists: remaining,
        activeTodoList: c.activeTodoList === id ? remaining[0]?.id : c.activeTodoList,
      };
    }),
  setActiveTodoList: (id) => get().setCockpit((c) => ({ ...c, activeTodoList: id })),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run && npm run build`
Expected: all frontend tests PASS (the new describe block plus every pre-existing one), tsc + Vite clean.

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat: store actions for To Do list tabs"
```

---

### Task 4: Tile UI — tab bar, per-list TODO, global sections

The visible feature. No new tests (the suite has no component tests); the gate is tsc + build + the GUI checklist.

**Files:**
- Modify: `src/tiles/todo/TodoTile.tsx` (substantial rework)
- Modify: `src/tiles/todo/todo.css` (append)

**Interfaces:**
- Consumes: every export from Task 2 and every store action from Task 3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Rewrite `TodoTile.tsx`**

Replace the whole file with:

```tsx
// TodoTile.tsx — tabbed to-do list: per-list TODO, plus global IN PROGRESS / DONE sections whose rows
// name their owning list. Persisted via the store.
import { useState } from "react";
import { Tile } from "../Tile";
import { useSettings } from "../../settings/store";
import { groupByState, resolveLists, activeListId, activeTodos, listNameOf, canDeleteList } from "./todo";
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
import type { TodoItem, TodoState } from "../../settings/types";
import "./todo.css";

// Status glyph per state; clicking it cycles to the next state.
const GLYPH: Record<TodoState, string> = { todo: "○", in_progress: "◐", done: "●" };

export function TodoTile() {
  const {
    cockpit, addTodo, cycleTodo, removeTodo, editTodo, reorderTodo,
    addTodoList, renameTodoList, removeTodoList, setActiveTodoList,
  } = useSettings();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // null = not adding a list; a string = the in-progress name draft.
  const [newList, setNewList] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false); // session-only; DONE starts collapsed

  const lists = resolveLists(cockpit.todoLists);
  const activeId = activeListId(cockpit.todoLists, cockpit.activeTodoList);
  const backlog = activeTodos(cockpit.todos, cockpit.todoLists, activeId);
  const groups = groupByState(cockpit.todos); // global buckets for IN PROGRESS / DONE

  const add = () => { const t = draft.trim(); if (!t) return; addTodo(t); setDraft(""); };
  const startEdit = (id: string, text: string) => { setEditingId(id); setEditDraft(text); };
  // Escape clears editingId first → the input unmounts; React 19 does NOT fire onBlur on unmount, and this
  // guard no-ops anyway once editingId is null, so Escape reliably discards the draft (no accidental save).
  const commitEdit = () => { if (editingId) editTodo(editingId, editDraft); setEditingId(null); };
  // Same unmount-before-blur reasoning as commitEdit: the null guard makes Escape a clean cancel.
  const commitNewList = () => { const t = (newList ?? "").trim(); if (t) addTodoList(t); setNewList(null); };
  const commitRename = () => { if (renameDraft !== null) renameTodoList(activeId, renameDraft); setRenameDraft(null); };

  // Pointer-event drag, started only from the ⋮⋮ handle. HTML5 DnD is unavailable app-wide once
  // Tauri's native drag-drop owns file drops, so we capture the pointer and hit-test rows manually.
  // A dedicated handle (rather than a whole-row drag) keeps the glyph-click and text-click unambiguous.
  const onHandleDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault(); // suppress text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(id);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    // Pointer capture routes moves to the handle, so hit-test the real cursor position for the row.
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-todo-id]");
    const id = row?.getAttribute("data-todo-id") ?? null;
    setDragOverId(id === draggingId ? null : id);
  };
  const onHandleUp = () => {
    if (draggingId && dragOverId) reorderTodo(draggingId, dragOverId);
    setDraggingId(null);
    setDragOverId(null);
  };

  // One row shape for all three sections; `tag` names the owning list and is passed only by the
  // cross-list sections (the TODO section shows one list, so a prefix there would be noise).
  const row = (t: TodoItem, tag?: string) => (
    <div
      key={t.id}
      data-todo-id={t.id}
      className={`todo__row todo__row--${t.state}${dragOverId === t.id ? " todo__row--drop-target" : ""}`}
    >
      {/* span, not button: no keyboard affordance to preserve, and a span carries no implicit tab stop */}
      <span
        className="todo__handle"
        onPointerDown={editingId === t.id ? undefined : onHandleDown(t.id)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      >⋮⋮</span>
      <button className="todo__glyph" aria-label="cycle state" onClick={() => cycleTodo(t.id)}>{GLYPH[t.state]}</button>
      {tag && <span className="todo__list-tag">{tag}</span>}
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
      <CreateWorktreeButton source="todo" view="cockpit" getInput={() => t.text} title="Create worktree from this to-do" />
      <button className="todo__del" aria-label="delete" onClick={() => removeTodo(t.id)}>✕</button>
    </div>
  );

  return (
    <Tile title="TO DO" icon={<span>☑</span>}>
      <div className="todo">
        {/* Tab bar: click a tab to switch, click the ACTIVE tab's name to rename it, ✕ deletes an emptied one. */}
        <nav className="todo__tabs">
          {lists.map((l) => (
            <span key={l.id} className={`todo__tab${l.id === activeId ? " todo__tab--active" : ""}`}>
              {renameDraft !== null && l.id === activeId ? (
                <input
                  className="todo__tab-edit"
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenameDraft(null);
                  }}
                />
              ) : (
                <button
                  className="todo__tab-name"
                  onClick={() => (l.id === activeId ? setRenameDraft(l.name) : setActiveTodoList(l.id))}
                  title={l.id === activeId ? "Click to rename" : `Switch to ${l.name}`}
                >{l.name}</button>
              )}
              {l.id === activeId && canDeleteList(cockpit.todoLists, cockpit.todos, l.id) && (
                <button className="todo__tab-del" aria-label="delete list" title="Delete this list" onClick={() => removeTodoList(l.id)}>✕</button>
              )}
            </span>
          ))}
          {newList === null ? (
            <button className="todo__tab-add" aria-label="new list" title="New list" onClick={() => setNewList("")}>+</button>
          ) : (
            <input
              className="todo__tab-edit"
              autoFocus
              placeholder="List name…"
              value={newList}
              onChange={(e) => setNewList(e.target.value)}
              onBlur={commitNewList}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewList();
                if (e.key === "Escape") setNewList(null);
              }}
            />
          )}
        </nav>

        {cockpit.todos.length === 0 && <div className="todo__empty">No todos yet</div>}

        {/* Active list's backlog + the add input (which adds to this list). */}
        <div className="todo__section">
          <div className="todo__section-label">TODO</div>
          {backlog.map((t) => row(t))}
          <input className="todo__add" placeholder="Add a to-do…" value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>

        {/* Global: everything in flight, whichever list owns it. */}
        {groups.in_progress.length > 0 && (
          <div className="todo__section">
            <div className="todo__section-label">IN PROGRESS</div>
            {groups.in_progress.map((t) => row(t, listNameOf(t, cockpit.todoLists)))}
          </div>
        )}

        {/* Global, collapsed by default so finished work across lists never crowds the tile. */}
        {groups.done.length > 0 && (
          <div className="todo__section">
            <button className="todo__section-toggle" onClick={() => setDoneOpen(!doneOpen)}>
              {doneOpen ? "▾" : "▸"} DONE ({groups.done.length})
            </button>
            {doneOpen && groups.done.map((t) => row(t, listNameOf(t, cockpit.todoLists)))}
          </div>
        )}
      </div>
    </Tile>
  );
}
```

- [ ] **Step 2: Append the CSS**

Add to the end of `src/tiles/todo/todo.css`:

```css
/* Tab bar: one tab per list, `+` appends. Same underline-active idiom as the Home|Diff tabs, tile-scaled. */
.todo__tabs { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); border-bottom: 1px solid var(--bdr); }
.todo__tab { display: flex; align-items: center; gap: var(--space-1); }
/* These reset the global `button` baseline: its padding would blow the tab row out (same reason
   .wt-info__btn resets it rather than reusing .icon-btn). */
.todo__tab-name, .todo__tab-add, .todo__tab-del, .todo__section-toggle {
  background: none; border: none; padding: 0; cursor: pointer; color: var(--tx-2);
  font-size: var(--fs-sm); line-height: 1;
}
.todo__tab-name { padding: 4px 2px; margin-bottom: -1px; border-bottom: 2px solid transparent; transition: color 200ms ease-out; }
.todo__tab-name:hover, .todo__tab-add:hover, .todo__section-toggle:hover { color: var(--tx); }
.todo__tab--active .todo__tab-name { color: var(--tx-hi); border-bottom-color: var(--accent); font-weight: 600; }
.todo__tab-del { color: var(--tx-3); font-size: var(--fs-2xs); }
.todo__tab-del:hover { color: var(--bad); }
.todo__tab-add { padding: 4px 6px; }
/* Inherits bg/border/radius/padding/font from the global `input` baseline (tokens.css); only size here. */
.todo__tab-edit { font-size: var(--fs-sm); width: 8em; min-width: 0; }
.todo__section-toggle { align-self: flex-start; font-size: var(--fs-2xs); letter-spacing: 0.08em; color: var(--tx-3); }
/* Row prefix naming the owning list, for the cross-list sections. Fixed-size and self-ellipsising so a
   long list name can't eat the row: .todo__text (flex: 1; min-width: 0) truncates first. The Cockpit
   centre column has a 320px floor, so that ordering matters. */
.todo__list-tag {
  flex: 0 0 auto; max-width: 6em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--tx-3); font-size: var(--fs-xs);
}
.todo__list-tag::after { content: "·"; margin-left: 4px; }
```

- [ ] **Step 3: Verify the build and the whole suite**

Run: `npm run build && npx vitest run && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: tsc clean, Vite build clean, all frontend tests PASS, all Rust tests PASS. If tsc flags the unused `TodoState` import, keep it — `GLYPH` uses it.

- [ ] **Step 4: Commit**

```bash
git add src/tiles/todo/TodoTile.tsx src/tiles/todo/todo.css
git commit -m "feat: tab bar + global in-progress/done sections in the To Do tile"
```

- [ ] **Step 5: GUI acceptance checklist (human eyeball — the app can't be driven headlessly)**

Run `npm run tauri dev`, go to the Cockpit view's Home tab, and confirm:

1. An existing config shows exactly one tab, **General**, holding every pre-existing item — nothing moved or vanished.
2. `+` → type "Work" → Enter creates the tab and switches to it. The tab bar now reads `General | Work | +`.
3. Adding a to-do while **Work** is active puts it under Work's TODO only; switching to General does not show it.
4. Cycling that item to in-progress moves it into **IN PROGRESS** prefixed `Work ·`, and it stays visible from either tab.
5. Cycling it again moves it into the collapsed `▸ DONE (n)`; clicking the toggle expands it, still prefixed `Work ·`.
6. Cycling it back to todo returns it to Work's TODO, not General's.
7. Clicking the **active** tab's name renames it inline: Enter saves, Escape reverts, an empty name reverts.
8. `✕` appears on the active tab only once it holds zero items, and never on the last remaining tab.
9. Dragging a TODO row by its ⋮⋮ handle still reorders within the section.
10. Quit and reopen: the tabs, each item's list, and the active tab all survive; DONE is collapsed again.

---

### Task 5: Document the as-built behaviour

**Files:**
- Modify: `CLAUDE.md` (append a bullet to the "As-built notes" list, next to the existing To Do tile notes)

**Interfaces:**
- Consumes: the finished feature.
- Produces: nothing.

- [ ] **Step 1: Add the as-built note**

Append this bullet to `CLAUDE.md` immediately after the existing "**To Do tile: inline edit + drag-reorder (2026-07-03)**" bullet:

```markdown
- **To Do tile: list tabs (2026-07-30).** The tile's backlog is split into user-named **tabs**
  (`todoLists: TodoList[]` + `activeTodoList?` in `cockpit.json`; each `TodoItem` gains an optional
  `listId`). The rule is **unstarted work is per-list, touched work is global**: `TODO` shows the active
  tab only, while `IN PROGRESS` and `DONE` show items from **every** list, each row prefixed with its
  list name (`.todo__list-tag`) — so in-flight work is never hidden behind a tab. `DONE` is collapsed
  behind a `▸ DONE (n)` toggle (session-only local state, starts collapsed). **No migration write:** two
  pure resolvers in `todo.ts` do the work — `resolveLists` turns an empty `todoLists` into a synthesised
  `{ id: "default", name: "General" }`, and `listIdOf` resolves an absent *or dangling* `listId` to the
  first list, so a pre-tabs config renders as one "General" tab and an item can't be orphaned by deleting
  a list. **Gotcha:** `addTodoList`/`addTodo` must **materialise** `DEFAULT_LIST` into `todoLists` before
  appending, or every legacy list-less item would silently jump into the newly added tab (they resolve to
  `lists[0]`). Tab management: `+` adds (inline name input), clicking the **active** tab's name renames it
  (empty **reverts** — unlike `editTodo`'s delete-on-empty, since a nameless tab is meaningless), and `✕`
  deletes — rendered only when that list holds zero items in any state and isn't the last one
  (`canDeleteList`, enforced in the store too). That gate is the whole safety story: no confirm dialog, no
  path that silently drops items. **`reorderWithinState` is unchanged** — its same-state guard suffices,
  because only the active list's TODO rows are ever on screen, so a cross-list TODO drag is unreachable
  rather than merely rejected. Rust: `TodoList` + `todo_lists`/`active_todo_list`/`list_id`, all
  `#[serde(default)]`. Spec: `docs/superpowers/specs/2026-07-30-todo-list-tabs-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: as-built note for the To Do list tabs"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

| Spec section | Task |
|---|---|
| Rule (per-list TODO, global IN PROGRESS/DONE) | 4 (render), 2 (`activeTodos`) |
| Layout (tab bar → TODO → add input → IN PROGRESS → collapsed DONE) | 4 |
| Data model (`todoLists`, `activeTodoList`, `listId`) | 1 |
| No migration write (`resolveLists`, `listIdOf`) | 2 |
| Dangling `listId` → first list | 2 (`listIdOf` test) |
| Dangling `activeTodoList` → first list | 2 (`activeListId` — added beyond the spec's five-helper list, since the spec requires the behaviour) |
| `activeTodoList` persists | 1 (field), 3 (`setActiveTodoList`) |
| Add / rename / delete list | 3 (store), 4 (UI) |
| Delete gated on empty + not-last | 2 (`canDeleteList`), 3 (store guard), 4 (UI gate) |
| Rename empty reverts | 3 |
| Rows unchanged (cycle/edit/delete/handle/CreateWorktreeButton) | 4 (row markup carried over verbatim) |
| Reorder needs no logic change | 2 (explicitly does not touch `reorderWithinState`) |
| Sections hide when empty; tile-level empty message | 4 |
| `.todo__list-tag` sizing vs the 320px floor | 4 |
| Testing (JS helpers + Rust back-compat) | 1, 2, 3 |
| Out of scope (tab drag-reorder, moving items between lists, count badges, Timer/`<Tile>` changes) | not implemented anywhere |

**Placeholder scan:** no TBDs, no "add error handling", no "similar to Task N" — every code step carries its actual content.

**Type consistency:** `resolveLists` / `activeListId` / `listIdOf` / `listNameOf` / `activeTodos` / `canDeleteList` / `DEFAULT_LIST` are spelled identically in Task 2's implementation, Task 2's tests, Task 3's store code, and Task 4's tile import. Rust `todo_lists` / `active_todo_list` / `list_id` match their `rename` attributes (`todoLists` / `activeTodoList` / `listId`) and the TS field names. `addTodoList` returns `string` in the interface, the implementation, and the test that asserts on the returned id.
