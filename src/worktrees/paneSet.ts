// paneSet.ts — pure helpers for a worktree's session-only dynamic pane set (claude + optional host + extra shells).

export type WorktreePaneSet = {
  host: boolean; // Run pressed and pane not closed
  extras: string[]; // extra-shell roles ("shell-<n>"), max MAX_EXTRAS
  seq: number; // monotonic per worktree — a closed pane's role (and PTY scrollback) is never reused
  open: Record<string, boolean>; // collapse state per role; absent = open
};

export const MAX_EXTRAS = 2;
export const EMPTY_PANE_SET: WorktreePaneSet = { host: false, extras: [], seq: 0, open: {} };

// All live roles in render order: claude first, then host, then extras.
export function paneRoles(set: WorktreePaneSet): string[] {
  return ["claude", ...(set.host ? ["host"] : []), ...set.extras];
}

export function runHost(set: WorktreePaneSet): WorktreePaneSet {
  return set.host ? set : { ...set, host: true, open: { ...set.open, host: true } };
}

// No-op at the cap; a new pane always starts open.
export function addExtra(set: WorktreePaneSet): WorktreePaneSet {
  if (set.extras.length >= MAX_EXTRAS) return set;
  const role = `shell-${set.seq + 1}`;
  return { ...set, seq: set.seq + 1, extras: [...set.extras, role], open: { ...set.open, [role]: true } };
}

// Close on host/extras: drop the pane and its collapse state (the claude pane can't be removed).
export function removePane(set: WorktreePaneSet, role: string): WorktreePaneSet {
  const { [role]: _, ...open } = set.open;
  if (role === "host") return { ...set, host: false, open };
  return { ...set, extras: set.extras.filter((r) => r !== role), open };
}

export function isPaneOpen(set: WorktreePaneSet, role: string): boolean {
  return set.open[role] ?? true;
}

export function togglePane(set: WorktreePaneSet, role: string): WorktreePaneSet {
  return { ...set, open: { ...set.open, [role]: !isPaneOpen(set, role) } };
}

// Expand = open me, collapse every other live pane.
export function expandPane(set: WorktreePaneSet, role: string): WorktreePaneSet {
  return { ...set, open: Object.fromEntries(paneRoles(set).map((r) => [r, r === role])) };
}
