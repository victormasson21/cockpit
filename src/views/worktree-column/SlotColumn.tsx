// SlotColumn.tsx — one Worktrees-view column: picker + gear menu over a slot's entity body (a worktree or a scratch terminal).
import { useState } from "react";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { resolveSlotEntity } from "../slots";
import { GearIcon, CloseIcon, PauseIcon, BinIcon, GhostIcon, PinIcon } from "../icons";
import { Dropdown } from "../Dropdown";
import type { DropdownGroup } from "../dropdownModel";
import { WorktreeBody } from "./WorktreeBody";
import { ScratchBody } from "./ScratchBody";
import { PendingBody } from "./PendingBody";
import { TeardownConfirm } from "./TeardownConfirm";
import { killPanes, liveRoles } from "../../worktrees/paneLifecycle";
import "./WorktreeColumn.css";

export function SlotColumn({ value, onSelect, variant = "full", onPin, onClose }: { value: string | null; onSelect: (id: string | null) => void; variant?: "full" | "calm"; onPin?: (id: string) => void; onClose?: () => void }) {
  // One selector per field, deliberately: this column owns the terminals, so a bare useSettings() would
  // remount nothing but re-render the whole subtree on every unrelated store write.
  const worktrees = useSettings((s) => s.cockpit.worktrees);
  const scratchTerminals = useSettings((s) => s.scratchTerminals);
  const pendingWorktrees = useSettings((s) => s.pendingWorktrees);
  const removeScratch = useSettings((s) => s.removeScratch);
  const updateWorktree = useSettings((s) => s.updateWorktree);
  const renameScratch = useSettings((s) => s.renameScratch);
  const ongoing = worktrees.filter((w) => w.status === "ongoing");
  const activeId = value;
  const entity = resolveSlotEntity(activeId, worktrees, scratchTerminals, pendingWorktrees);
  const [menuOpen, setMenuOpen] = useState(false);
  // Delete/Wipe open a confirmation dialog (worktree only); state is local to each column instance.
  const [confirm, setConfirm] = useState<"delete" | "wipe" | null>(null);

  // Close removes the whole column when the host provides onClose (Worktrees/Calm reflow); otherwise it
  // just unassigns (Cockpit's single persistent column). Menu-driven removals funnel through here.
  const close = () => { setMenuOpen(false); (onClose ?? (() => onSelect(null)))(); };

  // Pause: kill the worktree's live processes and unassign the slot; keep model + dir + branch.
  // Also reset the pane set — a paused worktree comes back Claude-only (re-showing it must not
  // silently re-run the dev server).
  const pauseActive = async () => {
    if (entity?.kind !== "worktree") return;
    setMenuOpen(false);
    const id = entity.worktree.id;
    await killPanes(id, liveRoles(id));
    useSettings.getState().resetWorktreePanes(id);
    close();
  };

  // Scratch Delete: stop the single shell PTY, then drop the entity for good (removes it from the persisted scratch list; the store also clears the slot).
  const deleteScratch = async () => {
    if (entity?.kind !== "scratch") return;
    setMenuOpen(false);
    await killPanes(entity.scratch.id, ["shell"]);
    removeScratch(entity.scratch.id);
  };

  // Tint the column icon when this slot's attention-bearing pane (worktree's claude / scratch's shell) bells.
  const attnPtyId = entity?.kind === "worktree" ? makePtyId(entity.worktree.id, "claude")
    : entity?.kind === "scratch" ? makePtyId(entity.scratch.id, "shell") : null;
  const attention = useSettings((s) => (attnPtyId ? Boolean(s.attention[attnPtyId]) : false));
  const iconKind = entity?.kind === "scratch" ? "terminal" : "tree"; // scratch → terminal glyph; worktree & empty slots → tree.

  // Picker rows: clear-action + (synthetic pending) ungrouped, then Worktrees / Scratch groups.
  const pickerGroups: DropdownGroup[] = [
    { options: [
      { value: "", label: "Select…" },
      // A pending id isn't in the worktree/scratch lists — synthetic disabled row so the trigger reads sensibly.
      ...(entity?.kind === "pending" ? [{ value: entity.pending.id, label: `${entity.pending.status}…`, disabled: true }] : []),
    ]},
    // The repo basename rides as a `suffix` (rendered at a lighter weight) so each slot's origin is
    // obvious at a glance without competing with the title.
    { label: "Worktrees", options: ongoing.map((w) => ({ value: w.id, label: w.name, suffix: w.repoPath.split("/").pop() })) },
    ...(scratchTerminals.length > 0
      ? [{ label: "Scratch", options: scratchTerminals.map((s) => ({ value: s.id, label: s.title })) }]
      : []),
  ];

  // Rename wiring: worktree → persisted name; scratch → persisted title (the PTY still resets on restore); pending/empty → not editable.
  const editValue = entity?.kind === "worktree" ? entity.worktree.name
    : entity?.kind === "scratch" ? entity.scratch.title : undefined;
  const onRename = entity?.kind === "worktree" ? (t: string) => updateWorktree(entity.worktree.id, { name: t })
    : entity?.kind === "scratch" ? (t: string) => renameScratch(entity.scratch.id, t) : undefined;

  // The switcher = identity glyph + worktree dropdown. In calm mode over a worktree it's injected
  // into the Claude pane header (level with restart) instead of a standalone column header.
  const switcher = (
    <>
      <span className={`wt-col__icon wt-col__icon--${iconKind}${attention ? " wt-col__icon--attention" : ""}`} aria-hidden />
      <Dropdown
        value={activeId} onChange={(v) => onSelect(v || null)} groups={pickerGroups}
        placeholder="Select…" variant="heading" onRename={onRename} editValue={editValue}
      />
    </>
  );
  const calmWorktree = variant === "calm" && entity?.kind === "worktree";

  return (
    <div className={`wt-col${variant === "calm" ? " wt-col--calm" : ""}`}>
      {!calmWorktree && (
      <div className="wt-col__header">
        {switcher}
        {/* Calm mode is the decluttered view: switcher + Claude terminal only — no gear menu. */}
        {/* The gear shows on empty slots too (Close only); pending tiles get no menu. */}
        {variant !== "calm" && entity?.kind !== "pending" && (
          <div className="wt-col__menu">
            <button className="icon-btn wt-col__gear" aria-label="column settings" onClick={() => setMenuOpen((o) => !o)}><GearIcon /></button>
            {menuOpen && (
              <div className="wt-col__menu-pop" onMouseLeave={() => setMenuOpen(false)}>
                {/* Empty slot: only Close (removes the column). */}
                {!entity && <button onClick={close}><CloseIcon />Close</button>}
                {/* Pin sits above the teardown set: it adds an attachment (Cockpit column) + jumps there; unpin lives in Cockpit. */}
                {entity?.kind === "worktree" && onPin && (
                  <button onClick={() => { onPin(entity.worktree.id); setMenuOpen(false); }}><PinIcon />Cockpit</button>
                )}
                {/* Close ⊂ Pause ⊂ Delete ⊂ Wipe — each removes one more attached thing. Scratch has no git. */}
                {entity && <button onClick={close}><CloseIcon />Close</button>}
                {entity?.kind === "worktree" ? (
                  <>
                    <button onClick={pauseActive}><PauseIcon />Pause</button>
                    <button className="wt-col__danger" onClick={() => { setConfirm("delete"); setMenuOpen(false); }}><BinIcon />Delete</button>
                    <button className="wt-col__danger" onClick={() => { setConfirm("wipe"); setMenuOpen(false); }}><GhostIcon />Wipe</button>
                  </>
                ) : entity?.kind === "scratch" ? (
                  <button className="wt-col__danger" onClick={deleteScratch}><BinIcon />Delete</button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!entity ? (
        <div className="wt-col__empty">Nothing in this slot.</div>
      ) : entity.kind === "worktree" ? (
        // Key on the component (not a wrapper div) so the remount preserves the .wt-col → .wt-col__body flex chain.
        // calm: hand the switcher down so it renders inside the Claude pane header (no column header above).
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} switcher={calmWorktree ? switcher : undefined} />
      ) : entity.kind === "scratch" ? (
        <ScratchBody key={entity.scratch.id} scratchId={entity.scratch.id} />
      ) : (
        <PendingBody key={entity.pending.id} pending={entity.pending} />
      )}

      {confirm && entity?.kind === "worktree" && (
        <TeardownConfirm
          worktree={entity.worktree}
          action={confirm}
          onClose={() => setConfirm(null)}
          // removeWorktree (inside teardown) already clears the slot; onSelect(null) covers the
          // Cockpit single-column case too. Any non-fatal warning was already shown in the dialog.
          onDone={() => { setConfirm(null); close(); }}
        />
      )}
    </div>
  );
}
