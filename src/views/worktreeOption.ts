// worktreeOption.ts — the picker row a worktree becomes, shared by every dropdown that lists worktrees.
import type { Worktree } from "../settings/types";
import type { DropdownOption } from "./dropdownModel";

// The repo basename rides as a `suffix` (rendered at a lighter weight) so a worktree's origin is
// obvious at a glance without competing with the title.
export function worktreeOption(w: Worktree): DropdownOption {
  return { value: w.id, label: w.name, suffix: w.repoPath.split("/").pop() };
}
