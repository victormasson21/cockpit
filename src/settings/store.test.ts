// store.test.ts — regression: two settings writes in one tick must compose, not clobber (the worktree-create bug).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettings } from "./store";
import type { CockpitConfig, Worktree } from "./types";

// Mock the IPC layer so the debounced save never reaches Tauri in tests.
vi.mock("./api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

const baseCockpit: CockpitConfig = {
  version: 1,
  tiles: [{ id: "worktree-1", type: "worktree", config: {} }],
  worktrees: [],
  knownRepos: [],
  todos: [],
  preferences: { theme: "system", defaultView: "worktrees", panes: 3 },
};

const sampleWt: Worktree = {
  id: "wt-1", name: "n", repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status: "ongoing",
};

describe("settings store — writes compose without clobber", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true });
  });

  // Reproduces NewWorktreeForm.submit: add the model, then synchronously set the tile's config.
  // Before the fix, the second (snapshot-based) write clobbered the first, leaving worktrees: [].
  it("addWorktree then a functional tile-config write both persist", () => {
    const s = useSettings.getState();
    s.addWorktree(sampleWt);
    s.setCockpit((c) => ({
      ...c,
      tiles: c.tiles.map((t) => (t.id === "worktree-1" ? { ...t, config: { worktreeId: "wt-1" } } : t)),
    }));
    const after = useSettings.getState().cockpit;
    expect(after.worktrees).toHaveLength(1);
    expect(after.worktrees[0].id).toBe("wt-1");
    expect(after.tiles[0].config).toEqual({ worktreeId: "wt-1" });
  });
});

describe("knownRepos actions", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true });
  });

  it("addKnownRepo appends a { path } object", () => {
    useSettings.getState().addKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/a" }]);
  });
  it("addKnownRepo is idempotent by path", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().addKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/a" }]);
  });
  it("removeKnownRepo drops only the matching entry", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().addKnownRepo("/b");
    useSettings.getState().removeKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/b" }]);
  });
  it("setRepoHost sets the host on the matching entry", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().setRepoHost("/a", { startCmd: "pnpm start", address: "http://localhost:2000" });
    expect(useSettings.getState().cockpit.knownRepos[0].host).toEqual({
      startCmd: "pnpm start",
      address: "http://localhost:2000",
    });
  });
});

describe("worktree slots (session state)", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true, slots: [null, null, null], scratchTerminals: [], scratchSeq: 0 });
  });

  it("init seeds slots from the first 3 ongoing worktrees", () => {
    const w = (id: string, status: "ongoing" | "completed" = "ongoing"): Worktree => ({ ...sampleWt, id, status });
    useSettings.getState().init({
      cockpit: { ...baseCockpit, worktrees: [w("done", "completed"), w("a"), w("b"), w("c"), w("d")] },
      layout: { version: 1, views: {} },
    });
    expect(useSettings.getState().slots).toEqual(["a", "b", "c"]);
  });

  it("setSlot assigns one slot", () => {
    useSettings.getState().setSlot(1, "wt-1");
    expect(useSettings.getState().slots).toEqual([null, "wt-1", null]);
  });

  it("assignNewWorktreeSlot fills the first empty slot", () => {
    useSettings.setState({ slots: ["wt-1", null, null] });
    useSettings.getState().assignNewWorktreeSlot("wt-2");
    expect(useSettings.getState().slots).toEqual(["wt-1", "wt-2", null]);
  });

  it("removeWorktree clears it from its slot", () => {
    useSettings.setState({ cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt] }, slots: ["wt-1", null, null] });
    useSettings.getState().removeWorktree("wt-1");
    expect(useSettings.getState().slots).toEqual([null, null, null]);
    expect(useSettings.getState().cockpit.worktrees).toHaveLength(0);
  });

  it("addScratch creates a scratch entity and auto-displays it in a slot", () => {
    const id = useSettings.getState().addScratch();
    const st = useSettings.getState();
    expect(id).toBe("scratch-1");
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.slots[0]).toBe("scratch-1");
  });

  it("removeScratch drops the entity and clears its slot", () => {
    const id = useSettings.getState().addScratch();
    useSettings.getState().removeScratch(id);
    const st = useSettings.getState();
    expect(st.scratchTerminals).toEqual([]);
    expect(st.slots).toEqual([null, null, null]);
  });

  it("init seeds slotCount from preferences.panes", () => {
    useSettings.getState().init({
      cockpit: { ...baseCockpit, preferences: { ...baseCockpit.preferences, panes: 2 } },
      layout: { version: 1, views: {} },
    });
    expect(useSettings.getState().slotCount).toBe(2);
  });

  it("setSlotCount shrinks the visible count, drops the rightmost slot, and persists to preferences", () => {
    useSettings.setState({ slots: ["a", "b", "c"], slotCount: 3 });
    useSettings.getState().setSlotCount(2);
    const st = useSettings.getState();
    expect(st.slotCount).toBe(2);
    expect(st.slots).toEqual(["a", "b", null]);
    expect(st.cockpit.preferences.panes).toBe(2);
  });
});
