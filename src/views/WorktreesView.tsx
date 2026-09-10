// WorktreesView.tsx — responsive Worktrees view: 1 (centered) / 2 / 3 columns by slots.length, plus a
// slim `+` rail (hidden at the 3-column cap) that appends an empty slot to fill.
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";
import { SLOT_COUNT } from "./slots";
import { PlusIcon, SwapIcon } from "./icons";
import "./WorktreesView.css";

export function WorktreesView({ onPin }: { onPin: (id: string) => void }) {
  const slots = useSettings((s) => s.slots);
  const setSlot = useSettings((s) => s.setSlot);
  const removeSlot = useSettings((s) => s.removeSlot);
  const addEmptySlot = useSettings((s) => s.addEmptySlot);
  const swapSlots = useSettings((s) => s.swapSlots);
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
        {/* Swap button per boundary where BOTH flanking tiles are assigned — sits on the divider (columns
            are equal-width, so the boundary after column i is at (i+1)/N). Swaps the two columns' positions. */}
        {slots.slice(0, -1).map((slot, i) =>
          slot.id && slots[i + 1].id ? (
            <button
              key={`swap-${slot.key}`}
              className="wt-view__swap"
              style={{ left: `${((i + 1) / slots.length) * 100}%` }}
              aria-label="Swap these two panels"
              onClick={() => swapSlots(slot.key, slots[i + 1].key)}
            >
              <SwapIcon />
            </button>
          ) : null,
        )}
      </div>
      {slots.length < SLOT_COUNT && (
        <button className="wt-view__add" aria-label="Add a panel" onClick={addEmptySlot}>
          <PlusIcon />
        </button>
      )}
    </div>
  );
}
