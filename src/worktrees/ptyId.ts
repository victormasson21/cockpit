// ptyId.ts — single source of the PTY id format; mirrors Rust pty_id() ("{worktreeId}:{role}").
export const makePtyId = (worktreeId: string, role: string) => `${worktreeId}:${role}`;

// Panes that may be running Claude Code arm the bell-based "needs attention" highlight:
// the claude pane, scratch shells ("shell"), and worktree extra shells ("shell-<n>").
// host is excluded (dev server output must not trigger it).
export const isAttentionRole = (role: string) =>
  role === "claude" || role === "shell" || role.startsWith("shell-");

// The Notepad tab's claude pane entity id: not a worktree, not a scratch, one fixed pane.
export const NOTEPAD_ID = "notepad";
