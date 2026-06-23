// WorktreeColumn.tsx — one Worktrees-view column: a slot showing a chosen worktree (picker + gear menu + chips + panes + links).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";
import "./WorktreeColumn.css";

const ROLES = ["git", "host", "claude"] as const;

export function WorktreeColumn({ slotIndex, variant = "full" }: { slotIndex: number; variant?: "full" | "calm" }) {
  const { cockpit, slots, setSlot, removeWorktree } = useSettings();
  const ongoing = cockpit.worktrees.filter((w) => w.status === "ongoing");
  const active = cockpit.worktrees.find((w) => w.id === slots[slotIndex]);
  const [menuOpen, setMenuOpen] = useState(false);

  // delete: stop the worktree's 3 PTYs, then drop the model (the store also clears it from this slot).
  const deleteActive = async () => {
    if (!active) return;
    setMenuOpen(false);
    for (const role of ROLES) await invoke("pty_kill", { ptyId: makePtyId(active.id, role) });
    removeWorktree(active.id);
  };

  const attention = false; // stub: live "Claude is calling" detection deferred to a provider sub-project.

  return (
    <div className="wt-col">
      <div className="wt-col__header">
        <span className={attention ? "wt-col__dot wt-col__dot--attention" : "wt-col__dot"} />
        {/* The dropdown title IS the per-slot worktree picker. */}
        <select className="wt-col__picker" value={active?.id ?? ""} onChange={(e) => setSlot(slotIndex, e.target.value || null)}>
          <option value="">Select worktree</option>
          {ongoing.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
        </select>
        {active && (
          <div className="wt-col__menu">
            <button className="wt-col__gear" aria-label="column settings" onClick={() => setMenuOpen((o) => !o)}>⚙</button>
            {menuOpen && (
              <div className="wt-col__menu-pop" onMouseLeave={() => setMenuOpen(false)}>
                <button onClick={() => { setSlot(slotIndex, null); setMenuOpen(false); }}>Hide</button>
                <button className="wt-col__danger" onClick={deleteActive}>Delete</button>
              </div>
            )}
          </div>
        )}
      </div>

      {!active ? (
        <div className="wt-col__empty">No worktree in this slot.</div>
      ) : (
        // Re-keyed by active.id: switching the picker remounts panes (detach old, attach new) without killing PTYs.
        <div className="wt-col__body" key={active.id}>
          {variant === "full" && (
            <>
              <div className="wt-col__chips">
                {worktreeChips(active).map((c, i) => (
                  <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="wt-col__path">
                {active.repoPath.split("/").pop()} · {active.branch} · {active.worktreePath}
              </div>
            </>
          )}
          <div className="wt-col__panes">
            {variant === "full" && (
              <>
                <WorktreePane title="localhost" worktreeId={active.id} role="host" cwd={active.worktreePath} autostartCmd={active.host.startCmd} />
                <WorktreePane title="git" worktreeId={active.id} role="git" cwd={active.worktreePath} />
              </>
            )}
            <WorktreePane
              title="Claude Code" worktreeId={active.id} role="claude" cwd={active.worktreePath} autostartCmd="claude"
              badge={attention ? <span className="wt-attention">Attention</span> : null}
            />
          </div>
          {variant === "full" && <LinksList worktreeId={active.id} links={active.links} />}
        </div>
      )}
    </div>
  );
}
