// todos.test.ts — the To Do slice: item lifecycle and the named list tabs. The load-bearing case is
// materialising "General" on a pre-tabs config, so legacy list-less items don't jump into a new tab.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

import { useSettings } from "../store";
import { resetStore } from "./fixtures";

describe("todo items", () => {
  beforeEach(() => resetStore());

  it("addTodo appends an item in the todo state", () => {
    useSettings.getState().addTodo("ship it");
    const todos = useSettings.getState().cockpit.todos;
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ text: "ship it", state: "todo" });
  });

  it("cycleTodo advances the 3-state cycle and wraps", () => {
    useSettings.getState().addTodo("x");
    const id = useSettings.getState().cockpit.todos[0].id;
    const state = () => useSettings.getState().cockpit.todos[0].state;
    useSettings.getState().cycleTodo(id);
    expect(state()).toBe("in_progress");
    useSettings.getState().cycleTodo(id);
    expect(state()).toBe("done");
    useSettings.getState().cycleTodo(id);
    expect(state()).toBe("todo"); // wraps
  });

  it("editTodo trims, and an emptied item is deleted", () => {
    useSettings.getState().addTodo("x");
    const id = useSettings.getState().cockpit.todos[0].id;
    useSettings.getState().editTodo(id, "  renamed  ");
    expect(useSettings.getState().cockpit.todos[0].text).toBe("renamed");
    useSettings.getState().editTodo(id, "   ");
    expect(useSettings.getState().cockpit.todos).toEqual([]);
  });

  it("removeTodo drops only the matching item", () => {
    useSettings.getState().addTodo("a");
    useSettings.getState().addTodo("b");
    const id = useSettings.getState().cockpit.todos[0].id;
    useSettings.getState().removeTodo(id);
    expect(useSettings.getState().cockpit.todos.map((t) => t.text)).toEqual(["b"]);
  });
});

describe("todo list (tab) actions", () => {
  beforeEach(() => resetStore());

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
