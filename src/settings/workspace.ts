// workspace.ts — pure snapshot/restore of the persisted `workspace` block (which tile shows what, which
// panes are live). Session state stays the source of truth; this is the only place it meets the file.
import type { CockpitConfig, WorkspaceState, Worktree } from "./types";
import type { ScratchTerminal, Slots } from "../views/slots";
import { SLOT_COUNT } from "../views/slots";
import type { WorktreePaneSet } from "../worktrees/paneSet";

// The slice of store state the block is composed from (structurally satisfied by SettingsState).
export type WorkspaceSession = {
  slots: Slots;
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  worktreePanes: Record<string, WorktreePaneSet>;
};

// Session state → the persisted block. Slot `key`s are React reconciliation identity, so only ids travel.
// Scratch terminals are pruned to the ones still referenced (by a slot, or the Cockpit pin) — otherwise
// a scratch closed via removeSlot (which only clears the slot, not the entity) would persist forever and
// the picker's "Scratch" group would grow every launch.
export function workspaceSnapshot(s: WorkspaceSession, cockpitWorktreeId?: string): WorkspaceState {
  const referenced = new Set(s.slots.map((slot) => slot.id).filter((id): id is string => !!id));
  if (cockpitWorktreeId) referenced.add(cockpitWorktreeId);
  return {
    slots: s.slots.map((slot) => slot.id),
    scratch: s.scratchTerminals.filter((t) => referenced.has(t.id)),
    scratchSeq: s.scratchSeq,
    panes: s.worktreePanes,
  };
}

// Compose the block into the config being written. Called at save time so the in-memory cockpit never
// carries a second copy of the session state that could drift out of sync. `cockpit` already carries the
// Cockpit-view pin, so it's threaded into the snapshot from here rather than widening WorkspaceSession.
export function withWorkspace(cockpit: CockpitConfig, s: WorkspaceSession): CockpitConfig {
  return { ...cockpit, workspace: workspaceSnapshot(s, cockpit.cockpitWorktreeId) };
}

// Highest n across `scratch-<n>` ids; guards against a hand-edited seq minting a colliding id.
function highestScratchN(scratch: ScratchTerminal[]): number {
  return scratch.reduce((max, s) => {
    const n = Number(s.id.replace(/^scratch-/, ""));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
}

// The persisted block → session state. An id that no longer resolves becomes an empty column (the column
// count is what the user left, and an empty slot already renders a picker); pane sets for vanished
// worktrees are dropped; every restored worktree is flagged so its claude pane resumes exactly once.
export function restoreWorkspace(
  ws: WorkspaceState,
  worktrees: Worktree[],
  mintKey: () => string,
  cockpitWorktreeId?: string,
): WorkspaceSession & { restoredWorktrees: Record<string, true> } {
  const scratchTerminals = ws.scratch ?? [];
  const scratchIds = new Set(scratchTerminals.map((s) => s.id));
  const worktreeIds = new Set(worktrees.map((w) => w.id));
  const slots: Slots = (ws.slots ?? []).slice(0, SLOT_COUNT).map((id) => ({
    key: mintKey(),
    id: id && (worktreeIds.has(id) || scratchIds.has(id)) ? id : null,
  }));
  const worktreePanes = Object.fromEntries(
    Object.entries(ws.panes ?? {}).filter(([id]) => worktreeIds.has(id)),
  );
  // Restored = every worktree the arrangement brings back, wherever it shows (slot, Cockpit pin, or
  // just a live pane set) — a Claude-only worktree has no `panes` entry, so slots must be included.
  const restored = [...slots.map((s) => s.id), ...Object.keys(worktreePanes), cockpitWorktreeId]
    .filter((id): id is string => !!id && worktreeIds.has(id));
  return {
    slots,
    scratchTerminals,
    scratchSeq: Math.max(ws.scratchSeq ?? 0, highestScratchN(scratchTerminals)),
    worktreePanes,
    restoredWorktrees: Object.fromEntries(restored.map((id) => [id, true as const])),
  };
}
