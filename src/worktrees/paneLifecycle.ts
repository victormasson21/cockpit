// paneLifecycle.ts — the sequences for stopping panes: PTY control (ptyPane) composed with the
// session store. Deps are injected with a real default so the ordering is unit-testable, the idiom
// teardown.ts and deduceFlow.ts already use. ptyPane itself stays store-free.
import { useSettings } from "../settings/store";
import { paneRoles, EMPTY_PANE_SET } from "./paneSet";
import { ptyPane, type PtyPane } from "./ptyPane";

// Which of a worktree's panes exist right now (claude, plus host once Run is pressed, plus extras).
// Absent = Claude only; callers used to spell that default out at each site.
export function liveRoles(worktreeId: string): string[] {
  return paneRoles(useSettings.getState().worktreePanes[worktreeId] ?? EMPTY_PANE_SET);
}

export interface PaneDeps {
  pane: (worktreeId: string, role: string) => Pick<PtyPane, "id" | "kill">;
  clearAttention: (ptyId: string) => void;
  removePane: (worktreeId: string, role: string) => void;
}

const liveDeps: PaneDeps = {
  pane: ptyPane,
  clearAttention: (ptyId) => useSettings.getState().clearAttention(ptyId),
  removePane: (worktreeId, role) => useSettings.getState().removeWorktreePane(worktreeId, role),
};

// Stop these roles' processes, dropping any pending attention mark as we go. Sequential and
// idempotent — pty_kill is Ok on a missing id. A failure propagates: teardown must not reach
// `git worktree remove` with a process still holding the directory.
//
// Clearing attention belongs to the kill, not to individual callers: before this module only
// restart/close cleared it, so a Pause left a live mark that glowed again on re-select.
export async function killPanes(worktreeId: string, roles: string[], deps: PaneDeps = liveDeps): Promise<void> {
  for (const role of roles) {
    const pane = deps.pane(worktreeId, role);
    deps.clearAttention(pane.id);
    await pane.kill();
  }
}

// Close on host/extras: stop the process, then take the pane out of the column.
//
// The kill is AWAITED before the pane is dropped: the `host` role reuses a fixed pty id, so a
// fire-and-forget kill racing an immediate re-Run lets pty_ensure reattach the still-alive entry and
// the lagging kill then removes it — leaving a dead pane. Extras are immune (monotonic role) but
// share this path. A failed kill is logged rather than rethrown: leaving the pane on screen with no
// process behind it is the worse outcome (it blinks a cursor and silently eats keystrokes).
export async function closePane(worktreeId: string, role: string, deps: PaneDeps = liveDeps): Promise<void> {
  try {
    await killPanes(worktreeId, [role], deps);
  } catch (e) {
    console.error("pty_kill failed", e);
  }
  deps.removePane(worktreeId, role);
}
