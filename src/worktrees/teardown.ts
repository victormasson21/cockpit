// teardown.ts — cumulative worktree teardown steps (Close ⊂ Pause ⊂ Delete ⊂ Wipe). No React: the
// store action is injected so the sequence is unit-testable.
import { invoke } from "@tauri-apps/api/core";
import { makePtyId } from "./ptyId";
import { removeWorktreeGit, deleteBranch } from "./api";

// Pause/teardown kill the worktree's LIVE pane roles (claude + host? + shell-*), passed by the
// caller from the session pane-set. Idempotent — pty_kill is a no-op on missing ids.
export async function killWorktreePtys(worktreeId: string, roles: string[]): Promise<void> {
  for (const role of roles) await invoke("pty_kill", { ptyId: makePtyId(worktreeId, role) });
}

// Delete/Wipe: kill PTYs → git worktree remove(force) → [Wipe: delete branch] → drop model. If remove
// throws, the model is kept (caller surfaces the error and the user retries). A branch-delete failure
// is non-fatal — the worktree is already gone, so dropping the model is still correct; it returns a
// warning string instead. Returns null when nothing went wrong.
export async function teardownWorktree(
  wt: { id: string; repoPath: string; worktreePath: string; branch: string },
  opts: { wipe: boolean; force: boolean },
  removeWorktreeModel: (id: string) => void,
  roles: string[],
): Promise<string | null> {
  await killWorktreePtys(wt.id, roles); // 1. kill first — frees the dir so git worktree remove can't be blocked.
  await removeWorktreeGit(wt.repoPath, wt.worktreePath, opts.force); // 2. throws → abort, keep model.
  let warning: string | null = null;
  if (opts.wipe) {
    // 3. non-fatal: e.g. unmerged-branch guard wouldn't fire (-D forces), but keep robust anyway.
    try {
      await deleteBranch(wt.repoPath, wt.branch);
    } catch (e) {
      warning = `Worktree removed, but branch could not be deleted: ${String(e)}`;
    }
  }
  removeWorktreeModel(wt.id); // 4. drop model only after the worktree is actually gone.
  return warning;
}
