// workspace.ts — the on-screen arrangement and everything keyed to it: which entity each responsive
// column shows, scratch terminals, pending (spinning) worktrees, per-worktree pane sets, and the
// session-only flag maps the terminal panes read. Persisted via the `workspace` block, except the flags.
import {
  addEmptySlot as addEmptySlotFn, clearEntity, fillEntity, placeEntity, removeSlot as removeSlotFn,
  setSlotId, swapSlotId, swapSlots as swapSlotsFn,
  type PendingWorktree, type ScratchTerminal, type Slots,
} from "../../views/slots";
import { createWorktree, deduceWorktree } from "../../worktrees/api";
import { startDeduceFlow, type DeduceFlowSession } from "../../worktrees/deduceFlow";
import { addExtra, EMPTY_PANE_SET, expandPane, removePane, runHost, togglePane, type WorktreePaneSet } from "../../worktrees/paneSet";
import type { WorktreeSource } from "../../worktrees/worktreeContext";
import type { SettingsSlice, View } from "../storeState";
import { makeSetSession } from "./persist";

export interface WorkspaceSlice {
  slots: Slots;
  slotSeq: number; // monotonic; mints stable per-column keys (session-only)
  addEmptySlot: () => void;
  setSlot: (key: string, id: string | null) => void;
  removeSlot: (key: string) => void;
  swapSlots: (keyA: string, keyB: string) => void;
  setCockpitWorktree: (id: string | null) => void;
  placeNewEntity: (id: string, view: View) => void;
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  addScratch: () => string;
  removeScratch: (id: string) => void;
  renameScratch: (id: string, title: string) => void;
  // Session-only pending worktrees (spinner tiles). The deduce→create chain itself lives in
  // worktrees/deduceFlow.ts; startDeduceWorktree just starts it with this slice as its session port.
  pendingWorktrees: PendingWorktree[];
  pendingSeq: number;
  startDeduceWorktree: (prompt: string, view: View, source?: WorktreeSource) => void;
  // Last failed deduce/create (prompt + message); App watches it to reopen the modal prefilled.
  worktreeError: { prompt: string; message: string } | null;
  clearWorktreeError: () => void;
  // Session-only "needs attention" set, keyed by ptyId (presence = highlight). Not persisted.
  attention: Record<string, true>;
  markAttention: (ptyId: string) => void;
  clearAttention: (ptyId: string) => void;
  // Session-only "send the deduce prompt on the claude pane's first spawn" flags, by worktree id.
  initialPromptPending: Record<string, true>;
  clearInitialPrompt: (id: string) => void;
  // Session-only "this worktree came back from the previous session" flags, by worktree id. Read by the
  // claude pane to resume the conversation; cleared on its first spawn. Not persisted.
  restoredWorktrees: Record<string, true>;
  clearRestored: (id: string) => void;
  // Dynamic pane set per worktree (claude + Run host + Add shells), restored from the persisted
  // workspace block on launch. The Rust PTY registry still dies with the app, so a restored pane is a
  // brand-new process (no scrollback) — only which panes exist and their collapse state come back.
  worktreePanes: Record<string, WorktreePaneSet>;
  runHostPane: (id: string) => void;
  addShellPane: (id: string) => void;
  removeWorktreePane: (id: string, role: string) => void;
  toggleWorktreePane: (id: string, role: string) => void;
  expandWorktreePane: (id: string, role: string) => void;
  resetWorktreePanes: (id: string) => void;
}

// withMint: run `fn` with a key-minter, returning the produced slots plus the advanced slotSeq. Keys are
// `slot-<n>`, monotonic and session-only — a stable per-column identity so reflow never remounts a
// surviving terminal. Exported for `init`, which mints the restored columns' keys.
export function withMint(st: { slotSeq: number }, fn: (mint: () => string) => Slots): { slots: Slots; slotSeq: number } {
  let seq = st.slotSeq;
  const mint = () => { seq += 1; return `slot-${seq}`; };
  return { slots: fn(mint), slotSeq: seq };
}

export const createWorkspaceSlice: SettingsSlice<WorkspaceSlice> = (set, get) => {
  const setSession = makeSetSession(set, get);

  // deduceSession: this slice's implementation of the deduce flow's session port. Deliberately a private
  // closure rather than ~10 more members on the state — consumers have no use for these single-step
  // operations. All the sequencing lives in worktrees/deduceFlow.ts, where it is unit-tested.
  const deduceSession: DeduceFlowSession = {
    isLive: (id) => get().pendingWorktrees.some((p) => p.id === id),
    knownRepos: () => get().cockpit.knownRepos,
    contexts: () => get().cockpit.worktreeContexts,
    cockpitPin: () => get().cockpit.cockpitWorktreeId,
    addPending: (prompt, view) => {
      const n = get().pendingSeq + 1;
      const id = `pending-${n}`;
      set((st) => ({ pendingSeq: n, pendingWorktrees: [...st.pendingWorktrees, { id, prompt, status: "deducing", view }] }));
      return id;
    },
    setPendingStatus: (id, status) =>
      set((st) => ({ pendingWorktrees: st.pendingWorktrees.map((p) => (p.id === id ? { ...p, status } : p)) })),
    dropPending: (id) => setSession((st) => ({ pendingWorktrees: st.pendingWorktrees.filter((p) => p.id !== id) })),
    placeEntity: (id, view) => get().placeNewEntity(id, view),
    swapSlotId: (from, to) => setSession((st) => ({ slots: swapSlotId(st.slots, from, to) })),
    clearSlots: (id) => setSession((st) => ({ slots: clearEntity(st.slots, id) })),
    addWorktree: (wt) => get().addWorktree(wt),
    armInitialPrompt: (id) => setSession((st) => ({ initialPromptPending: { ...st.initialPromptPending, [id]: true } })),
    setCockpitPin: (id) => get().setCockpitWorktree(id),
    setError: (worktreeError) => set({ worktreeError }),
  };

  return {
    slots: [],
    slotSeq: 0,
    scratchTerminals: [],
    scratchSeq: 0,
    pendingWorktrees: [],
    pendingSeq: 0,
    worktreeError: null,
    attention: {},
    initialPromptPending: {},
    restoredWorktrees: {},
    worktreePanes: {},

    // Slots persist via the workspace block; only slot.key stays session-only (a fresh reconciliation
    // id minted each launch, meaningless on disk).
    setSlot: (key, id) => setSession((st) => ({ slots: setSlotId(st.slots, key, id) })),
    // The `+` rail: append one empty column (no-op at the 3-column cap). withMint advances slotSeq.
    addEmptySlot: () => setSession((st) => withMint(st, (m) => addEmptySlotFn(st.slots, m))),
    // Close/Pause/teardown remove a column entirely; the layout reflows. No mint → slotSeq unchanged.
    removeSlot: (key) => setSession((st) => ({ slots: removeSlotFn(st.slots, key) })),
    // Swap two adjacent columns' positions (the on-divider swap button). Keys move with their slots, so
    // the terminals reorder without remounting.
    swapSlots: (keyA, keyB) => setSession((st) => ({ slots: swapSlotsFn(st.slots, keyA, keyB) })),
    // Persisted Cockpit-view right-column slot (omit from JSON when cleared).
    setCockpitWorktree: (id) => get().setCockpit((c) => ({ ...c, cockpitWorktreeId: id ?? undefined })),
    // View-dependent placement of a newly-created worktree/scratch/pending. Worktrees/Calm reflow the
    // shared slots (placeEntity); Cockpit sets its own persisted column and only fills a free shared
    // slot (fillEntity — no eviction).
    placeNewEntity: (id, view) => {
      if (view === "cockpit") get().setCockpitWorktree(id);
      setSession((st) => withMint(st, (m) => (view === "cockpit" ? fillEntity(st.slots, id, m) : placeEntity(st.slots, id, m))));
    },
    // Scratch terminals are single-shell entities that persist via the workspace block (pruned to the
    // ones still referenced by a slot/pin at save time); a monotonic seq keeps ids/titles unique.
    // Creation only — placement into a slot is placeNewEntity's job (view-dependent).
    addScratch: () => {
      const n = get().scratchSeq + 1;
      const id = `scratch-${n}`;
      setSession((st) => ({ scratchSeq: n, scratchTerminals: [...st.scratchTerminals, { id, title: `Scratch ${n}` }] }));
      return id;
    },
    removeScratch: (id) => {
      get().setCockpit((c) => ({ ...c, cockpitWorktreeId: c.cockpitWorktreeId === id ? undefined : c.cockpitWorktreeId }));
      setSession((st) => ({ scratchTerminals: st.scratchTerminals.filter((s) => s.id !== id), slots: clearEntity(st.slots, id) }));
    },
    renameScratch: (id, title) =>
      setSession((st) => ({ scratchTerminals: st.scratchTerminals.map((s) => (s.id === id ? { ...s, title } : s)) })),
    clearWorktreeError: () => set({ worktreeError: null }),
    // Fire-and-forget on purpose: the chain outlives the modal that submitted it (and the flow never
    // rejects, so nothing is swallowed).
    startDeduceWorktree: (prompt, view, source = "manual") => {
      void startDeduceFlow({ prompt, view, source }, { session: deduceSession, deduce: deduceWorktree, create: createWorktree });
    },
    // Attention highlight: a pane bells -> mark; the user types in it -> clear.
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
    // No-op (same object) when absent, so clearing an unflagged worktree never triggers a re-render.
    clearRestored: (id) =>
      set((st) => {
        if (!st.restoredWorktrees[id]) return st;
        const { [id]: _, ...rest } = st.restoredWorktrees;
        return { restoredWorktrees: rest };
      }),
    // Pane-set actions: thin wrappers over the pure paneSet helpers, keyed by worktree id.
    runHostPane: (id) =>
      setSession((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: runHost(st.worktreePanes[id] ?? EMPTY_PANE_SET) } })),
    addShellPane: (id) =>
      setSession((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: addExtra(st.worktreePanes[id] ?? EMPTY_PANE_SET) } })),
    removeWorktreePane: (id, role) =>
      setSession((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: removePane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
    toggleWorktreePane: (id, role) =>
      setSession((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: togglePane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
    expandWorktreePane: (id, role) =>
      setSession((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: expandPane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
    // No-op (same object) when absent, so resetting an untouched worktree never re-renders.
    resetWorktreePanes: (id) =>
      setSession((st) => {
        if (!st.worktreePanes[id]) return st;
        const { [id]: _, ...rest } = st.worktreePanes;
        return { worktreePanes: rest };
      }),
  };
};
