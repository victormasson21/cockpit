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

// Resolve a picked folder to its git repo root; rejects with a message if the folder is not a repo.
export const resolveRepoRoot = (path: string) =>
  invoke<string>("resolve_repo_root", { path });

// One local branch row for the existing-branch picker (mirrors Rust BranchInfo).
// checkedOut flags a branch git won't let us worktree-add (already checked out somewhere); checkedOutPath says where.
export interface BranchInfo {
  name: string;
  lastCommitRelative: string;
  checkedOut: boolean;
  checkedOutPath?: string | null;
}

// List a repo's local branches, most-recently-committed first.
export const listBranches = (repoPath: string) => invoke<BranchInfo[]>("list_branches", { repoPath });

// Worktree teardown (Delete/Wipe): probe dirtiness, remove the git worktree, force-delete a branch.
// `exists: false` means the dir is already gone — Delete still proceeds (remove_worktree prunes).
export interface WorktreeStatus { exists: boolean; dirty: boolean }
export const worktreeStatus = (worktreePath: string) =>
  invoke<WorktreeStatus>("worktree_status", { worktreePath });
// Named removeWorktreeGit to avoid colliding with the store's model-only removeWorktree.
export const removeWorktreeGit = (repoPath: string, worktreePath: string, force: boolean) =>
  invoke<void>("remove_worktree", { repoPath, worktreePath, force });
export const deleteBranch = (repoPath: string, branch: string) =>
  invoke<void>("delete_branch", { repoPath, branch });

// Branch-vs-base diff (Cockpit Diff tab). One changed file's line counts (mirrors Rust DiffFile);
// binary files report 0/0 + binary=true. base="" lets the backend derive the repo default branch.
export interface DiffFile { path: string; added: number; removed: number; binary: boolean }
export interface DiffResult { base: string; files: DiffFile[] }
export const worktreeDiff = (worktreePath: string, repoPath: string, base: string) =>
  invoke<DiffResult>("worktree_diff", { worktreePath, repoPath, base });
// One file's raw unified patch, fetched lazily when a file row is expanded.
export const worktreeFileDiff = (worktreePath: string, repoPath: string, base: string, path: string) =>
  invoke<string>("worktree_file_diff", { worktreePath, repoPath, base, path });

// The PR for the worktree's current branch (mirrors Rust WorktreePr); null when no PR exists yet.
export interface WorktreePr { number: number; url: string }
export const worktreePr = (worktreePath: string) =>
  invoke<WorktreePr | null>("worktree_pr", { worktreePath });
