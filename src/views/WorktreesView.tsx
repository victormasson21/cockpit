// WorktreesView.tsx — the Worktrees view: 2–3 fixed column slots side by side (count from the header toggle).
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function WorktreesView() {
  const slots = useSettings((s) => s.slots);
  const slotCount = useSettings((s) => s.slotCount);
  const setSlot = useSettings((s) => s.setSlot);
  return (
    <div className="wt-view">
      {Array.from({ length: slotCount }, (_, i) => (
        <SlotColumn key={i} value={slots[i]} onSelect={(id) => setSlot(i, id)} />
      ))}
    </div>
  );
}
