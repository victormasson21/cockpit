// store.ts — single in-session source of truth for settings; flushes changes to disk (debounced).
import { create } from "zustand";
import type { CockpitConfig, HostConfig, LayoutConfig, Settings, Worktree } from "./types";
import { saveSettings } from "./api";
import { initSlots, setSlotAt, assignNewWorktree, clearEntity, hideSlotsBeyond, SLOT_COUNT, type Slots, type ScratchTerminal } from "../views/slots";

interface SettingsState {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
  loaded: boolean;
  init: (s: Settings) => void;
  // Accepts a value or an updater fn; the fn form reads FRESH state at apply time so two
  // setCockpit calls in one tick compose instead of the second clobbering the first with a stale snapshot.
  setCockpit: (c: CockpitConfig | ((prev: CockpitConfig) => CockpitConfig)) => void;
  addWorktree: (wt: Worktree) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  removeWorktree: (id: string) => void;
  addKnownRepo: (path: string) => void;
  removeKnownRepo: (path: string) => void;
  setRepoHost: (path: string, host: HostConfig) => void;
  setSlackClientId: (clientId: string) => void;
  setSlackWatched: (ids: string[]) => void;
  slots: Slots;
  slotCount: number; // visible columns (MIN_SLOTS..SLOT_COUNT), session-only
  setSlotCount: (n: number) => void;
  setSlot: (index: number, id: string | null) => void;
  assignNewWorktreeSlot: (id: string) => void;
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  addScratch: () => string;
  removeScratch: (id: string) => void;
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
  cockpit: { version: 1, tiles: [], worktrees: [], knownRepos: [], integrations: {}, todos: [], preferences: { theme: "system", defaultView: "worktrees", panes: SLOT_COUNT } },
  layout: { version: 1, views: {} },
  loaded: false,
  slots: [null, null, null],
  slotCount: SLOT_COUNT,
  scratchTerminals: [],
  scratchSeq: 0,
  init: (s) => set({ cockpit: s.cockpit, layout: s.layout, loaded: true, slots: initSlots(s.cockpit.worktrees), slotCount: s.cockpit.preferences.panes ?? SLOT_COUNT }),
  setCockpit: (next) => {
    set((st) => ({ cockpit: typeof next === "function" ? next(st.cockpit) : next }));
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
    set((st) => ({ slots: clearEntity(st.slots, id) }));
  },
  // Slots are session-only display state (not persisted): which worktree shows in each of the 3 columns.
  setSlot: (index, id) => set((st) => ({ slots: setSlotAt(st.slots, index, id) })),
  // Toggle visible column count; shrinking drops the rightmost panes (entities keep running, slots cleared).
  // Persist the choice into preferences so it survives restarts.
  setSlotCount: (n) => {
    set((st) => ({ slotCount: n, slots: hideSlotsBeyond(st.slots, n) }));
    get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, panes: n } }));
  },
  assignNewWorktreeSlot: (id) => set((st) => ({ slots: assignNewWorktree(st.slots, id) })),
  // Scratch terminals are session-only single-shell entities; a monotonic seq keeps ids/titles unique across removals.
  addScratch: () => {
    const n = get().scratchSeq + 1;
    const id = `scratch-${n}`;
    set((st) => ({
      scratchSeq: n,
      scratchTerminals: [...st.scratchTerminals, { id, title: `Scratch ${n}` }],
      slots: assignNewWorktree(st.slots, id),
    }));
    return id;
  },
  removeScratch: (id) =>
    set((st) => ({
      scratchTerminals: st.scratchTerminals.filter((s) => s.id !== id),
      slots: clearEntity(st.slots, id),
    })),
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
  // Functional updaters for Slack integration config: preserve both clientId + watchedChannelIds on each write.
  setSlackClientId: (clientId) =>
    get().setCockpit((c) => ({ ...c, integrations: { ...c.integrations, slack: { ...c.integrations?.slack, watchedChannelIds: c.integrations?.slack?.watchedChannelIds ?? [], clientId } } })),
  setSlackWatched: (ids) =>
    get().setCockpit((c) => ({ ...c, integrations: { ...c.integrations, slack: { ...c.integrations?.slack, clientId: c.integrations?.slack?.clientId, watchedChannelIds: ids } } })),
}));
