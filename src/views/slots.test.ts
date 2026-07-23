// slots.test.ts — pure keyed-slot reducer behavior for the responsive Worktrees view.
import { describe, it, expect } from "vitest";
import {
  SLOT_COUNT, initSlots, addEmptySlot, setSlotId, removeSlot,
  placeEntity, fillEntity, clearEntity, swapSlotId, resolveSlotEntity,
  type Slots, type ScratchTerminal, type PendingWorktree,
} from "./slots";
import type { Worktree } from "../settings/types";

const wt = (id: string, status: Worktree["status"] = "ongoing"): Worktree => ({
  id, name: id, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status,
});

// Deterministic key minter for tests.
const minter = () => { let n = 0; return () => `k${++n}`; };
const ids = (s: Slots) => s.map((x) => x.id);

describe("slots", () => {
  it("initSlots takes the first 3 ongoing worktrees; zero → empty", () => {
    expect(ids(initSlots([wt("a"), wt("b")], minter()))).toEqual(["a", "b"]);
    expect(ids(initSlots([wt("a"), wt("b"), wt("c"), wt("d")], minter()))).toEqual(["a", "b", "c"]);
    expect(initSlots([], minter())).toEqual([]);
  });
  it("initSlots skips completed worktrees", () => {
    expect(ids(initSlots([wt("done", "completed"), wt("a")], minter()))).toEqual(["a"]);
  });
  it("initSlots mints a unique key per slot", () => {
    const s = initSlots([wt("a"), wt("b")], minter());
    expect(s.map((x) => x.key)).toEqual(["k1", "k2"]);
  });
  it("addEmptySlot appends an empty slot; no-op at the cap", () => {
    const mk = minter();
    const s1 = addEmptySlot([], mk);
    expect(s1).toEqual([{ key: "k1", id: null }]);
    const full: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(addEmptySlot(full, mk)).toBe(full); // referential no-op at cap 3
  });
  it("setSlotId assigns and clears one column by key", () => {
    const s: Slots = [{ key: "a", id: null }, { key: "b", id: "2" }];
    expect(setSlotId(s, "a", "9")).toEqual([{ key: "a", id: "9" }, { key: "b", id: "2" }]);
    expect(setSlotId(s, "b", null)).toEqual([{ key: "a", id: null }, { key: "b", id: null }]);
  });
  it("removeSlot splices a column, leaving other keys intact (reflow)", () => {
    const s: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(removeSlot(s, "b")).toEqual([{ key: "a", id: "1" }, { key: "c", id: "3" }]);
  });
  it("placeEntity fills the first empty slot", () => {
    const s: Slots = [{ key: "a", id: "1" }, { key: "b", id: null }];
    expect(placeEntity(s, "9", minter())).toEqual([{ key: "a", id: "1" }, { key: "b", id: "9" }]);
  });
  it("placeEntity appends a new column when there is room and no empty slot", () => {
    const mk = minter();
    expect(placeEntity([{ key: "a", id: "1" }], "9", mk)).toEqual([{ key: "a", id: "1" }, { key: "k1", id: "9" }]);
    expect(placeEntity([], "9", minter())).toEqual([{ key: "k1", id: "9" }]);
  });
  it("placeEntity replaces the rightmost column at the cap", () => {
    const s: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(placeEntity(s, "9", minter())).toEqual([{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "9" }]);
  });
  it("fillEntity fills an empty slot or appends when room, never evicts at the cap", () => {
    const cap: Slots = [{ key: "a", id: "1" }, { key: "b", id: "2" }, { key: "c", id: "3" }];
    expect(fillEntity(cap, "9", minter())).toBe(cap); // no eviction
    expect(fillEntity([{ key: "a", id: null }], "9", minter())).toEqual([{ key: "a", id: "9" }]);
    expect(fillEntity([{ key: "a", id: "1" }], "9", minter())).toEqual([{ key: "a", id: "1" }, { key: "k1", id: "9" }]);
  });
  it("clearEntity splices every column holding a removed id", () => {
    const s: Slots = [{ key: "a", id: "x" }, { key: "b", id: "y" }, { key: "c", id: "x" }];
    expect(clearEntity(s, "x")).toEqual([{ key: "b", id: "y" }]);
    expect(clearEntity([{ key: "a", id: "scratch-1" }], "scratch-1")).toEqual([]);
  });
  it("swapSlotId replaces the id in place and keeps the key; no-op when absent", () => {
    const s: Slots = [{ key: "a", id: "pending-1" }, { key: "b", id: "z" }];
    expect(swapSlotId(s, "pending-1", "wt-9")).toEqual([{ key: "a", id: "wt-9" }, { key: "b", id: "z" }]);
    expect(swapSlotId(s, "nope", "wt-9")).toEqual(s);
  });
  it("resolveSlotEntity finds worktree, then scratch, then pending, else null", () => {
    const scratch: ScratchTerminal[] = [{ id: "scratch-1", title: "Scratch 1" }];
    const pending: PendingWorktree[] = [{ id: "pending-1", prompt: "p", status: "deducing", view: "worktrees" }];
    expect(resolveSlotEntity(null, [wt("a")], scratch)).toBeNull();
    expect(resolveSlotEntity("a", [wt("a")], scratch)).toEqual({ kind: "worktree", worktree: wt("a") });
    expect(resolveSlotEntity("scratch-1", [wt("a")], scratch)).toEqual({ kind: "scratch", scratch: scratch[0] });
    expect(resolveSlotEntity("pending-1", [wt("a")], [], pending)).toEqual({ kind: "pending", pending: pending[0] });
    expect(resolveSlotEntity("ghost", [wt("a")], scratch)).toBeNull();
  });
  it("SLOT_COUNT is 3", () => { expect(SLOT_COUNT).toBe(3); });
});
