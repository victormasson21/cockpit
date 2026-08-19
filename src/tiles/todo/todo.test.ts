import { describe, it, expect } from "vitest";
import {
  nextState, groupByState, reorderWithinState, reorderLists,
  resolveLists, activeListId, listIdOf, listNameOf, todosInList, canDeleteList,
} from "./todo";
import type { TodoItem } from "../../settings/types";

const item = (id: string, state: TodoItem["state"]): TodoItem => ({ id, text: id, state });
// A list-scoped item; the item() helper above stays list-less on purpose (the legacy shape).
const listed = (id: string, state: TodoItem["state"], listId?: string): TodoItem => ({ id, text: id, state, listId });
const L = (id: string, name: string) => ({ id, name });

describe("nextState", () => {
  it("cycles todo → in_progress → done → todo", () => {
    expect(nextState("todo")).toBe("in_progress");
    expect(nextState("in_progress")).toBe("done");
    expect(nextState("done")).toBe("todo");
  });
});

describe("groupByState", () => {
  it("buckets by state preserving order", () => {
    const items = [item("a", "todo"), item("b", "done"), item("c", "todo"), item("d", "in_progress")];
    const g = groupByState(items);
    expect(g.todo.map((i) => i.id)).toEqual(["a", "c"]);
    expect(g.in_progress.map((i) => i.id)).toEqual(["d"]);
    expect(g.done.map((i) => i.id)).toEqual(["b"]);
  });
  it("returns empty buckets for an empty list", () => {
    expect(groupByState([])).toEqual({ todo: [], in_progress: [], done: [] });
  });
});

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

describe("todosInList", () => {
  const lists = [L("l1", "Work"), L("l2", "Cockpit")];
  const items = [
    listed("a", "todo", "l1"),
    listed("b", "todo", "l2"),
    listed("c", "in_progress", "l1"),
    listed("d", "done", "l1"),
    listed("e", "todo", "l1"),
    listed("f", "done", "l2"),
  ];
  it("keeps only todo-state items from the active list, in input order", () => {
    expect(todosInList(items, lists, "l1", "todo").map((i) => i.id)).toEqual(["a", "e"]);
  });
  it("excludes other states even for the active list", () => {
    expect(todosInList(items, lists, "l1", "todo").map((i) => i.state)).toEqual(["todo", "todo"]);
  });
  it("includes legacy list-less items when the first list is active", () => {
    expect(todosInList([item("z", "todo")], lists, "l1", "todo").map((i) => i.id)).toEqual(["z"]);
  });
  it("scopes done items to the given list", () => {
    expect(todosInList(items, lists, "l1", "done").map((i) => i.id)).toEqual(["d"]);
  });
  it("scopes done items to the other list symmetrically", () => {
    expect(todosInList(items, lists, "l2", "done").map((i) => i.id)).toEqual(["f"]);
  });
});

describe("reorderLists", () => {
  const lists = [L("l1", "Work"), L("l2", "Cockpit"), L("l3", "Home")];

  it("moves a list right to the target's position", () => {
    // drag l1 onto l3 → l1 lands at l3's slot
    expect(reorderLists(lists, "l1", "l3").map((l) => l.id)).toEqual(["l2", "l3", "l1"]);
  });

  it("moves a list left to the target's position", () => {
    // drag l3 onto l1 → l3 lands at l1's slot
    expect(reorderLists(lists, "l3", "l1").map((l) => l.id)).toEqual(["l3", "l1", "l2"]);
  });

  it("is a no-op for an unknown target id", () => {
    expect(reorderLists(lists, "l1", "zzz").map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("is a no-op for an unknown dragged id", () => {
    expect(reorderLists(lists, "zzz", "l1").map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("is a no-op when dragging onto itself", () => {
    expect(reorderLists(lists, "l2", "l2").map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
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
