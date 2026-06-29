// CockpitView.tsx — dashboard view: left TILES column (Slack) + center local widgets + right worktree column.
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";
import { SlotColumn } from "./worktree-column/SlotColumn";
import { useSettings } from "../settings/store";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const cockpitWorktreeId = useSettings((s) => s.cockpit.cockpitWorktreeId ?? null);
  const setCockpitWorktree = useSettings((s) => s.setCockpitWorktree);
  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
      </aside>
      <div className="cockpit-view__center">
        <TodoTile />
        <TimerTile />
      </div>
      <aside className="cockpit-view__worktree">
        <SlotColumn value={cockpitWorktreeId} onSelect={setCockpitWorktree} />
      </aside>
    </div>
  );
}
