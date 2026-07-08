// WorktreePane.tsx — one themed terminal pane: header (icon + title + badge slot + restart + close + expand + chevron collapse) over a PTY-bound xterm.
import { useState, type ReactNode } from "react";
import { useTerminal, type UseTerminalArgs } from "../../worktrees/useTerminal";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { RestartIcon, CloseIcon, ChevronIcon, ExpandIcon } from "../icons";
import "./WorktreePane.css";

type PaneChrome = {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode; // extra header control (e.g. the claude pane's copy-prompt button)
  // Controlled open-state (WorktreeBody coordinates sibling panes for expand); omitted → self-managed.
  open?: boolean;
  onToggle?: () => void;
  onExpand?: () => void; // expand = open me, collapse my siblings; button only shown when provided
};

export function WorktreePane({ title, icon, badge, action, open: openProp, onToggle, onExpand, ...args }: UseTerminalArgs & PaneChrome) {
  const { containerRef, restart, close } = useTerminal(args);
  const [openLocal, setOpenLocal] = useState(true); // default: all panes open
  const open = openProp ?? openLocal;
  const toggle = onToggle ?? (() => setOpenLocal((o) => !o));
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
        {action}
        <button className="icon-btn wt-pane__restart" title="restart" onClick={restart}><RestartIcon /></button>
        <button className="icon-btn wt-pane__close" title="close" aria-label="close process" onClick={close}><CloseIcon /></button>
        {onExpand && (
          <button className="icon-btn wt-pane__expand" title="expand" aria-label="expand pane" onClick={onExpand}>
            <ExpandIcon />
          </button>
        )}
        <button className="icon-btn wt-pane__chevron" aria-label={open ? "collapse" : "open"} onClick={toggle}>
          <ChevronIcon open={open} />
        </button>
      </div>
      {/* Kept mounted when collapsed (CSS hides it) so useTerminal's ResizeObserver re-fits + pty_resizes on expand. */}
      <div ref={containerRef} className="wt-pane__body" />
    </div>
  );
}
