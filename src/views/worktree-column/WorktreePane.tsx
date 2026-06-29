// WorktreePane.tsx — one themed terminal pane: header (icon + title + badge slot + restart + chevron collapse) over a PTY-bound xterm.
import { useState, type ReactNode } from "react";
import { useTerminal, type UseTerminalArgs } from "../../worktrees/useTerminal";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { RestartIcon, ChevronIcon } from "../icons";
import "./WorktreePane.css";

export function WorktreePane({ title, icon, badge, ...args }: UseTerminalArgs & { title: string; icon?: ReactNode; badge?: ReactNode }) {
  const { containerRef, restart } = useTerminal(args);
  const [open, setOpen] = useState(true); // default: all panes open
  // Live "needs attention" state for this pane (set by useTerminal on a terminal bell).
  const ptyId = makePtyId(args.worktreeId, args.role);
  const needsAttention = useSettings((s) => Boolean(s.attention[ptyId]));
  return (
    <div className={`wt-pane ${open ? "wt-pane--open" : "wt-pane--closed"}${needsAttention ? " wt-pane--attention" : ""}`}>
      <div className="wt-pane__header">
        {icon}
        <span className="wt-pane__title">{title}</span>
        {needsAttention && <span className="wt-attention">Attention</span>}
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
