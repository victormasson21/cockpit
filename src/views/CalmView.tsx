// CalmView.tsx — decluttered view: each slot shows only its worktree's Claude Code pane (variant="calm").
import { SlotColumn } from "./worktree-column/SlotColumn";
import { SLOT_COUNT } from "./slots";
import "./WorktreesView.css";

export function CalmView() {
  return (
    <div className="wt-view">
      {Array.from({ length: SLOT_COUNT }, (_, i) => (
        <SlotColumn key={i} slotIndex={i} variant="calm" />
      ))}
    </div>
  );
}
