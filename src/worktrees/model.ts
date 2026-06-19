// model.ts — pure helpers for worktree domain data (creation defaults + immutable link editing + deduction link). No IO.
import type { Worktree, WorktreeLink } from "../settings/types";
import type { DeducedWorktree } from "./api";

// Build a worktree model from resolved fields, applying defaults (ongoing, no links).
export function makeWorktree(
  fields: Omit<Worktree, "status" | "links"> & Partial<Pick<Worktree, "status" | "links">>,
): Worktree {
  return { status: "ongoing", links: [], ...fields };
}

// Append a link (returns a new array).
export function addLink(links: WorktreeLink[], link: WorktreeLink): WorktreeLink[] {
  return [...links, link];
}

// Patch the link at index i (returns a new array).
export function updateLink(links: WorktreeLink[], i: number, patch: Partial<WorktreeLink>): WorktreeLink[] {
  return links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
}

// Remove the link at index i (returns a new array).
export function removeLink(links: WorktreeLink[], i: number): WorktreeLink[] {
  return links.filter((_, idx) => idx !== i);
}

// Build the worktree link to attach from a deduction, or null when no source was resolved.
export function sourceLinkFrom(d: DeducedWorktree): WorktreeLink | null {
  if (!d.sourceUrl) return null;
  return { label: d.sourceTitle || d.sourceUrl, url: d.sourceUrl };
}
