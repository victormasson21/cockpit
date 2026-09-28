// CockpitView.tsx — dashboard view: left TILES column (Slack / PR reviews / Timer) + centre (Diff tab) + right To Do column.
import { useState } from "react";
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { PrReviewsTile } from "../tiles/pr/PrReviewsTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";
import { DiffView } from "./worktree-column/DiffView";
import { Dropdown } from "./Dropdown";
import { worktreeOption } from "./worktreeOption";
import { useSettings } from "../settings/store";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const worktrees = useSettings((s) => s.cockpit.worktrees);
  // The Diff tab's worktree is picked here and lives only for the session.
  const [diffWorktreeId, setDiffWorktreeId] = useState<string | null>(null);
  const worktree = worktrees.find((w) => w.id === diffWorktreeId) ?? null;
  const pickerGroups = [{ options: worktrees.filter((w) => w.status === "ongoing").map(worktreeOption) }];

  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
        <PrReviewsTile onOpenSettings={onOpenSettings} />
        <TimerTile />
      </aside>
      <div className="cockpit-view__main">
        <nav className="cockpit-view__tabs">
          <button className="cockpit-view__tab cockpit-view__tab--active">Diff</button>
          <Dropdown value={diffWorktreeId} onChange={setDiffWorktreeId} groups={pickerGroups} placeholder="Select a worktree…" variant="form" />
        </nav>
        {worktree ? (
          // Re-keyed by id so switching worktree refetches from scratch.
          <DiffView key={worktree.id} worktree={worktree} />
        ) : (
          <div className="cockpit-view__diff-empty">Select a worktree to see its diff.</div>
        )}
      </div>
      <aside className="cockpit-view__todo">
        <TodoTile />
      </aside>
    </div>
  );
}
