// activity.ts — pure derivation of an entity's *runtime* state for the slot picker: is it on screen,
// alive off screen, or stopped. Deliberately NOT the persisted `Worktree.status` field (which is
// reserved for a ticket-shaped lifecycle: in progress / on hold / PR'd / …) — this is session truth,
// recomputed on demand from the slots and the live PTY registry, and never written to disk.
export type Activity = "displayed" | "running" | "paused";

// displayed wins over running: a worktree on screen is also alive, and "where is it" is the more
// useful answer. paused therefore covers both an explicit Pause and never-opened-this-session —
// both mean nothing of yours is burning CPU.
export function activityOf(
  entityId: string,
  { displayedIds, livePtyIds }: { displayedIds: (string | null | undefined)[]; livePtyIds: string[] },
): Activity {
  if (displayedIds.includes(entityId)) return "displayed";
  // Prefix match on the id format's separator, so "wt-1" never matches "wt-10:claude".
  const prefix = `${entityId}:`;
  return livePtyIds.some((id) => id.startsWith(prefix)) ? "running" : "paused";
}
