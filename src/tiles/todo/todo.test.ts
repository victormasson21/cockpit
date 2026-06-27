import { describe, it, expect } from "vitest";
import { nextState, groupByState } from "./todo";
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
