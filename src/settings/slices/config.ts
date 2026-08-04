// config.ts — the persisted cockpit.json config itself: the raw blocks, the one setCockpit writer every
// other slice funnels through, the worktree model list, known repos, and the per-source deduce contexts.
import type { CockpitConfig, HostConfig, LayoutConfig, Worktree } from "../types";
import type { SettingsSlice, View } from "../storeState";
import type { WorktreeSource } from "../../worktrees/worktreeContext";
import { clearEntity } from "../../views/slots";
import { makeSetSession, scheduleSave } from "./persist";

export interface ConfigSlice {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
  loaded: boolean;
  // Accepts a value or an updater fn; the fn form reads FRESH state at apply time so two setCockpit
  // calls in one tick compose instead of the second clobbering the first with a stale snapshot.
  setCockpit: (c: CockpitConfig | ((prev: CockpitConfig) => CockpitConfig)) => void;
  addWorktree: (wt: Worktree) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  removeWorktree: (id: string) => void;
  addKnownRepo: (path: string) => void;
  removeKnownRepo: (path: string) => void;
  setRepoHost: (path: string, host: HostConfig) => void;
  setWorktreeContext: (source: WorktreeSource, text: string) => void;
  setDefaultView: (v: View) => void;
  setBackground: (id: string) => void;
}

export const EMPTY_CONFIG: CockpitConfig = {
  version: 1, tiles: [], worktrees: [], knownRepos: [], integrations: {},
  todos: [], todoLists: [], worktreeContexts: {},
  preferences: { theme: "system", defaultView: "worktrees" },
};

export const createConfigSlice: SettingsSlice<ConfigSlice> = (set, get) => {
  const setSession = makeSetSession(set, get);
  return {
    cockpit: EMPTY_CONFIG,
    layout: { version: 1, views: {} },
    loaded: false,
    setCockpit: (next) => {
      set((st) => ({ cockpit: typeof next === "function" ? next(st.cockpit) : next }));
      scheduleSave(get);
    },
    // Functional updaters: each reads the current cockpit at apply time, so they never clobber a
    // concurrent config write (e.g. addWorktree immediately followed by a tile-config write on create).
    addWorktree: (wt) => get().setCockpit((c) => ({ ...c, worktrees: [...c.worktrees, wt] })),
    updateWorktree: (id, patch) =>
      get().setCockpit((c) => ({
        ...c,
        worktrees: c.worktrees.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      })),
    // Cross-slice on purpose: dropping the model must also detach everything keyed by its id.
    removeWorktree: (id) => {
      get().setCockpit((c) => ({
        ...c,
        worktrees: c.worktrees.filter((w) => w.id !== id),
        cockpitWorktreeId: c.cockpitWorktreeId === id ? undefined : c.cockpitWorktreeId,
      }));
      setSession((st) => ({ slots: clearEntity(st.slots, id) }));
      get().clearInitialPrompt(id); // sweep the one-shot flag if the pane never consumed it
      get().clearRestored(id); // the worktree is gone; nothing to resume
      get().resetWorktreePanes(id); // the pane set is meaningless once the worktree is gone
    },
    // Known repos the deduce agent may pick from; each carries an optional saved host default.
    addKnownRepo: (path) =>
      get().setCockpit((c) =>
        c.knownRepos.some((r) => r.path === path) ? c : { ...c, knownRepos: [...c.knownRepos, { path }] },
      ),
    removeKnownRepo: (path) =>
      get().setCockpit((c) => ({ ...c, knownRepos: c.knownRepos.filter((r) => r.path !== path) })),
    setRepoHost: (path, host) =>
      get().setCockpit((c) => ({
        ...c,
        knownRepos: c.knownRepos.map((r) => (r.path === path ? { ...r, host } : r)),
      })),
    setWorktreeContext: (source, text) =>
      get().setCockpit((c) => ({ ...c, worktreeContexts: { ...c.worktreeContexts, [source]: text } })),
    // The view you switch to becomes the view you launch into (defaultView has no other writer).
    setDefaultView: (v) => get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, defaultView: v } })),
    setBackground: (id) => get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, background: id } })),
  };
};
