// slots.test.ts — pure slot-reducer behavior for the 3-column Worktrees view.
import { describe, it, expect } from "vitest";
import { SLOT_COUNT, MIN_SLOTS, initSlots, setSlotAt, assignNewWorktree, fillFreeSlot, clearEntity, swapSlotId, hideSlotsBeyond, resolveSlotEntity, type ScratchTerminal, type PendingWorktree } from "./slots";
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
  it("resolveSlotEntity finds a worktree, then a scratch, else null (3-arg call still compiles)", () => {
    const scratch: ScratchTerminal[] = [{ id: "scratch-1", title: "Scratch 1" }];
    expect(resolveSlotEntity(null, [wt("a")], scratch)).toBeNull();
    expect(resolveSlotEntity("a", [wt("a")], scratch)).toEqual({ kind: "worktree", worktree: wt("a") });
    expect(resolveSlotEntity("scratch-1", [wt("a")], scratch)).toEqual({ kind: "scratch", scratch: scratch[0] });
    expect(resolveSlotEntity("ghost", [wt("a")], scratch)).toBeNull();
  });
  it("resolveSlotEntity finds a pending worktree (after worktree + scratch)", () => {
    const pending: PendingWorktree[] = [{ id: "pending-1", prompt: "fix login", status: "deducing", view: "worktrees" }];
    expect(resolveSlotEntity("pending-1", [wt("a")], [], pending)).toEqual({ kind: "pending", pending: pending[0] });
    // worktree/scratch still win over a same-listed pending (ids never actually collide)
    expect(resolveSlotEntity("a", [wt("a")], [], pending)).toEqual({ kind: "worktree", worktree: wt("a") });
  });
  it("swapSlotId replaces every occurrence, leaves non-matches, and no-ops when absent", () => {
    expect(swapSlotId(["pending-1", "b", "pending-1"], "pending-1", "wt-9")).toEqual(["wt-9", "b", "wt-9"]);
    expect(swapSlotId(["a", "b", "c"], "pending-1", "wt-9")).toEqual(["a", "b", "c"]);
  });
  it("hideSlotsBeyond clears slots past the visible count (re-expand shows empty panes)", () => {
    expect(hideSlotsBeyond(["a", "b", "c"], 2)).toEqual(["a", "b", null]);
    expect(hideSlotsBeyond(["a", "b", "c"], 3)).toEqual(["a", "b", "c"]);
  });
  it("assignNewWorktree evicts the last VISIBLE slot when full", () => {
    // visibleCount 2 → only slots 0,1 are visible; full visible range evicts index 1
    expect(assignNewWorktree(["a", "b", null], "d", 2)).toEqual(["a", "d", null]);
    // visibleCount 3 (default) keeps the old behavior
    expect(assignNewWorktree(["a", "b", "c"], "d", 3)).toEqual(["a", "b", "d"]);
    expect(assignNewWorktree(["a", "b", "c"], "d")).toEqual(["a", "b", "d"]);
  });
  it("fillFreeSlot fills the first empty slot in range, else leaves slots unchanged", () => {
    expect(fillFreeSlot(["a", null, null], "b", 3)).toEqual(["a", "b", null]);
    expect(fillFreeSlot(["a", "b", "c"], "d", 3)).toEqual(["a", "b", "c"]); // full → unchanged
    expect(fillFreeSlot(["a", "b", null], "d", 2)).toEqual(["a", "b", null]); // slot 2 not visible → unchanged
  });
  it("SLOT_COUNT is 3 and MIN_SLOTS is 2", () => {
    expect(SLOT_COUNT).toBe(3);
    expect(MIN_SLOTS).toBe(2);
  });
});
