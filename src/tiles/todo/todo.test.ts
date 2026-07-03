import { describe, it, expect } from "vitest";
import { nextState, groupByState, reorderWithinState } from "./todo";
import type { TodoItem } from "../../settings/types";

const item = (id: string, state: TodoItem["state"]): TodoItem => ({ id, text: id, state });

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
