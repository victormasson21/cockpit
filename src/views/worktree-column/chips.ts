// chips.ts — derive display chips for a worktree column from existing model data only (no live providers).
import type { Worktree, WorktreeLink } from "../../settings/types";

export type ChipKind = "linear" | "pr" | "issue" | "preview" | "ci";
export interface Chip { kind: ChipKind; label: string; url?: string }

// findLink: first link whose URL contains the needle (case-insensitive), for chip click-through.
function findLink(links: WorktreeLink[], needle: string): string | undefined {
  return links.find((l) => l.url.toLowerCase().includes(needle))?.url;
}

// worktreeChips: linear (from name) / pr / issue (from name+branch) / preview (from host) + a static CI stub.
export function worktreeChips(w: Worktree): Chip[] {
  const chips: Chip[] = [];

  // Canonical Linear ids are uppercase in the name (ENG-1234); searching the name avoids lowercase branch noise.
  const linear = w.name.match(/\b[A-Z]{2,}-\d+\b/);
  if (linear) chips.push({ kind: "linear", label: linear[0], url: findLink(w.links, "linear.app") });

  const hay = `${w.name} ${w.branch}`;
  const pr = hay.match(/\bpr-(\d+)\b/i);
  const issue = hay.match(/\bissue-(\d+)\b/i);
  if (pr) chips.push({ kind: "pr", label: `PR #${pr[1]}`, url: findLink(w.links, "/pull/") });
  else if (issue) chips.push({ kind: "issue", label: `Issue #${issue[1]}`, url: findLink(w.links, "/issues/") });

  if (w.host.address) {
    const port = w.host.address.match(/:(\d+)/);
    chips.push({ kind: "preview", label: port ? `Preview :${port[1]}` : "Preview", url: w.host.address });
  }

  chips.push({ kind: "ci", label: "CI" }); // stub: real CI integration deferred to a provider sub-project.
  return chips;
}
