// WorktreesView.tsx — responsive Worktrees view: 1 (centered) / 2 / 3 columns by slots.length, plus a
// slim `+` rail (hidden at the 3-column cap) that appends an empty slot to fill.
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import { SLOT_COUNT } from "./slots";
import { PlusIcon } from "./icons";
import "./WorktreesView.css";

export function WorktreesView({ onPin }: { onPin: (id: string) => void }) {
  const slots = useSettings((s) => s.slots);
  const setSlot = useSettings((s) => s.setSlot);
  const removeSlot = useSettings((s) => s.removeSlot);
  const addEmptySlot = useSettings((s) => s.addEmptySlot);
  // Columns live in their own flex group so the `+` rail (a fixed 40px sibling) never skews the
  // single-column centering.
  return (
    <div className="wt-view">
      <div className={`wt-view__cols${slots.length === 1 ? " wt-view--single" : ""}`}>
        {slots.map((slot) => (
          <SlotColumn
            key={slot.key}
            value={slot.id}
            onSelect={(id) => setSlot(slot.key, id)}
            onClose={() => removeSlot(slot.key)}
            onPin={onPin}
          />
        ))}
      </div>
      {slots.length < SLOT_COUNT && (
        <button className="wt-view__add" aria-label="Add a panel" onClick={addEmptySlot}>
          <PlusIcon />
        </button>
      )}
    </div>
  );
}
