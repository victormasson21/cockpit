// CockpitView.tsx — dashboard view: left TILES column (Slack) + center local widgets (To Do, Timer). Worktree column lands later.
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
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
    </div>
  );
}
