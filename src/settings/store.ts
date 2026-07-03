// store.ts — single in-session source of truth for settings; flushes changes to disk (debounced).
import { create } from "zustand";
import type { CockpitConfig, HostConfig, LayoutConfig, Settings, Worktree } from "./types";
import { saveSettings } from "./api";
import { nextState, reorderWithinState } from "../tiles/todo/todo";
import { initSlots, setSlotAt, assignNewWorktree, fillFreeSlot, clearEntity, hideSlotsBeyond, SLOT_COUNT, type Slots, type ScratchTerminal } from "../views/slots";

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
  addTodo: (text: string) => void;
  cycleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  editTodo: (id: string, text: string) => void;
  reorderTodo: (draggedId: string, targetId: string) => void;
  addKnownRepo: (path: string) => void;
  removeKnownRepo: (path: string) => void;
  setRepoHost: (path: string, host: HostConfig) => void;
  setSlackClientId: (clientId: string) => void;
  setSlackWatched: (ids: string[]) => void;
  // Text zoom (Cmd +/-/0): a multiplier applied to every font-size token; persisted in preferences.
  fontScale: number;
  setFontScale: (n: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  slots: Slots;
  slotCount: number; // visible columns (MIN_SLOTS..SLOT_COUNT), session-only
  setSlotCount: (n: number) => void;
  setSlot: (index: number, id: string | null) => void;
  setCockpitWorktree: (id: string | null) => void;
  placeNewEntity: (id: string, view: "cockpit" | "worktrees" | "calm") => void;
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  addScratch: () => string;
  removeScratch: (id: string) => void;
  // Session-only "needs attention" set, keyed by ptyId (presence = highlight). Not persisted.
  attention: Record<string, true>;
  markAttention: (ptyId: string) => void;
  clearAttention: (ptyId: string) => void;
}

// Text-zoom bounds: clamp to a readable range and quantise to the 0.1 step so repeated +/- stay on grid.
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export function clampZoom(n: number): number {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
  return Math.round(clamped * 10) / 10; // avoid float drift (e.g. 1.0000000002) across many steps
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
  attention: {},
  fontScale: 1,
  init: (s) => set({ cockpit: s.cockpit, layout: s.layout, loaded: true, slots: initSlots(s.cockpit.worktrees), slotCount: s.cockpit.preferences.panes ?? SLOT_COUNT, fontScale: clampZoom(s.cockpit.preferences.fontScale ?? 1) }),
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
    get().setCockpit((c) => ({
      ...c,
      worktrees: c.worktrees.filter((w) => w.id !== id),
      cockpitWorktreeId: c.cockpitWorktreeId === id ? undefined : c.cockpitWorktreeId,
    }));
    set((st) => ({ slots: clearEntity(st.slots, id) }));
  },
  // To-do items persist in cockpit.json; ids are random so they survive restarts without a counter.
  addTodo: (text) =>
    get().setCockpit((c) => ({ ...c, todos: [...c.todos, { id: crypto.randomUUID(), text, state: "todo" }] })),
  cycleTodo: (id) =>
    get().setCockpit((c) => ({ ...c, todos: c.todos.map((t) => (t.id === id ? { ...t, state: nextState(t.state) } : t)) })),
  removeTodo: (id) =>
    get().setCockpit((c) => ({ ...c, todos: c.todos.filter((t) => t.id !== id) })),
  // Save edited text; empty/whitespace text deletes the item (treated as "cleared it").
  editTodo: (id, text) =>
    get().setCockpit((c) => {
      const trimmed = text.trim();
      return trimmed
        ? { ...c, todos: c.todos.map((t) => (t.id === id ? { ...t, text: trimmed } : t)) }
        : { ...c, todos: c.todos.filter((t) => t.id !== id) };
    }),
  // Reorder within a section via the pure helper (cross-section drops are no-ops).
  reorderTodo: (draggedId, targetId) =>
    get().setCockpit((c) => ({ ...c, todos: reorderWithinState(c.todos, draggedId, targetId) })),
  // Slots are session-only display state (not persisted): which worktree shows in each of the 3 columns.
  setSlot: (index, id) => set((st) => ({ slots: setSlotAt(st.slots, index, id) })),
  // Toggle visible column count; shrinking drops the rightmost panes (entities keep running, slots cleared).
  // Persist the choice into preferences so it survives restarts.
  setSlotCount: (n) => {
    set((st) => ({ slotCount: n, slots: hideSlotsBeyond(st.slots, n) }));
    get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, panes: n } }));
  },
  // Text zoom: set the (clamped) multiplier as session state AND persist it into preferences — same
  // idiom as setSlotCount. App applies it to <html> as --font-scale; useTerminal reads it for xterm.
  setFontScale: (n) => {
    const fontScale = clampZoom(n);
    set({ fontScale });
    get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, fontScale } }));
  },
  zoomIn: () => get().setFontScale(get().fontScale + ZOOM_STEP),
  zoomOut: () => get().setFontScale(get().fontScale - ZOOM_STEP),
  resetZoom: () => get().setFontScale(1),
  // Persisted Cockpit-view right-column slot (omit from JSON when cleared).
  setCockpitWorktree: (id) => get().setCockpit((c) => ({ ...c, cockpitWorktreeId: id ?? undefined })),
  // View-dependent placement of a newly-created worktree/scratch (see spec).
  placeNewEntity: (id, view) => {
    if (view === "cockpit") {
      get().setCockpit((c) => ({ ...c, cockpitWorktreeId: id }));
      set((st) => ({ slots: fillFreeSlot(st.slots, id, st.slotCount) }));
    } else {
      set((st) => ({ slots: assignNewWorktree(st.slots, id, st.slotCount) }));
    }
  },
  // Scratch terminals are session-only single-shell entities; a monotonic seq keeps ids/titles unique.
  // Creation only — placement into a slot is placeNewEntity's job (view-dependent).
  addScratch: () => {
    const n = get().scratchSeq + 1;
    const id = `scratch-${n}`;
    set((st) => ({ scratchSeq: n, scratchTerminals: [...st.scratchTerminals, { id, title: `Scratch ${n}` }] }));
    return id;
  },
  removeScratch: (id) => {
    get().setCockpit((c) => ({ ...c, cockpitWorktreeId: c.cockpitWorktreeId === id ? undefined : c.cockpitWorktreeId }));
    set((st) => ({ scratchTerminals: st.scratchTerminals.filter((s) => s.id !== id), slots: clearEntity(st.slots, id) }));
  },
  // Attention highlight (session-only): a pane bells -> mark; user focuses/types in it -> clear.
  markAttention: (ptyId) => set((st) => ({ attention: { ...st.attention, [ptyId]: true } })),
  // No-op (same object) when absent, so clearing an unmarked pane never triggers a re-render.
  clearAttention: (ptyId) =>
    set((st) => {
      if (!st.attention[ptyId]) return st;
      const { [ptyId]: _, ...rest } = st.attention;
      return { attention: rest };
    }),
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
