// CockpitView.tsx — dashboard view: left TILES column (Slack today) + center placeholder. Worktree column lands later.
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
      </aside>
      <div className="cockpit-view__center">
        <div className="cockpit-view__card">
          <h2>Cockpit</h2>
          <p>To-do / timer / tickets land here in a later sub-project.</p>
        </div>
      </div>
    </div>
  );
}
