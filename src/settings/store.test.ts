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
