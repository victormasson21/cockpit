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

// assignNewWorktree: show a newly-created worktree — fill the first empty slot, or displace the
// last slot when all are full (the bumped worktree keeps running and stays in the dropdowns).
export function assignNewWorktree(slots: Slots, id: string): Slots {
  const empty = slots.indexOf(null);
  return setSlotAt(slots, empty === -1 ? slots.length - 1 : empty, id);
}

// clearWorktree: drop a deleted worktree from every slot referencing it.
export function clearWorktree(slots: Slots, id: string): Slots {
  return slots.map((s) => (s === id ? null : s));
}
