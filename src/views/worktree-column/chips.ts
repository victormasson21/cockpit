// chips.ts — derive display chips for a worktree column from existing model data only (no live providers).
import type { Worktree, WorktreeLink } from "../../settings/types";

export type ChipKind = "linear" | "pr" | "issue" | "localhost";
export interface Chip { kind: ChipKind; label: string; url?: string }

// findLink: first link whose URL contains the needle (case-insensitive), for chip click-through.
function findLink(links: WorktreeLink[], needle: string): string | undefined {
  return links.find((l) => l.url.toLowerCase().includes(needle))?.url;
}

// worktreeChips: linear (from branch ref + linear.app link) / pr / issue (from name+branch) / localhost (from host.address).
export function worktreeChips(w: Worktree): Chip[] {
  const chips: Chip[] = [];

  // Linear detection is rename-robust: the name is user-editable, so read the immutable branch ref
  // (e.g. eng-1234-…) and/or a linear.app link. Exclude pr-/issue- prefixes so those aren't misread.
  const linearLink = findLink(w.links, "linear.app");
  const branchRef = w.branch.match(/\b([a-z]{2,})-\d+\b/i);
  const branchIsLinear = branchRef !== null && !["pr", "issue"].includes(branchRef[1].toLowerCase());
  if (linearLink || branchIsLinear) chips.push({ kind: "linear", label: "Linear", url: linearLink });

  const hay = `${w.name} ${w.branch}`;
  const pr = hay.match(/\bpr-(\d+)\b/i);
  const issue = hay.match(/\bissue-(\d+)\b/i);
  if (pr) chips.push({ kind: "pr", label: `PR #${pr[1]}`, url: findLink(w.links, "/pull/") });
  else if (issue) chips.push({ kind: "issue", label: `Issue #${issue[1]}`, url: findLink(w.links, "/issues/") });

  // localhost: opens host.address — the same dev URL the host terminal serves below.
  if (w.host.address) {
    const port = w.host.address.match(/:(\d+)/);
    chips.push({ kind: "localhost", label: port ? `localhost:${port[1]}` : "localhost", url: w.host.address });
  }

  return chips;
}
