// todos.ts — the To Do tile's backlog: items, their 3-state cycle, in-section reorder, and the named
// list tabs. All persisted in cockpit.json; ids are random so they survive restarts without a counter.
import { activeListId, canDeleteList, DEFAULT_LIST, nextState, reorderWithinState } from "../../tiles/todo/todo";
import type { SettingsSlice } from "../storeState";

export interface TodosSlice {
  addTodo: (text: string) => void;
  cycleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  editTodo: (id: string, text: string) => void;
  reorderTodo: (draggedId: string, targetId: string) => void;
  addTodoList: (name: string) => string;
  renameTodoList: (id: string, name: string) => void;
  removeTodoList: (id: string) => void;
  setActiveTodoList: (id: string) => void;
}

export const createTodosSlice: SettingsSlice<TodosSlice> = (_set, get) => ({
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
  cycleTodo: (id) =>
    get().setCockpit((c) => ({ ...c, todos: c.todos.map((t) => (t.id === id ? { ...t, state: nextState(t.state) } : t)) })),
  removeTodo: (id) =>
    get().setCockpit((c) => ({ ...c, todos: c.todos.filter((t) => t.id !== id) })),
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
});
