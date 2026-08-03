// config.test.ts — the config slice: the compose-not-clobber contract of setCockpit, worktree model
// CRUD (including the cross-slice detach on remove), known repos, and the launch-view preference.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC layer so the debounced save never reaches Tauri in tests.
vi.mock("../api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

import { useSettings } from "../store";
import { baseCockpit, resetStore, sampleWt, slotIds } from "./fixtures";

describe("setCockpit — writes compose without clobber", () => {
  beforeEach(() => resetStore());

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

  it("updateWorktree patches only the matching model", () => {
    useSettings.getState().addWorktree(sampleWt);
    useSettings.getState().addWorktree({ ...sampleWt, id: "wt-2", name: "other" });
    useSettings.getState().updateWorktree("wt-1", { name: "renamed" });
    const wts = useSettings.getState().cockpit.worktrees;
    expect(wts.map((w) => w.name)).toEqual(["renamed", "other"]);
  });
});

// removeWorktree is deliberately cross-slice: dropping the model must detach everything keyed by its id.
describe("removeWorktree detaches everything keyed to the worktree", () => {
  beforeEach(() => resetStore());

  it("splices it out of its slot (reflow) and drops the model", () => {
    resetStore({ cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt] }, slots: [{ key: "k1", id: "wt-1" }] });
    useSettings.getState().removeWorktree("wt-1");
    expect(slotIds()).toEqual([]);
    expect(useSettings.getState().cockpit.worktrees).toHaveLength(0);
  });

  it("clears it from the cockpit pin too", () => {
    resetStore({
      cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt], cockpitWorktreeId: "wt-1" },
      slots: [{ key: "k1", id: "wt-1" }],
    });
    useSettings.getState().removeWorktree("wt-1");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("sweeps the session flags and the pane set", () => {
    resetStore({
      cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt] },
      initialPromptPending: { "wt-1": true },
      restoredWorktrees: { "wt-1": true },
      worktreePanes: { "wt-1": { host: true, extras: [], seq: 0, open: {} } },
    });
    useSettings.getState().removeWorktree("wt-1");
    const st = useSettings.getState();
    expect(st.initialPromptPending).toEqual({});
    expect(st.restoredWorktrees).toEqual({});
    expect(st.worktreePanes).toEqual({});
  });
});

describe("knownRepos actions", () => {
  beforeEach(() => resetStore());

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

describe("worktree contexts and the launch view", () => {
  beforeEach(() => resetStore());

  it("setWorktreeContext stores per-source text, preserving siblings", () => {
    useSettings.getState().setWorktreeContext("todo", "plan it");
    useSettings.getState().setWorktreeContext("pr-review", "review it");
    expect(useSettings.getState().cockpit.worktreeContexts).toEqual({ todo: "plan it", "pr-review": "review it" });
  });

  it("setDefaultView persists the active view as the launch view", () => {
    useSettings.getState().setDefaultView("cockpit");
    expect(useSettings.getState().cockpit.preferences.defaultView).toBe("cockpit");
  });
});
