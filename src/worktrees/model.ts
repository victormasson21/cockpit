// model.ts — pure helpers for worktree domain data (creation defaults + immutable link editing + deduction link). No IO.
import type { KnownRepo, Worktree, WorktreeLink } from "../settings/types";
import type { DeducedWorktree, BranchSpec, WorktreePr } from "./api";

// Build a worktree model from resolved fields, applying defaults (ongoing, no links).
export function makeWorktree(
  fields: Omit<Worktree, "status" | "links"> & Partial<Pick<Worktree, "status" | "links">>,
): Worktree {
  return { status: "ongoing", links: [], ...fields };
}

// The start command to actually run, falling back to the repo's saved default when the worktree has none.
// `worktree.host` is only ever a snapshot taken at creation (deduce/checkout) and no UI edits it afterwards,
// so a default saved after a worktree existed would otherwise never reach it — the Run button stayed dead.
export function resolveStartCmd(worktree: Worktree, knownRepos: KnownRepo[]): string {
  const own = worktree.host.startCmd.trim();
  if (own) return own;
  return (knownRepos.find((r) => r.path === worktree.repoPath)?.host?.startCmd ?? "").trim();
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

// Recognise a GitHub PR url. Shared by the link label below and the chips row's glyph choice.
export function isGithubPrUrl(url: string): boolean {
  return /github\.com\/.+\/pull\/\d/i.test(url);
}

// Build the worktree link to attach from a deduction, or null when no source was resolved.
export function sourceLinkFrom(d: DeducedWorktree): WorktreeLink | null {
  if (!d.sourceUrl) return null;
  // A PR's fetched title is long and the PR chip already sits beside it — label it by kind instead.
  if (isGithubPrUrl(d.sourceUrl)) return { label: "Github: PR", url: d.sourceUrl };
  return { label: d.sourceTitle || d.sourceUrl, url: d.sourceUrl };
}

// Build the link to add for a detected PR, or null if a link with that URL already exists (dedupe).
export function prLinkToAdd(links: WorktreeLink[], pr: WorktreePr): WorktreeLink | null {
  if (links.some((l) => l.url === pr.url)) return null;
  return { label: `PR #${pr.number}`, url: pr.url };
}

// Default editable-field values for a fresh new-worktree form (single source for init + reset).
export const FORM_DEFAULTS = {
  name: "", repoPath: "", mode: "new" as "existing" | "new",
  branch: "", base: "main", startCmd: "npm run dev", address: "http://localhost:3000",
};

// Build the git BranchSpec from form state: a deduced PR (prNumber > 0) checks out the PR;
// otherwise an existing or new branch per the mode.
export function branchSpecFrom(opts: {
  prNumber: number; mode: "existing" | "new"; branch: string; base: string;
}): BranchSpec {
  if (opts.prNumber > 0) return { kind: "pr", number: opts.prNumber, branch: opts.branch };
  if (opts.mode === "existing") return { kind: "existing", branch: opts.branch };
  return { kind: "new", branch: opts.branch, base: opts.base };
}
