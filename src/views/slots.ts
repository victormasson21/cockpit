// slots.ts — pure helpers for the Worktrees view's 3 column slots (session-only; not persisted to disk).
import type { Worktree } from "../settings/types";

export const SLOT_COUNT = 3; // max columns; the slots array is always this length
export const MIN_SLOTS = 2; // fewest columns the panes toggle allows
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

// assignNewWorktree: show a newly-created worktree — fill the first empty slot within the visible
// range, or displace the LAST VISIBLE slot when the visible range is full (the bumped worktree keeps
// running and stays in the dropdowns). visibleCount defaults to the whole array for legacy callers.
export function assignNewWorktree(slots: Slots, id: string, visibleCount: number = slots.length): Slots {
  const empty = slots.slice(0, visibleCount).indexOf(null);
  return setSlotAt(slots, empty === -1 ? visibleCount - 1 : empty, id);
}

// fillFreeSlot: place a worktree only if the visible range has a free slot; otherwise leave slots
// untouched (NO eviction). Used by the Cockpit-view placement branch.
export function fillFreeSlot(slots: Slots, id: string, visibleCount: number): Slots {
  const empty = slots.slice(0, visibleCount).indexOf(null);
  return empty === -1 ? slots : setSlotAt(slots, empty, id);
}

// clearEntity: drop a deleted entity (worktree or scratch) from every slot referencing it.
export function clearEntity(slots: Slots, id: string): Slots {
  return slots.map((s) => (s === id ? null : s));
}

// hideSlotsBeyond: when shrinking the visible column count, null out the now-hidden slots so
// re-expanding shows empty panes (the dropped entities keep running and stay in the dropdowns).
export function hideSlotsBeyond(slots: Slots, visibleCount: number): Slots {
  return slots.map((s, i) => (i < visibleCount ? s : null));
}

// A scratch terminal: a session-only single-shell entity that can occupy a slot (no repo/branch).
export type ScratchTerminal = { id: string; title: string };

// What a slot id resolves to: a worktree, a scratch terminal, or nothing.
export type SlotEntity =
  | { kind: "worktree"; worktree: Worktree }
  | { kind: "scratch"; scratch: ScratchTerminal }
  | null;

// resolveSlotEntity: look an id up as a worktree first, then a scratch (ids never collide — scratch is `scratch-*`).
export function resolveSlotEntity(
  id: string | null,
  worktrees: Worktree[],
  scratch: ScratchTerminal[],
): SlotEntity {
  if (!id) return null;
  const w = worktrees.find((x) => x.id === id);
  if (w) return { kind: "worktree", worktree: w };
  const s = scratch.find((x) => x.id === id);
  if (s) return { kind: "scratch", scratch: s };
  return null;
}
