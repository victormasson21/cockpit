// CalmView.tsx — decluttered mirror of the Worktrees slots: each column shows only its worktree's
// Claude pane (variant="calm"). Reads the same shared slots; no `+` rail, no gear (managed from Worktrees).
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import "./WorktreesView.css";

export function CalmView() {
  const slots = useSettings((s) => s.slots);
  const setSlot = useSettings((s) => s.setSlot);
  return (
    <div className={`wt-view${slots.length === 1 ? " wt-view--single" : ""}`}>
      {slots.map((slot) => (
        <SlotColumn key={slot.key} value={slot.id} onSelect={(id) => setSlot(slot.key, id)} variant="calm" />
      ))}
    </div>
  );
}
