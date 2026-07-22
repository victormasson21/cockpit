// worktreeContext.ts — per-source context templates prepended to a worktree's initial Claude
// prompt (step 2 only; never the deduce/routing input). Pure, no IO.

export type WorktreeSource = "manual" | "slack" | "todo" | "pr-review";

// Shipped defaults; a configured value (including "") overrides these.
export const DEFAULT_CONTEXTS: Record<string, string> = {
  "pr-review": "use the /code-review tool to review this PR",
  todo: "use the /brainstorming tool to plan implementation",
};

// The active context for a source: the configured value if the key exists (empty string included,
// so a deliberately-cleared field wins over the default), else the shipped default, else "".
export function effectiveContext(source: WorktreeSource, contexts: Record<string, string> | undefined): string {
  return contexts?.[source] ?? DEFAULT_CONTEXTS[source] ?? "";
}
