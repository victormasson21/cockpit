// WorktreesView.tsx — the Worktrees view: three fixed column slots side by side.
import { SlotColumn } from "./worktree-column/SlotColumn";
import { SLOT_COUNT } from "./slots";
import "./WorktreesView.css";

export function WorktreesView() {
  return (
    <div className="wt-view">
      {Array.from({ length: SLOT_COUNT }, (_, i) => (
        <SlotColumn key={i} slotIndex={i} />
      ))}
    </div>
  );
}
