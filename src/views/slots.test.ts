// slots.test.ts — pure slot-reducer behavior for the 3-column Worktrees view.
import { describe, it, expect } from "vitest";
import { SLOT_COUNT, initSlots, setSlotAt, assignNewWorktree, clearEntity, resolveSlotEntity, type ScratchTerminal } from "./slots";
import type { Worktree } from "../settings/types";

const wt = (id: string, status: Worktree["status"] = "ongoing"): Worktree => ({
  id, name: id, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status,
});

describe("slots", () => {
  it("initSlots takes the first 3 ongoing worktrees, padding with null", () => {
    expect(initSlots([wt("a"), wt("b")])).toEqual(["a", "b", null]);
    expect(initSlots([wt("a"), wt("b"), wt("c"), wt("d")])).toEqual(["a", "b", "c"]);
  });
  it("initSlots skips completed worktrees", () => {
    expect(initSlots([wt("done", "completed"), wt("a")])).toEqual(["a", null, null]);
  });
  it("setSlotAt assigns and clears one slot", () => {
    expect(setSlotAt([null, null, null], 1, "x")).toEqual([null, "x", null]);
    expect(setSlotAt(["x", null, null], 0, null)).toEqual([null, null, null]);
  });
  it("assignNewWorktree fills the first empty slot", () => {
    expect(assignNewWorktree(["a", null, null], "b")).toEqual(["a", "b", null]);
    expect(assignNewWorktree([null, null, null], "a")).toEqual(["a", null, null]);
  });
  it("assignNewWorktree displaces the last slot when all are full", () => {
    expect(assignNewWorktree(["a", "b", "c"], "d")).toEqual(["a", "b", "d"]);
  });
  it("clearEntity removes a deleted id from every slot", () => {
    expect(clearEntity(["a", "b", "a"], "a")).toEqual([null, "b", null]);
  });
  it("clearEntity also clears scratch ids", () => {
    expect(clearEntity(["scratch-1", "b", null], "scratch-1")).toEqual([null, "b", null]);
  });
  it("resolveSlotEntity finds a worktree, then a scratch, else null", () => {
    const scratch: ScratchTerminal[] = [{ id: "scratch-1", title: "Scratch 1" }];
    expect(resolveSlotEntity(null, [wt("a")], scratch)).toBeNull();
    expect(resolveSlotEntity("a", [wt("a")], scratch)).toEqual({ kind: "worktree", worktree: wt("a") });
    expect(resolveSlotEntity("scratch-1", [wt("a")], scratch)).toEqual({ kind: "scratch", scratch: scratch[0] });
    expect(resolveSlotEntity("ghost", [wt("a")], scratch)).toBeNull();
  });
  it("SLOT_COUNT is 3", () => expect(SLOT_COUNT).toBe(3));
});
