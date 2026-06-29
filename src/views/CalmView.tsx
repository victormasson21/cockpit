// CalmView.tsx — decluttered view: each slot shows only its worktree's Claude Code pane (variant="calm").
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function CalmView() {
  const slots = useSettings((s) => s.slots);
  const slotCount = useSettings((s) => s.slotCount);
  const setSlot = useSettings((s) => s.setSlot);
  return (
    <div className="wt-view">
      {Array.from({ length: slotCount }, (_, i) => (
        <SlotColumn key={i} value={slots[i]} onSelect={(id) => setSlot(i, id)} variant="calm" />
      ))}
    </div>
  );
}
