// WorktreeInfo.tsx — the circled ⓘ at the head of a worktree's chips row: hovering it reveals the
// worktree's repo / branch / directory on three rows (previously an always-visible details row).
import type { Worktree } from "../../settings/types";
import { InfoIcon, FolderIcon } from "../icons";

// Reveal is CSS-only (`.wt-info:hover`/`:focus-within` in WorktreeColumn.css) — hover needs no state,
// so there is nothing to toggle, close, or clean up. The trigger is a real <button> purely so
// :focus-within opens the popup when it is reached by keyboard.
export function WorktreeInfo({ worktree }: { worktree: Worktree }) {
  return (
    <span className="wt-info">
      <button type="button" className="wt-info__btn" aria-label="worktree details"><InfoIcon /></button>
      <div className="wt-info__pop">
        <span className="wt-info__row"><FolderIcon />{worktree.repoPath.split("/").pop()}</span>
        <span className="wt-info__row"><span className="wt-ico wt-ico--branch" aria-hidden />{worktree.branch}</span>
        <span className="wt-info__row"><span className="wt-ico wt-ico--tree" aria-hidden />{worktree.worktreePath.split("/").pop()}</span>
      </div>
    </span>
  );
}
