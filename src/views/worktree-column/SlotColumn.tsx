// SlotColumn.tsx — one Worktrees-view column: picker + gear menu over a slot's entity body (a worktree or a scratch terminal).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { resolveSlotEntity } from "../slots";
import { WorktreeBody } from "./WorktreeBody";
import { ScratchBody } from "./ScratchBody";
import "./WorktreeColumn.css";

const WORKTREE_ROLES = ["git", "host", "claude"] as const;

export function SlotColumn({ slotIndex, variant = "full" }: { slotIndex: number; variant?: "full" | "calm" }) {
  const { cockpit, slots, setSlot, removeWorktree, removeScratch, scratchTerminals } = useSettings();
  const ongoing = cockpit.worktrees.filter((w) => w.status === "ongoing");
  const activeId = slots[slotIndex];
  const entity = resolveSlotEntity(activeId, cockpit.worktrees, scratchTerminals);
  const [menuOpen, setMenuOpen] = useState(false);

  // deleteActive: stop the entity's PTY(s), then drop the model (the store also clears it from this slot).
  const deleteActive = async () => {
    if (!entity) return;
    setMenuOpen(false);
    if (entity.kind === "worktree") {
      for (const role of WORKTREE_ROLES) await invoke("pty_kill", { ptyId: makePtyId(entity.worktree.id, role) });
      removeWorktree(entity.worktree.id);
    } else {
      await invoke("pty_kill", { ptyId: makePtyId(entity.scratch.id, "shell") });
      removeScratch(entity.scratch.id);
    }
  };

  const attention = false; // stub: live "Claude is calling" detection deferred to a provider sub-project.

  return (
    <div className="wt-col">
      <div className="wt-col__header">
        <span className={attention ? "wt-col__dot wt-col__dot--attention" : "wt-col__dot"} />
        <div className="wt-col__picker-wrap">
          <select className="wt-col__picker" value={activeId ?? ""} onChange={(e) => setSlot(slotIndex, e.target.value || null)}>
            <option value="">Select…</option>
            <optgroup label="Worktrees">
              {ongoing.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
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

      {!entity ? (
        <div className="wt-col__empty">Nothing in this slot.</div>
      ) : entity.kind === "worktree" ? (
        // Key on the component (not a wrapper div) so the remount preserves the .wt-col → .wt-col__body flex chain.
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} />
      ) : (
        <ScratchBody key={entity.scratch.id} scratchId={entity.scratch.id} />
      )}
    </div>
  );
}
