// api.ts — typed wrappers over the worktree IPC commands.
import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust BranchSpec tagged union.
export type BranchSpec =
  | { kind: "existing"; branch: string }
  | { kind: "new"; branch: string; base: string };

// Run `git worktree add`; resolves to the created worktree path, rejects with git's stderr.
export const createWorktree = (repoPath: string, name: string, spec: BranchSpec) =>
  invoke<string>("create_worktree", { repoPath, name, spec });
