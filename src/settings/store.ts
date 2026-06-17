// store.ts — single in-session source of truth for settings; flushes changes to disk (debounced).
import { create } from "zustand";
import type { CockpitConfig, LayoutConfig, Settings, Worktree } from "./types";
import { saveSettings } from "./api";

interface SettingsState {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
  loaded: boolean;
  init: (s: Settings) => void;
  setCockpit: (c: CockpitConfig) => void;
  setView: (view: string, serialized: unknown) => void;
  addWorktree: (wt: Worktree) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  removeWorktree: (id: string) => void;
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
  cockpit: { version: 1, tiles: [], worktrees: [], preferences: { theme: "system", defaultView: "main" } },
  layout: { version: 1, views: {} },
  loaded: false,
  init: (s) => set({ cockpit: s.cockpit, layout: s.layout, loaded: true }),
  setCockpit: (cockpit) => { set({ cockpit }); scheduleSave(get); },
  setView: (view, serialized) => {
    set((st) => ({ layout: { ...st.layout, views: { ...st.layout.views, [view]: serialized } } }));
    scheduleSave(get);
  },
  addWorktree: (wt) => {
    const { cockpit, setCockpit } = get();
    setCockpit({ ...cockpit, worktrees: [...cockpit.worktrees, wt] });
  },
  updateWorktree: (id, patch) => {
    const { cockpit, setCockpit } = get();
    setCockpit({
      ...cockpit,
      worktrees: cockpit.worktrees.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    });
  },
  removeWorktree: (id) => {
    const { cockpit, setCockpit } = get();
    setCockpit({ ...cockpit, worktrees: cockpit.worktrees.filter((w) => w.id !== id) });
  },
}));
