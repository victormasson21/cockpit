// store.ts — single in-session source of truth for settings; flushes changes to disk (debounced).
import { create } from "zustand";
import type { CockpitConfig, HostConfig, LayoutConfig, PrReviewItem, Settings, Worktree } from "./types";
import { saveSettings } from "./api";
import { nextState, reorderWithinState } from "../tiles/todo/todo";
import { mergePrItems } from "../tiles/pr/merge";
import { initSlots, setSlotAt, assignNewWorktree, fillFreeSlot, clearEntity, swapSlotId, hideSlotsBeyond, SLOT_COUNT, type Slots, type ScratchTerminal, type PendingWorktree } from "../views/slots";
import { deduceWorktree, createWorktree } from "../worktrees/api";
import { makeWorktree, sourceLinkFrom, branchSpecFrom } from "../worktrees/model";
import { runHost, addExtra, removePane, togglePane, expandPane, EMPTY_PANE_SET, type WorktreePaneSet } from "../worktrees/paneSet";
import { tick } from "../tiles/timer/timer";
import { effectiveContext, type WorktreeSource } from "../worktrees/worktreeContext";

const TIMER_DEFAULT_MIN = 25;

type View = "cockpit" | "worktrees" | "calm";

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
  setPrChannel: (id: string | null) => void;
  applyPrFetch: (items: PrReviewItem[], newestTs?: string) => void;
  removePrItem: (id: string) => void;
  setWorktreeContext: (source: WorktreeSource, text: string) => void;
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
  placeNewEntity: (id: string, view: View) => void;
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  addScratch: () => string;
  removeScratch: (id: string) => void;
  renameScratch: (id: string, title: string) => void;
  // Session-only pending worktrees (spinner tiles) + the whole deduce→create background chain.
  pendingWorktrees: PendingWorktree[];
  pendingSeq: number;
  startDeduceWorktree: (prompt: string, view: View, source?: WorktreeSource) => void;
  // Last failed deduce/create (prompt + message); App watches it to reopen the modal prefilled.
  worktreeError: { prompt: string; message: string } | null;
  clearWorktreeError: () => void;
  // Session-only countdown timer (mm:ss), shared by the header + the Cockpit tile so it survives
  // view switches (the tile unmounts, the store doesn't). Not persisted; App drives the 1s tick.
  timerMinutes: number;
  timerRemaining: number; // seconds
  timerRunning: boolean;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  setTimerMinutes: (m: number) => void;
  tickTimer: () => void;
  // Session-only "needs attention" set, keyed by ptyId (presence = highlight). Not persisted.
  attention: Record<string, true>;
  markAttention: (ptyId: string) => void;
  clearAttention: (ptyId: string) => void;
  // Session-only "send the deduce prompt on the claude pane's first spawn" flags, keyed by worktree id. Not persisted.
  initialPromptPending: Record<string, true>;
  clearInitialPrompt: (id: string) => void;
  // Session-only dynamic pane set per worktree (claude + Run host + Add shells). Not persisted:
  // the Rust PTY registry dies with the app, so on restart every worktree is Claude-only again.
  worktreePanes: Record<string, WorktreePaneSet>;
  runHostPane: (id: string) => void;
  addShellPane: (id: string) => void;
  removeWorktreePane: (id: string, role: string) => void;
  toggleWorktreePane: (id: string, role: string) => void;
  expandWorktreePane: (id: string, role: string) => void;
  resetWorktreePanes: (id: string) => void;
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
  cockpit: { version: 1, tiles: [], worktrees: [], knownRepos: [], integrations: {}, todos: [], worktreeContexts: {}, preferences: { theme: "system", defaultView: "worktrees", panes: SLOT_COUNT } },
  layout: { version: 1, views: {} },
  loaded: false,
  slots: [null, null, null],
  slotCount: SLOT_COUNT,
  scratchTerminals: [],
  scratchSeq: 0,
  pendingWorktrees: [],
  pendingSeq: 0,
  worktreeError: null,
  timerMinutes: TIMER_DEFAULT_MIN,
  timerRemaining: TIMER_DEFAULT_MIN * 60,
  timerRunning: false,
  attention: {},
  initialPromptPending: {},
  worktreePanes: {},
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
    get().clearInitialPrompt(id); // sweep the one-shot flag if the pane never consumed it
    get().resetWorktreePanes(id); // the pane set is meaningless once the worktree is gone
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
  // View-dependent placement of a newly-created worktree/scratch/pending (see spec).
  placeNewEntity: (id: string, view: View) => {
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
  // Session-only: overwrite a scratch terminal's display title in place (scratch is never persisted).
  renameScratch: (id, title) =>
    set((st) => ({ scratchTerminals: st.scratchTerminals.map((s) => (s.id === id ? { ...s, title } : s)) })),
  clearWorktreeError: () => set({ worktreeError: null }),
  // startDeduceWorktree: place a spinning pending tile immediately, then run deduce→create in the
  // background (this action outlives the modal, so the fire-and-forget async survives modal close).
  // On success the pending id is swapped in place for the real `wt-*` id; on failure the tile is
  // discarded and worktreeError is set so App reopens the modal prefilled.
  startDeduceWorktree: (prompt, view, source = "manual") => {
    const n = get().pendingSeq + 1;
    const pendingId = `pending-${n}`;
    set((st) => ({
      pendingSeq: n,
      pendingWorktrees: [...st.pendingWorktrees, { id: pendingId, prompt, status: "deducing", view }],
    }));
    get().placeNewEntity(pendingId, view);

    // isLive: the user may repick/close the slot mid-flight; if the pending entity is gone, abandon quietly.
    const isLive = () => get().pendingWorktrees.some((p) => p.id === pendingId);

    void (async () => {
      try {
        const d = await deduceWorktree(prompt, get().cockpit.knownRepos.map((r) => r.path));
        if (!isLive()) return;
        set((st) => ({
          pendingWorktrees: st.pendingWorktrees.map((p) => (p.id === pendingId ? { ...p, status: "creating" } : p)),
        }));
        // A repo's saved host default wins over the agent's guess (matches the old runDeduce precedence).
        const saved = get().cockpit.knownRepos.find((r) => r.path === d.repoPath)?.host;
        const startCmd = saved?.startCmd ?? d.startCmd;
        const address = saved?.address ?? d.address;
        const spec = branchSpecFrom({ prNumber: d.prNumber ?? 0, mode: d.existingBranch ? "existing" : "new", branch: d.branch, base: d.base });
        const worktreePath = await createWorktree(d.repoPath, d.name, spec);
        if (!isLive()) return;
        const realId = `wt-${Date.now()}`;
        const sl = sourceLinkFrom(d);
        // Prepend the per-source context to the pane prompt (step 2 only); deduce used the bare prompt.
        const ctx = effectiveContext(source, get().cockpit.worktreeContexts);
        const panePrompt = ctx ? `${ctx}\n\n${prompt}` : prompt;
        get().addWorktree(makeWorktree({
          id: realId, name: d.name, repoPath: d.repoPath, branch: d.branch, worktreePath,
          host: { startCmd, address }, links: sl ? [sl] : [], prompt: panePrompt,
        }));
        // Swap in place across both slot surfaces, then drop the pending entity.
        // The initial-send flag arms the claude pane's one-shot prompt autostart (cleared on first ensure).
        set((st) => ({
          slots: swapSlotId(st.slots, pendingId, realId),
          pendingWorktrees: st.pendingWorktrees.filter((p) => p.id !== pendingId),
          initialPromptPending: { ...st.initialPromptPending, [realId]: true },
        }));
        get().setCockpit((c) => (c.cockpitWorktreeId === pendingId ? { ...c, cockpitWorktreeId: realId } : c));
      } catch (e) {
        // Discard the tile + clear its slot(s), and signal App to reopen the modal prefilled.
        set((st) => ({
          pendingWorktrees: st.pendingWorktrees.filter((p) => p.id !== pendingId),
          slots: clearEntity(st.slots, pendingId),
          worktreeError: { prompt, message: String(e) },
        }));
        get().setCockpit((c) => (c.cockpitWorktreeId === pendingId ? { ...c, cockpitWorktreeId: undefined } : c));
      }
    })();
  },
  // Countdown actions (session-only). App runs a 1s interval calling tickTimer while timerRunning.
  startTimer: () => set((st) => (st.timerRemaining > 0 ? { timerRunning: true } : st)),
  pauseTimer: () => set({ timerRunning: false }),
  resetTimer: () => set((st) => ({ timerRunning: false, timerRemaining: st.timerMinutes * 60 })),
  // Clamp to 1..180 min; resets the countdown to the new full duration (editable only while idle in the UI).
  setTimerMinutes: (m) => {
    const v = Math.max(1, Math.min(180, Math.floor(m) || 0));
    set({ timerMinutes: v, timerRemaining: v * 60 });
  },
  tickTimer: () =>
    set((st) => {
      if (!st.timerRunning) return st;
      const { remaining, running } = tick(st.timerRemaining);
      return { timerRemaining: remaining, timerRunning: running };
    }),
  // Attention highlight (session-only): a pane bells -> mark; user focuses/types in it -> clear.
  markAttention: (ptyId) => set((st) => ({ attention: { ...st.attention, [ptyId]: true } })),
  // No-op (same object) when absent, so clearing an unmarked pane never triggers a re-render.
  clearAttention: (ptyId) =>
    set((st) => {
      if (!st.attention[ptyId]) return st;
      const { [ptyId]: _, ...rest } = st.attention;
      return { attention: rest };
    }),
  // No-op (same object) when absent, so clearing an unflagged worktree never triggers a re-render.
  clearInitialPrompt: (id) =>
    set((st) => {
      if (!st.initialPromptPending[id]) return st;
      const { [id]: _, ...rest } = st.initialPromptPending;
      return { initialPromptPending: rest };
    }),
  // Pane-set actions: thin wrappers over the pure paneSet helpers, keyed by worktree id.
  runHostPane: (id) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: runHost(st.worktreePanes[id] ?? EMPTY_PANE_SET) } })),
  addShellPane: (id) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: addExtra(st.worktreePanes[id] ?? EMPTY_PANE_SET) } })),
  removeWorktreePane: (id, role) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: removePane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
  toggleWorktreePane: (id, role) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: togglePane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
  expandWorktreePane: (id, role) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: expandPane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
  // No-op (same object) when absent, so resetting an untouched worktree never re-renders.
  resetWorktreePanes: (id) =>
    set((st) => {
      if (!st.worktreePanes[id]) return st;
      const { [id]: _, ...rest } = st.worktreePanes;
      return { worktreePanes: rest };
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
  // PR Reviews tile: same functional-updater idiom, always preserving sibling integration fields.
  // Switching channels drops the cursor (it belongs to a channel) but keeps the curated items.
  setPrChannel: (id) =>
    get().setCockpit((c) => ({
      ...c,
      integrations: { ...c.integrations, prReviews: { channelId: id ?? undefined, items: c.integrations?.prReviews?.items ?? [] } },
    })),
  applyPrFetch: (items, newestTs) =>
    get().setCockpit((c) => {
      const pr = c.integrations?.prReviews ?? { items: [] };
      return {
        ...c,
        integrations: {
          ...c.integrations,
          prReviews: { ...pr, items: mergePrItems(pr.items, items), lastSeenTs: newestTs ?? pr.lastSeenTs },
        },
      };
    }),
  removePrItem: (id) =>
    get().setCockpit((c) => {
      const pr = c.integrations?.prReviews;
      if (!pr) return c;
      return { ...c, integrations: { ...c.integrations, prReviews: { ...pr, items: pr.items.filter((i) => i.id !== id) } } };
    }),
  setWorktreeContext: (source, text) =>
    get().setCockpit((c) => ({ ...c, worktreeContexts: { ...c.worktreeContexts, [source]: text } })),
}));
