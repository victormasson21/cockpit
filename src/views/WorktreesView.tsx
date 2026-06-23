// WorktreesView.tsx — the Worktrees view: three fixed column slots side by side.
import { WorktreeColumn } from "./worktree-column/WorktreeColumn";
import { SLOT_COUNT } from "./slots";
import "./WorktreesView.css";

export function WorktreesView() {
  return (
    <div className="wt-view">
      {Array.from({ length: SLOT_COUNT }, (_, i) => (
        <WorktreeColumn key={i} slotIndex={i} />
      ))}
    </div>
  );
}
