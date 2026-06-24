// CalmView.tsx — decluttered view: each slot shows only its worktree's Claude Code pane (variant="calm").
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function CalmView() {
  const slotCount = useSettings((s) => s.slotCount);
  return (
    <div className="wt-view">
      {Array.from({ length: slotCount }, (_, i) => (
        <SlotColumn key={i} slotIndex={i} variant="calm" />
      ))}
    </div>
  );
}
