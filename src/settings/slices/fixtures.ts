// fixtures.ts — shared test fixtures for the slice test files. Not imported by app code, so it never
// reaches the bundle. Each test file still declares its own vi.mock calls (those are hoisted per file).
import { useSettings } from "../store";
import type { SettingsState } from "../storeState";
import type { CockpitConfig, Worktree } from "../types";

export const baseCockpit: CockpitConfig = {
  version: 1,
  tiles: [{ id: "worktree-1", type: "worktree", config: {} }],
  worktrees: [],
  knownRepos: [],
  todos: [],
  todoLists: [],
  preferences: { theme: "system", defaultView: "worktrees" },
};

export const baseLayout = { version: 1, views: {} };

export const sampleWt: Worktree = {
  id: "wt-1", name: "n", repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status: "ongoing",
};

// slotIds: compare a keyed Slots array by its ids, ignoring the (opaque) per-column keys.
export const slotIds = () => useSettings.getState().slots.map((s) => s.id);

// The store is module-global across a file's tests, and most actions only write the keys they own —
// so every describe resets the slices it touches or an earlier test leaks into the next.
export function resetStore(patch: Partial<SettingsState> = {}) {
  useSettings.setState({
    cockpit: structuredClone(baseCockpit),
    layout: { ...baseLayout },
    loaded: true,
    slots: [], slotSeq: 0,
    scratchTerminals: [], scratchSeq: 0,
    pendingWorktrees: [], pendingSeq: 0,
    worktreeError: null,
    attention: {}, initialPromptPending: {}, restoredWorktrees: {},
    worktreePanes: {},
    fontScale: 1,
  });
  if (Object.keys(patch).length) useSettings.setState(patch);
}
