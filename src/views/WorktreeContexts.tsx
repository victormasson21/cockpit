// WorktreeContexts.tsx — Settings pane: per-source text prepended to a worktree's initial Claude
// prompt when it is created from that part of the app.
import { useSettings } from "../settings/store";
import { DEFAULT_CONTEXTS } from "../worktrees/worktreeContext";
import type { WorktreeSource } from "../worktrees/worktreeContext";

const SOURCES: { source: WorktreeSource; label: string }[] = [
  { source: "pr-review", label: "PR reviews" },
  { source: "todo", label: "To Do items" },
  { source: "slack", label: "Slack messages" },
];

export function WorktreeContexts() {
  const contexts = useSettings((s) => s.cockpit.worktreeContexts);
  const setWorktreeContext = useSettings((s) => s.setWorktreeContext);
  return (
    <div className="wt-ctx">
      <p className="wt-ctx__hint">
        Prepended to the initial Claude prompt when you create a worktree from that part of the app.
      </p>
      {SOURCES.map(({ source, label }) => (
        <label key={source} className="wt-ctx__field">
          <span className="wt-ctx__label">{label}</span>
          <textarea
            className="wt-ctx__input"
            rows={2}
            value={contexts?.[source] ?? DEFAULT_CONTEXTS[source] ?? ""}
            onChange={(e) => setWorktreeContext(source, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
