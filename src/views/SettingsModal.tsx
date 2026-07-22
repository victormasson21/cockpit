// SettingsModal.tsx — Settings panel: a left nav rail switches between self-contained panes (Slack, Known repos).
// A pane registry keeps adding the Nth integration pane a one-line append (matches the app's extensible-panel ethos).
import { useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { SlackConnections } from "../tiles/slack/SlackConnections";
import { KnownReposEditor } from "./KnownReposEditor";
import { WorktreeContexts } from "./WorktreeContexts";
import "./SettingsModal.css";

// One entry per settings pane: nav label + what to render on the right.
const PANES: { id: string; label: string; render: () => ReactNode }[] = [
  { id: "slack", label: "Slack", render: () => <SlackConnections /> },
  { id: "repos", label: "Known repos", render: () => <KnownReposEditor /> },
  { id: "worktree-contexts", label: "Worktree contexts", render: () => <WorktreeContexts /> },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(PANES[0].id);
  const pane = PANES.find((p) => p.id === active) ?? PANES[0];

  return (
    <Modal title="Settings" onClose={onClose} className="modal__panel--wide">
      <div className="settings">
        <nav className="settings__nav">
          {PANES.map((p) => (
            <button
              key={p.id}
              className={`settings__nav-item${p.id === active ? " settings__nav-item--active" : ""}`}
              onClick={() => setActive(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="settings__pane">{pane.render()}</div>
      </div>
    </Modal>
  );
}
