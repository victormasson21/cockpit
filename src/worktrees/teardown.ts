// teardown.ts — cumulative worktree teardown steps (Close ⊂ Pause ⊂ Delete ⊂ Wipe). No React and no
// store: the PTY kill and the model write are injected, so the sequence is unit-testable on its own.
import type { WorktreeLocation } from "../settings/types";
import { removeWorktreeGit, deleteBranch } from "./api";

export interface TeardownDeps {
  // Stop the worktree's live PTYs. A thunk, not (id, roles): which panes are live is a pane concern,
  // bound by the caller, so teardown never has to model them.
  killPtys: () => Promise<void>;
  // Drop the worktree from the persisted model.
  removeModel: (id: string) => void;
}

// Delete/Wipe: kill PTYs → git worktree remove(force) → [Wipe: delete branch] → [relocated: the same for
// the earlier checkout] → drop model. If the current remove throws, the model is kept (caller surfaces the
// error and the user retries). Every later failure is non-fatal — the worktree is already gone, so
// dropping the model is still correct; it returns a warning string instead. Null when nothing went wrong.
export async function teardownWorktree(
  wt: { id: string; relocatedFrom?: WorktreeLocation } & WorktreeLocation,
  opts: { wipe: boolean; force: boolean },
  deps: TeardownDeps,
): Promise<string | null> {
  await deps.killPtys(); // 1. kill first — frees the dir so git worktree remove can't be blocked.
  await removeWorktreeGit(wt.repoPath, wt.worktreePath, opts.force); // 2. throws → abort, keep model.
  const warnings: string[] = [];
  if (opts.wipe) {
    // 3. non-fatal: e.g. unmerged-branch guard wouldn't fire (-D forces), but keep robust anyway.
    try {
      await deleteBranch(wt.repoPath, wt.branch);
    } catch (e) {
      warnings.push(`Worktree removed, but branch could not be deleted: ${String(e)}`);
    }
  }
  // 4. The abandoned pre-relocation checkout: always forced, since nothing in it was meant to be kept.
  const from = wt.relocatedFrom;
  if (from) {
    try {
      await removeWorktreeGit(from.repoPath, from.worktreePath, true);
      if (opts.wipe) await deleteBranch(from.repoPath, from.branch);
    } catch (e) {
      warnings.push(`Earlier checkout ${from.worktreePath} could not be fully removed: ${String(e)}`);
    }
  }
  deps.removeModel(wt.id); // 5. drop model only after the worktree is actually gone.
  return warnings.length ? warnings.join("\n") : null;
}
