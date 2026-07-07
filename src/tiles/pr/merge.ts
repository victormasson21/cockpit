// merge.ts — pure list merge for the PR Reviews tile: new fetch results land at the top, deduped by PR url.
import type { PrReviewItem } from "../../settings/types";

// Prepend incoming (already newest-first from Slack) ahead of existing; a PR url already listed is
// kept as-is (the user's triage state wins over a re-request).
export function mergePrItems(existing: PrReviewItem[], incoming: PrReviewItem[]): PrReviewItem[] {
  const listed = new Set(existing.map((i) => i.url));
  const fresh = incoming.filter((i) => !listed.has(i.url));
  return fresh.length ? [...fresh, ...existing] : existing;
}
