// RelocateDialog.tsx — "Move to repo…": pick another known repo, check the branch out there, repoint
// the worktree. The Claude session keeps running; /add-dir for the new checkout is typed into it.
import { useState } from "react";
import type { Worktree } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { createWorktree, defaultBranch, listBranches } from "../../worktrees/api";
import { relocateWorktree } from "../../worktrees/relocate";
import { writePty } from "../../worktrees/ptyPane";
import { makePtyId } from "../../worktrees/ptyId";
import { Dropdown } from "../Dropdown";
import { Modal } from "../Modal";

const repoName = (path: string) => path.split("/").pop() ?? path;

export function RelocateDialog({ worktree, onClose }: { worktree: Worktree; onClose: () => void }) {
  const knownRepos = useSettings((s) => s.cockpit.knownRepos);
  const updateWorktree = useSettings((s) => s.updateWorktree);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = knownRepos
    .filter((r) => r.path !== worktree.repoPath)
    .map((r) => ({ value: r.path, label: repoName(r.path), hint: r.path }));

  const move = async () => {
    if (!repoPath) return;
    setBusy(true);
    setError(null);
    try {
      await relocateWorktree(worktree, repoPath, {
        listBranches, defaultBranch, create: createWorktree, update: updateWorktree,
        typeIntoClaude: (text) => writePty(makePtyId(worktree.id, "claude"), text),
      });
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Move to repo" onClose={busy ? () => {} : onClose}>
      <p className="tc__line">
        <code>{worktree.branch}</code> · <span className="tc__path">{worktree.worktreePath}</span>
      </p>
      <Dropdown variant="form" placeholder="select repo…" value={repoPath} onChange={setRepoPath} groups={[{ options }]} />
      <p className="tc__line">
        The branch is checked out in the picked repo. Claude keeps its conversation and gets <code>/add-dir</code> typed
        in; press Enter when it is idle. The old checkout is removed on Delete or Wipe.
      </p>
      {error && <div className="tc__error">{error}</div>}
      <div className="tc__actions">
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button onClick={move} disabled={busy || !repoPath}>{busy ? "Moving…" : "Move"}</button>
      </div>
    </Modal>
  );
}
