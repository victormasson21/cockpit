// WorktreePane.tsx — one themed terminal pane: header (icon + title + badge slot + restart + chevron collapse) over a PTY-bound xterm.
import { useState, type ReactNode } from "react";
import { useTerminal, type UseTerminalArgs } from "../../worktrees/useTerminal";
import { RestartIcon, ChevronIcon } from "../icons";
import "./WorktreePane.css";

export function WorktreePane({ title, icon, badge, ...args }: UseTerminalArgs & { title: string; icon?: ReactNode; badge?: ReactNode }) {
  const { containerRef, restart } = useTerminal(args);
  const [open, setOpen] = useState(true); // default: all panes open
  return (
    <div className={`wt-pane ${open ? "wt-pane--open" : "wt-pane--closed"}`}>
      <div className="wt-pane__header">
        {icon}
        <span className="wt-pane__title">{title}</span>
        {badge}
        <button className="icon-btn wt-pane__restart" title="restart" onClick={restart}><RestartIcon /></button>
        <button className="icon-btn wt-pane__chevron" aria-label={open ? "collapse" : "expand"} onClick={() => setOpen((o) => !o)}>
          <ChevronIcon open={open} />
        </button>
      </div>
      {/* Kept mounted when collapsed (CSS hides it) so useTerminal's ResizeObserver re-fits + pty_resizes on expand. */}
      <div ref={containerRef} className="wt-pane__body" />
    </div>
  );
}
