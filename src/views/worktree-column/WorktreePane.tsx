// WorktreePane.tsx — one themed terminal pane: header (icon + title + badge slot + restart + close + expand + chevron collapse) over a PTY-bound xterm.
import { useEffect, useState, type ReactNode } from "react";
import { useTerminal, type UseTerminalArgs } from "../../worktrees/useTerminal";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { RestartIcon, CloseIcon, ChevronIcon, ExpandIcon } from "../icons";
import "./WorktreePane.css";

type PaneChrome = {
  title: string;
  icon?: ReactNode;
  // Replaces icon+title at the start of the header (calm mode injects the worktree switcher here,
  // so the dropdown sits level with the restart button and the "Claude Code" label is gone).
  lead?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode; // extra header control (e.g. the claude pane's copy-prompt button)
  // Controlled open-state (WorktreeBody coordinates sibling panes for expand); omitted → self-managed.
  open?: boolean;
  onToggle?: () => void;
  onExpand?: () => void; // expand = open me, collapse my siblings; button only shown when provided
  // Overrides the built-in close (kill + respawn bare). Removable panes (host/extras) pass a
  // handler that kills the PTY and removes the pane from the column instead.
  onClose?: () => void;
};

export function WorktreePane({ title, icon, lead, badge, action, open: openProp, onToggle, onExpand, onClose, ...args }: UseTerminalArgs & PaneChrome) {
  const { containerRef, restart, close } = useTerminal(args);
  // "Keystrokes land here": true while focus is inside this pane's terminal body. Local state, not
  // the store — unlike attention (a bell in a background pane is read by SlotColumn), focus has no
  // remote consumer and the DOM already guarantees at most one focused pane.
  const [focused, setFocused] = useState(false);
  // Native focusin/focusout on the terminal container: the focus target is xterm's helper textarea,
  // created imperatively inside this div rather than by React. Scoped to the body, not the card, so
  // clicking a header button doesn't light the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onIn = () => setFocused(true);
    const onOut = () => setFocused(false);
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
    };
  }, [containerRef]);
  const [openLocal, setOpenLocal] = useState(true); // default: all panes open
  const open = openProp ?? openLocal;
  const toggle = onToggle ?? (() => setOpenLocal((o) => !o));
  // Live "needs attention" state for this pane (set by useTerminal on a terminal bell).
  const ptyId = makePtyId(args.worktreeId, args.role);
  const needsAttention = useSettings((s) => Boolean(s.attention[ptyId]));
  return (
    <div className={`wt-pane ${open ? "wt-pane--open" : "wt-pane--closed"}${focused ? " wt-pane--focused" : ""}${needsAttention ? " wt-pane--attention" : ""}`}>
      <div className="wt-pane__header">
        {lead ?? (<>{icon}<span className="wt-pane__title">{title}</span></>)}
        {needsAttention && <span className="wt-attention">Attention</span>}
        {badge}
        {action}
        <button className="icon-btn wt-pane__restart" title="restart" onClick={restart}><RestartIcon /></button>
        <button className="icon-btn wt-pane__close" title="close" aria-label="close process" onClick={onClose ?? close}><CloseIcon /></button>
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
      <div ref={containerRef} className="wt-pane__body" data-pty-id={ptyId} />
    </div>
  );
}
