// api.ts — typed wrappers over the worktree IPC commands.
import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust BranchSpec tagged union.
export type BranchSpec =
  | { kind: "existing"; branch: string }
  | { kind: "new"; branch: string; base: string }
  | { kind: "pr"; number: number; branch: string };

// Run `git worktree add`; resolves to the created worktree path, rejects with git's stderr.
export const createWorktree = (repoPath: string, name: string, spec: BranchSpec) =>
  invoke<string>("create_worktree", { repoPath, name, spec });

// Mirrors the Rust DeducedWorktree: the params the deduce agent returns.
export interface DeducedWorktree {
  repoPath: string;
  name: string;
  branch: string;
  base: string;
  startCmd: string;
  address: string;
  reason: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceResolved?: boolean;
  existingBranch?: boolean;
  prNumber?: number;
}

// Deduce worktree params from a prompt + the known-repos list; rejects with an inline-displayable error string.
export const deduceWorktree = (prompt: string, repoPaths: string[]) =>
  invoke<DeducedWorktree>("deduce_worktree", { prompt, repoPaths });
