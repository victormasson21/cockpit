// SlotColumn.tsx — one Worktrees-view column: picker + gear menu over a slot's entity body (a worktree or a scratch terminal).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { resolveSlotEntity } from "../slots";
import { GearIcon, CloseIcon, PauseIcon, BinIcon, GhostIcon } from "../icons";
import { WorktreeBody } from "./WorktreeBody";
import { ScratchBody } from "./ScratchBody";
import { TeardownConfirm } from "./TeardownConfirm";
import { killWorktreePtys } from "../../worktrees/teardown";
import "./WorktreeColumn.css";

export function SlotColumn({ value, onSelect, variant = "full" }: { value: string | null; onSelect: (id: string | null) => void; variant?: "full" | "calm" }) {
  const { cockpit, removeScratch, scratchTerminals } = useSettings();
  const ongoing = cockpit.worktrees.filter((w) => w.status === "ongoing");
  const activeId = value;
  const entity = resolveSlotEntity(activeId, cockpit.worktrees, scratchTerminals);
  const [menuOpen, setMenuOpen] = useState(false);
  // Delete/Wipe open a confirmation dialog (worktree only); state is local to each column instance.
  const [confirm, setConfirm] = useState<"delete" | "wipe" | null>(null);

  // Pause: kill the worktree's processes and unassign the slot; keep model + dir + branch (re-selectable).
  const pauseActive = async () => {
    if (entity?.kind !== "worktree") return;
    setMenuOpen(false);
    await killWorktreePtys(entity.worktree.id);
    onSelect(null);
  };

  // Scratch Delete: stop the single shell PTY, then drop the session-only entity (the store clears the slot).
  const deleteScratch = async () => {
    if (entity?.kind !== "scratch") return;
    setMenuOpen(false);
    await invoke("pty_kill", { ptyId: makePtyId(entity.scratch.id, "shell") });
    removeScratch(entity.scratch.id);
  };

  // Tint the column icon when this slot's attention-bearing pane (worktree's claude / scratch's shell) bells.
  const attnPtyId = entity?.kind === "worktree" ? makePtyId(entity.worktree.id, "claude")
    : entity?.kind === "scratch" ? makePtyId(entity.scratch.id, "shell") : null;
  const attention = useSettings((s) => (attnPtyId ? Boolean(s.attention[attnPtyId]) : false));
  const iconKind = entity?.kind === "scratch" ? "terminal" : "branch"; // scratch → terminal glyph; worktree & empty slots → branch.

  return (
    <div className="wt-col">
      <div className="wt-col__header">
        <span className={`wt-col__icon wt-col__icon--${iconKind}${attention ? " wt-col__icon--attention" : ""}`} aria-hidden />
        <div className="wt-col__picker-wrap">
          <select className="wt-col__picker" value={activeId ?? ""} onChange={(e) => onSelect(e.target.value || null)}>
            <option value="">Select…</option>
            <optgroup label="Worktrees">
              {ongoing.map((w) => {
                // Append the repo basename to the title so each slot's origin is obvious at a glance.
                const repo = w.repoPath.split("/").pop();
                return (<option key={w.id} value={w.id}>{repo ? `${w.name} · ${repo}` : w.name}</option>);
              })}
            </optgroup>
            {scratchTerminals.length > 0 && (
              <optgroup label="Scratch">
                {scratchTerminals.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
              </optgroup>
            )}
          </select>
          <span className="wt-col__caret" aria-hidden>⌄</span>
        </div>
        {entity && (
          <div className="wt-col__menu">
            <button className="icon-btn wt-col__gear" aria-label="column settings" onClick={() => setMenuOpen((o) => !o)}><GearIcon /></button>
            {menuOpen && (
              <div className="wt-col__menu-pop" onMouseLeave={() => setMenuOpen(false)}>
                {/* Close ⊂ Pause ⊂ Delete ⊂ Wipe — each removes one more attached thing. Scratch has no git. */}
                <button onClick={() => { onSelect(null); setMenuOpen(false); }}><CloseIcon />Close</button>
                {entity.kind === "worktree" ? (
                  <>
                    <button onClick={pauseActive}><PauseIcon />Pause</button>
                    <button className="wt-col__danger" onClick={() => { setConfirm("delete"); setMenuOpen(false); }}><BinIcon />Delete</button>
                    <button className="wt-col__danger" onClick={() => { setConfirm("wipe"); setMenuOpen(false); }}><GhostIcon />Wipe</button>
                  </>
                ) : (
                  <button className="wt-col__danger" onClick={deleteScratch}><BinIcon />Delete</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!entity ? (
        <div className="wt-col__empty">Nothing in this slot.</div>
      ) : entity.kind === "worktree" ? (
        // Key on the component (not a wrapper div) so the remount preserves the .wt-col → .wt-col__body flex chain.
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} />
      ) : (
        <ScratchBody key={entity.scratch.id} scratchId={entity.scratch.id} />
      )}

      {confirm && entity?.kind === "worktree" && (
        <TeardownConfirm
          worktree={entity.worktree}
          action={confirm}
          onClose={() => setConfirm(null)}
          // removeWorktree (inside teardown) already clears the slot; onSelect(null) covers the
          // Cockpit single-column case too. Any non-fatal warning was already shown in the dialog.
          onDone={() => { setConfirm(null); onSelect(null); }}
        />
      )}
    </div>
  );
}
