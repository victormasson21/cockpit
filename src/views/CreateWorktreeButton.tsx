// CreateWorktreeButton.tsx — the app-wide "turn this item into a worktree" affordance (tree glyph).
// On click it resolves the item's input (sync or async) and kicks off the shared deduce→create flow.
import { useState } from "react";
import type { MouseEvent } from "react";
import { useSettings } from "../settings/store";
import type { WorktreeSource } from "../worktrees/worktreeContext";
import "./CreateWorktreeButton.css";

type View = "cockpit" | "worktrees" | "calm";

export function CreateWorktreeButton({
  source, view, getInput, title = "Create worktree",
}: {
  source: WorktreeSource;
  view: View;
  getInput: () => string | Promise<string>;
  title?: string;
}) {
  const startDeduceWorktree = useSettings((s) => s.startDeduceWorktree);
  const [busy, setBusy] = useState(false);
  // Resolve the input (may be an async permalink fetch), then hand it to the shared flow.
  const onClick = async (e: MouseEvent) => {
    e.stopPropagation(); // don't trigger the row's own click (e.g. the Slack row opens the app)
    if (busy) return;
    setBusy(true);
    try {
      const input = (await getInput()).trim();
      if (input) startDeduceWorktree(input, view, source);
    } catch {
      /* swallow: e.g. permalink fetch failed — nothing to create from */
    }
    setBusy(false);
  };
  return (
    <button className="create-wt-btn" aria-label={title} title={title} disabled={busy} onClick={onClick}>
      <span className="create-wt-btn__ico" aria-hidden />
      <span className="create-wt-btn__label">Add</span>
    </button>
  );
}
