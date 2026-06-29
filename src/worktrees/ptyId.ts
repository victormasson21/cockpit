// ptyId.ts — single source of the PTY id format; mirrors Rust pty_id() ("{worktreeId}:{role}").
export const makePtyId = (worktreeId: string, role: string) => `${worktreeId}:${role}`;

// Only the Claude pane and scratch shells can be running Claude Code, so only they
// arm the bell-based "needs attention" highlight (host/git panes are excluded).
export const isAttentionRole = (role: string) => role === "claude" || role === "shell";
