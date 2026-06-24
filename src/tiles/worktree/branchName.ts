// branchName.ts — derive a friendly default worktree name from a branch ref (its last path segment).
export function deriveBranchName(branch: string): string {
  return branch.split("/").pop() ?? branch;
}
