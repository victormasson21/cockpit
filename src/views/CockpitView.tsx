// CockpitView.tsx — dashboard view: left TILES column (Slack / PR reviews / Timer) + center (Home widgets | Diff tab) + right worktree column.
import { useState } from "react";
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { PrReviewsTile } from "../tiles/pr/PrReviewsTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";
import { SlotColumn } from "./worktree-column/SlotColumn";
import { DiffView } from "./worktree-column/DiffView";
import { useSettings } from "../settings/store";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const cockpitWorktreeId = useSettings((s) => s.cockpit.cockpitWorktreeId ?? null);
  const setCockpitWorktree = useSettings((s) => s.setCockpitWorktree);
  // The Diff tab reflects the right column's worktree; scratch/empty selections have no diff.
  const worktree = useSettings((s) => s.cockpit.worktrees.find((w) => w.id === cockpitWorktreeId) ?? null);
  const [tab, setTab] = useState<"home" | "diff">("home"); // session-only, defaults to Home

  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
        <PrReviewsTile onOpenSettings={onOpenSettings} />
        <TimerTile />
      </aside>
      <div className="cockpit-view__main">
        {/* Home | Diff tabs — Home shows the local widgets, Diff swaps in the worktree's branch diff. */}
        <nav className="cockpit-view__tabs">
          <button className={`cockpit-view__tab ${tab === "home" ? "cockpit-view__tab--active" : ""}`} onClick={() => setTab("home")}>Home</button>
          <button className={`cockpit-view__tab ${tab === "diff" ? "cockpit-view__tab--active" : ""}`} onClick={() => setTab("diff")}>Diff</button>
        </nav>
        {tab === "home" ? (
          <div className="cockpit-view__center">
            <TodoTile />
          </div>
        ) : worktree ? (
          // Re-keyed by id so switching the right-column worktree refetches from scratch.
          <DiffView key={worktree.id} worktree={worktree} />
        ) : (
          <div className="cockpit-view__diff-empty">Select a worktree in the right column to see its diff.</div>
        )}
      </div>
      <aside className="cockpit-view__worktree">
        <SlotColumn value={cockpitWorktreeId} onSelect={setCockpitWorktree} />
      </aside>
    </div>
  );
}
