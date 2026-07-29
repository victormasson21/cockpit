// workspace.test.ts — pure snapshot/restore of the persisted session-restore block.
import { describe, it, expect } from "vitest";
import { workspaceSnapshot, withWorkspace, restoreWorkspace } from "./workspace";
import type { CockpitConfig, WorkspaceState, Worktree } from "./types";
import { EMPTY_PANE_SET } from "../worktrees/paneSet";

const wt = (id: string): Worktree => ({
  id, name: id, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status: "ongoing",
});
const minter = () => { let n = 0; return () => `k${++n}`; };
const paneSet = { host: true, extras: ["shell-1"], seq: 1, open: { claude: true, host: true, "shell-1": false } };
const baseCockpit: CockpitConfig = {
  version: 1, tiles: [], worktrees: [], knownRepos: [], todos: [],
  preferences: { theme: "system", defaultView: "worktrees" },
};

describe("workspaceSnapshot", () => {
  it("keeps slot ids in column order (empty columns included) and drops the keys", () => {
    const snap = workspaceSnapshot({
      slots: [{ key: "k1", id: "wt-1" }, { key: "k2", id: null }, { key: "k3", id: "scratch-1" }],
      scratchTerminals: [{ id: "scratch-1", title: "Scratch 1" }],
      scratchSeq: 1,
      worktreePanes: { "wt-1": paneSet },
    });
    expect(snap).toEqual({
      slots: ["wt-1", null, "scratch-1"],
      scratch: [{ id: "scratch-1", title: "Scratch 1" }],
      scratchSeq: 1,
      panes: { "wt-1": paneSet },
    });
  });
});

describe("withWorkspace", () => {
  it("injects the block without touching other config fields or mutating the input", () => {
    const session = { slots: [{ key: "k1", id: "wt-1" }], scratchTerminals: [], scratchSeq: 0, worktreePanes: {} };
    const out = withWorkspace(baseCockpit, session);
    expect(out.workspace).toEqual({ slots: ["wt-1"], scratch: [], scratchSeq: 0, panes: {} });
    expect(out.version).toBe(1);
    expect(baseCockpit.workspace).toBeUndefined();
  });
});

describe("restoreWorkspace", () => {
  const ws: WorkspaceState = {
    slots: ["wt-1", null, "scratch-1"],
    scratch: [{ id: "scratch-1", title: "Scratch 1" }],
    scratchSeq: 1,
    panes: { "wt-1": paneSet },
  };

  it("restores ids in column order with freshly minted keys", () => {
    const r = restoreWorkspace(ws, [wt("wt-1")], minter());
    expect(r.slots).toEqual([{ key: "k1", id: "wt-1" }, { key: "k2", id: null }, { key: "k3", id: "scratch-1" }]);
    expect(r.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
  });

  it("turns an id that no longer resolves into an empty column, keeping the column", () => {
    const r = restoreWorkspace({ ...ws, slots: ["wt-gone", "wt-1"] }, [wt("wt-1")], minter());
    expect(r.slots.map((s) => s.id)).toEqual([null, "wt-1"]);
  });

  it("restores an all-columns-closed arrangement faithfully", () => {
    const r = restoreWorkspace({ slots: [], scratch: [], scratchSeq: 0, panes: {} }, [wt("wt-1")], minter());
    expect(r.slots).toEqual([]);
  });

  it("caps the restored columns at SLOT_COUNT", () => {
    const r = restoreWorkspace({ ...ws, slots: ["wt-1", "wt-1", "wt-1", "wt-1"] }, [wt("wt-1")], minter());
    expect(r.slots).toHaveLength(3);
  });

  it("lifts scratchSeq above the highest restored scratch id so ids cannot collide", () => {
    const r = restoreWorkspace(
      { ...ws, slots: [], scratch: [{ id: "scratch-7", title: "Scratch 7" }], scratchSeq: 1 },
      [], minter(),
    );
    expect(r.scratchSeq).toBe(7);
  });

  it("prunes pane sets whose worktree is gone", () => {
    const r = restoreWorkspace({ ...ws, panes: { "wt-1": paneSet, "wt-gone": EMPTY_PANE_SET } }, [wt("wt-1")], minter());
    expect(Object.keys(r.worktreePanes)).toEqual(["wt-1"]);
  });

  it("marks every restored worktree — slot ids, pane keys and the cockpit pin", () => {
    const r = restoreWorkspace(
      { ...ws, slots: ["wt-1"], panes: { "wt-2": paneSet } },
      [wt("wt-1"), wt("wt-2"), wt("wt-3")], minter(), "wt-3",
    );
    expect(r.restoredWorktrees).toEqual({ "wt-1": true, "wt-2": true, "wt-3": true });
  });

  it("never marks a scratch id (only worktrees have a claude pane)", () => {
    const r = restoreWorkspace(ws, [wt("wt-1")], minter());
    expect(r.restoredWorktrees).toEqual({ "wt-1": true });
  });
});
