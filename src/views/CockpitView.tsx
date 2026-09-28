// CockpitView.tsx — dashboard view: left TILES column (Slack / PR reviews / Timer) + centre (Notepad | Diff tabs) + right To Do column.
import { useState } from "react";
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { PrReviewsTile } from "../tiles/pr/PrReviewsTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";
import { DiffView } from "./worktree-column/DiffView";
import { NotepadView } from "./notepad/NotepadView";
import { Dropdown } from "./Dropdown";
import { worktreeOption } from "./worktreeOption";
import { useSettings } from "../settings/store";

type Tab = "notepad" | "diff";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const worktrees = useSettings((s) => s.cockpit.worktrees);
  const [tab, setTab] = useState<Tab>("notepad"); // session-only; Notepad is the home tab
  // The Diff tab's worktree is picked here and lives only for the session.
  const [diffWorktreeId, setDiffWorktreeId] = useState<string | null>(null);
  const worktree = worktrees.find((w) => w.id === diffWorktreeId) ?? null;
  const pickerGroups = [{ options: worktrees.filter((w) => w.status === "ongoing").map(worktreeOption) }];
  // Lifted out of NotepadView so switching tabs (which unmounts it) does not forget a running pane.
  const [notepadClaudeDir, setNotepadClaudeDir] = useState<string | null>(null);

  const tabButton = (id: Tab, label: string) => (
    <button className={`cockpit-view__tab ${tab === id ? "cockpit-view__tab--active" : ""}`} onClick={() => setTab(id)}>{label}</button>
  );

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
          {tabButton("notepad", "Notepad")}
          {tabButton("diff", "Diff")}
          {tab === "diff" && (
            <Dropdown value={diffWorktreeId} onChange={setDiffWorktreeId} groups={pickerGroups} placeholder="Select a worktree…" variant="form" />
          )}
        </nav>
        {tab === "notepad" ? (
          <NotepadView claudeDir={notepadClaudeDir} onOpenClaude={setNotepadClaudeDir} onCloseClaude={() => setNotepadClaudeDir(null)} />
        ) : worktree ? (
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
