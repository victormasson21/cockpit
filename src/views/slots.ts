// slots.ts — pure helpers for the Worktrees view's responsive column slots (session-only; not persisted).
// A slot = { key, id }: `key` is a stable per-column identity so reflow never remounts surviving
// terminals; `id` is the entity shown (null = a shown-but-empty slot the user is about to fill).
import type { Worktree } from "../settings/types";

export const SLOT_COUNT = 3; // max columns; layout is 1 (centered) / 2 / 3 by slots.length
export type Slot = { key: string; id: string | null };
export type Slots = Slot[];

// initSlots: on load, one column per ongoing worktree (capped); zero ongoing → no columns.
export function initSlots(worktrees: Worktree[], mintKey: () => string): Slots {
  return worktrees
    .filter((w) => w.status === "ongoing")
    .slice(0, SLOT_COUNT)
    .map((w) => ({ key: mintKey(), id: w.id }));
}

// addEmptySlot: the `+` rail — append one empty column, unless already at the cap (referential no-op).
export function addEmptySlot(slots: Slots, mintKey: () => string): Slots {
  if (slots.length >= SLOT_COUNT) return slots;
  return [...slots, { key: mintKey(), id: null }];
}

// setSlotId: set one column's content by key (id assigns; null empties it in place, keeping the column).
export function setSlotId(slots: Slots, key: string, id: string | null): Slots {
  return slots.map((s) => (s.key === key ? { ...s, id } : s));
}

// removeSlot: splice a column out entirely — the layout reflows down.
export function removeSlot(slots: Slots, key: string): Slots {
  return slots.filter((s) => s.key !== key);
}

// placeEntity: show a newly-created entity — fill the first empty slot, else append if there's room,
// else replace the rightmost column (the bumped entity keeps running, re-assignable via the dropdown).
export function placeEntity(slots: Slots, id: string, mintKey: () => string): Slots {
  const empty = slots.findIndex((s) => s.id === null);
  if (empty !== -1) return slots.map((s, i) => (i === empty ? { ...s, id } : s));
  if (slots.length < SLOT_COUNT) return [...slots, { key: mintKey(), id }];
  return slots.map((s, i) => (i === slots.length - 1 ? { ...s, id } : s));
}

// fillEntity: like placeEntity but NEVER evicts — fill an empty slot or append when there's room, else
// leave slots untouched. Used by Cockpit-view create (the Cockpit column is its own separate slot).
export function fillEntity(slots: Slots, id: string, mintKey: () => string): Slots {
  const empty = slots.findIndex((s) => s.id === null);
  if (empty !== -1) return slots.map((s, i) => (i === empty ? { ...s, id } : s));
  if (slots.length < SLOT_COUNT) return [...slots, { key: mintKey(), id }];
  return slots;
}

// clearEntity: an entity was deleted — splice out every column referencing it (layout reflows).
export function clearEntity(slots: Slots, id: string): Slots {
  return slots.filter((s) => s.id !== id);
}

// swapSlotId: replace one id with another in place, keeping the key (pending → real worktree stays put).
export function swapSlotId(slots: Slots, from: string, to: string): Slots {
  return slots.map((s) => (s.id === from ? { ...s, id: to } : s));
}

// swapSlots: swap two columns' array POSITIONS (each Slot keeps its own key+id). Keyed reconciliation
// then reorders the rendered columns without remounting their terminals. No-op if a key is missing/same.
export function swapSlots(slots: Slots, keyA: string, keyB: string): Slots {
  const i = slots.findIndex((s) => s.key === keyA);
  const j = slots.findIndex((s) => s.key === keyB);
  if (i === -1 || j === -1 || i === j) return slots;
  const next = slots.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// A scratch terminal: a session-only single-shell entity that can occupy a slot (no repo/branch).
export type ScratchTerminal = { id: string; title: string };

// A pending worktree: a session-only placeholder occupying a slot while deduce + create run in the
// background. Replaced in place by the real worktree on success; discarded on failure. `id` is `pending-*`.
export type PendingWorktree = {
  id: string;
  prompt: string;
  status: "deducing" | "creating";
  view: "cockpit" | "worktrees" | "calm";
};

// What a slot id resolves to: a worktree, a scratch terminal, a pending worktree, or nothing.
export type SlotEntity =
  | { kind: "worktree"; worktree: Worktree }
  | { kind: "scratch"; scratch: ScratchTerminal }
  | { kind: "pending"; pending: PendingWorktree }
  | null;

// resolveSlotEntity: look an id up as a worktree first, then scratch, then pending (ids never collide —
// `wt-*` / `scratch-*` / `pending-*`). `pending` defaults to [] so existing 3-arg callers still compile.
export function resolveSlotEntity(
  id: string | null,
  worktrees: Worktree[],
  scratch: ScratchTerminal[],
  pending: PendingWorktree[] = [],
): SlotEntity {
  if (!id) return null;
  const w = worktrees.find((x) => x.id === id);
  if (w) return { kind: "worktree", worktree: w };
  const s = scratch.find((x) => x.id === id);
  if (s) return { kind: "scratch", scratch: s };
  const p = pending.find((x) => x.id === id);
  if (p) return { kind: "pending", pending: p };
  return null;
}
