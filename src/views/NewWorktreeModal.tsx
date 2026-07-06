// NewWorktreeModal.tsx — one unified "New" panel: deduce (prompt), existing-branch checkout, and a scratch terminal.
import { Modal } from "./Modal";
import { NewWorktreeForm } from "../tiles/worktree/NewWorktreeForm";
import { ExistingBranchForm } from "../tiles/worktree/ExistingBranchForm";
import { useSettings } from "../settings/store";

// A section heading: the same masked-PNG glyph the slot columns use (wt-ico--*) + a bold label.
function SectionHeading({ icon, label }: { icon: "claude" | "branch" | "terminal"; label: string }) {
  return (
    <div className="nw-modal__heading">
      <span className={`wt-ico wt-ico--${icon}`} aria-hidden />
      {label}
    </div>
  );
}

export function NewWorktreeModal({ view, onClose }: { view: "cockpit" | "worktrees" | "calm"; onClose: () => void }) {
  const { placeNewEntity, addScratch } = useSettings();
  // Existing-branch create: place the new worktree in a slot, then close.
  const created = (id: string) => { placeNewEntity(id, view); onClose(); };
  // Terminal: spin up a scratch shell in a slot (same wiring as the old top-nav Terminal button), then close.
  const newTerminal = () => { placeNewEntity(addScratch(), view); onClose(); };
  return (
    <Modal title="New worktree" onClose={onClose}>
      {/* Deduce: free-text prompt → instant background create (closes on submit). */}
      <SectionHeading icon="claude" label="Deduce" />
      <NewWorktreeForm view={view} onClose={onClose} />
      <hr className="nw-modal__sep" />
      {/* Existing branch: pick a known repo + one of its branches to check out. */}
      <SectionHeading icon="branch" label="Checkout" />
      <ExistingBranchForm onCreated={created} />
      <hr className="nw-modal__sep" />
      {/* Scratch terminal: a session-only login shell, no repo/branch. */}
      <SectionHeading icon="terminal" label="Terminal" />
      <button className="nw-modal__terminal" onClick={newTerminal}>Create</button>
    </Modal>
  );
}
