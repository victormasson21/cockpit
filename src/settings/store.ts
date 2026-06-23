// store.ts — single in-session source of truth for settings; flushes changes to disk (debounced).
import { create } from "zustand";
import type { CockpitConfig, HostConfig, LayoutConfig, Settings, Worktree } from "./types";
import { saveSettings } from "./api";
import { initSlots, setSlotAt, assignFirstEmpty, clearWorktree, type Slots } from "../views/slots";

interface SettingsState {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
  loaded: boolean;
  init: (s: Settings) => void;
  // Accepts a value or an updater fn; the fn form reads FRESH state at apply time so two
  // setCockpit calls in one tick compose instead of the second clobbering the first with a stale snapshot.
  setCockpit: (c: CockpitConfig | ((prev: CockpitConfig) => CockpitConfig)) => void;
  setView: (view: string, serialized: unknown) => void;
  addWorktree: (wt: Worktree) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  removeWorktree: (id: string) => void;
  addKnownRepo: (path: string) => void;
  removeKnownRepo: (path: string) => void;
  setRepoHost: (path: string, host: HostConfig) => void;
  slots: Slots;
  setSlot: (index: number, id: string | null) => void;
  assignNewWorktreeSlot: (id: string) => void;
}

// Debounce disk writes so drags/keystrokes don't thrash the filesystem.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => SettingsState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { cockpit, layout } = get();
    saveSettings({ cockpit, layout }).catch((e) => console.error("save failed", e));
  }, 500);
}

export const useSettings = create<SettingsState>((set, get) => ({
  cockpit: { version: 1, tiles: [], worktrees: [], knownRepos: [], preferences: { theme: "system", defaultView: "main" } },
  layout: { version: 1, views: {} },
  loaded: false,
  slots: [null, null, null],
  init: (s) => set({ cockpit: s.cockpit, layout: s.layout, loaded: true, slots: initSlots(s.cockpit.worktrees) }),
  setCockpit: (next) => {
    set((st) => ({ cockpit: typeof next === "function" ? next(st.cockpit) : next }));
    scheduleSave(get);
  },
  setView: (view, serialized) => {
    set((st) => ({ layout: { ...st.layout, views: { ...st.layout.views, [view]: serialized } } }));
    scheduleSave(get);
  },
  // Functional updaters: each reads the current cockpit at apply time, so they never clobber a
  // concurrent tile-config write (e.g. addWorktree immediately followed by updateConfig on create).
  addWorktree: (wt) => get().setCockpit((c) => ({ ...c, worktrees: [...c.worktrees, wt] })),
  updateWorktree: (id, patch) =>
    get().setCockpit((c) => ({
      ...c,
      worktrees: c.worktrees.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    })),
  removeWorktree: (id) => {
    get().setCockpit((c) => ({ ...c, worktrees: c.worktrees.filter((w) => w.id !== id) }));
    set((st) => ({ slots: clearWorktree(st.slots, id) }));
  },
  // Slots are session-only display state (not persisted): which worktree shows in each of the 3 columns.
  setSlot: (index, id) => set((st) => ({ slots: setSlotAt(st.slots, index, id) })),
  assignNewWorktreeSlot: (id) => set((st) => ({ slots: assignFirstEmpty(st.slots, id) })),
  // Known repos the deduce agent may pick from; each carries an optional saved host default. add dedupes by path.
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
}));
