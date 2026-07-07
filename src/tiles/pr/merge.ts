// merge.ts — pure list merge for the PR Reviews tile: new fetch results land at the top, deduped by PR url.
import type { PrReviewItem } from "../../settings/types";

// Prepend incoming (already newest-first from Slack) ahead of existing; a PR url already listed —
// or already seen earlier in this batch — is dropped (the first/newest mention wins).
export function mergePrItems(existing: PrReviewItem[], incoming: PrReviewItem[]): PrReviewItem[] {
  const seen = new Set(existing.map((i) => i.url));
  const fresh = incoming.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
  return fresh.length ? [...fresh, ...existing] : existing;
}
