// relocate.ts — move a worktree to another repo: check out its branch there, then repoint the model.
// The old checkout stays (the Claude pane runs in it) until teardown. No React and no store: the IPC and
// the model write are injected, so the sequence is unit-testable on its own.
import type { Worktree } from "../settings/types";
import type { BranchInfo, BranchSpec } from "./api";
import { addDirCommand } from "./claudeCmd";
import { isPrimaryTree } from "./model";

export interface RelocateDeps {
  listBranches: (repoPath: string) => Promise<BranchInfo[]>;
  defaultBranch: (repoPath: string) => Promise<string>;
  create: (repoPath: string, name: string, spec: BranchSpec) => Promise<string>;
  update: (id: string, patch: Partial<Worktree>) => void;
  // Types into the live Claude pane. Rejects when there is none, which is fine: its next start adds the dir.
  typeIntoClaude: (text: string) => Promise<void>;
}

// One move per worktree: a second would orphan the middle checkout, which teardown does not track.
export const canRelocate = (wt: Worktree): boolean => !isPrimaryTree(wt) && !wt.relocatedFrom;

// Reuse the branch when the target repo already has it free; git refuses one checked out elsewhere.
async function relocationSpec(branch: string, repoPath: string, deps: RelocateDeps): Promise<BranchSpec> {
  const existing = (await deps.listBranches(repoPath)).find((b) => b.name === branch);
  if (existing?.checkedOut) throw new Error(`${branch} is already checked out in ${repoPath}`);
  return existing ? { kind: "existing", branch } : { kind: "new", branch, base: await deps.defaultBranch(repoPath) };
}

export async function relocateWorktree(wt: Worktree, repoPath: string, deps: RelocateDeps): Promise<void> {
  if (!canRelocate(wt)) throw new Error("This worktree cannot be moved");
  const worktreePath = await deps.create(repoPath, wt.name, await relocationSpec(wt.branch, repoPath, deps));
  deps.update(wt.id, {
    repoPath, worktreePath,
    host: { startCmd: "", address: "" }, // the old repo's command; blank falls back to the new repo's default
    relocatedFrom: { repoPath: wt.repoPath, worktreePath: wt.worktreePath, branch: wt.branch },
  });
  await deps.typeIntoClaude(addDirCommand(worktreePath)).catch(() => undefined);
}
