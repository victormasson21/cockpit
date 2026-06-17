// ptyId.ts — single source of the PTY id format; mirrors Rust pty_id() ("{worktreeId}:{role}").
export const makePtyId = (worktreeId: string, role: string) => `${worktreeId}:${role}`;
