// store.test.ts — regression: two settings writes in one tick must compose, not clobber (the worktree-create bug).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettings } from "./store";
import type { CockpitConfig, Worktree } from "./types";
import type { Slots } from "../views/slots";

// Mock the IPC layer so the debounced save never reaches Tauri in tests.
vi.mock("./api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

const baseCockpit: CockpitConfig = {
  version: 1,
  tiles: [{ id: "worktree-1", type: "worktree", config: {} }],
  worktrees: [],
  knownRepos: [],
  preferences: { theme: "system", defaultView: "main" },
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
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true, slots: [null, null, null] });
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
});
