// slots.ts — pure helpers for the Worktrees view's 3 column slots (session-only; not persisted to disk).
import type { Worktree } from "../settings/types";

export const SLOT_COUNT = 3;
export type Slots = (string | null)[];

// initSlots: on load, auto-fill the slots with the first SLOT_COUNT ongoing worktrees.
export function initSlots(worktrees: Worktree[]): Slots {
  const ongoing = worktrees.filter((w) => w.status === "ongoing").map((w) => w.id);
  return Array.from({ length: SLOT_COUNT }, (_, i) => ongoing[i] ?? null);
}

// setSlotAt: choose (or clear with null) the worktree shown in one slot — the dropdown picker + Hide.
export function setSlotAt(slots: Slots, index: number, id: string | null): Slots {
  return slots.map((s, i) => (i === index ? id : s));
}

// assignFirstEmpty: place a newly-created worktree in the first empty slot; unchanged when all are full.
export function assignFirstEmpty(slots: Slots, id: string): Slots {
  const i = slots.indexOf(null);
  return i === -1 ? slots : setSlotAt(slots, i, id);
}

// clearWorktree: drop a deleted worktree from every slot referencing it.
export function clearWorktree(slots: Slots, id: string): Slots {
  return slots.map((s) => (s === id ? null : s));
}
