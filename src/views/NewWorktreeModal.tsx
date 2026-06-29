// NewWorktreeModal.tsx — hosts the two repo-based create flows (deduce | existing branch) behind a mode toggle.
import { useState } from "react";
import { Modal } from "./Modal";
import { NewWorktreeForm } from "../tiles/worktree/NewWorktreeForm";
import { ExistingBranchForm } from "../tiles/worktree/ExistingBranchForm";
import { useSettings } from "../settings/store";

type Mode = "deduce" | "existing";

export function NewWorktreeModal({ initialMode = "deduce", onClose }: { initialMode?: Mode; onClose: () => void }) {
  // TODO(Task 5): thread the real active view via prop; "worktrees" is a temporary shim so the build stays green.
  const { placeNewEntity } = useSettings();
  const [mode, setMode] = useState<Mode>(initialMode);
  const created = (id: string) => { placeNewEntity(id, "worktrees"); onClose(); };
  return (
    <Modal title="New worktree" onClose={onClose}>
      {/* Mode toggle — the header button sets the initial mode; this lets the user switch without reopening. */}
      <div className="nw-modal__modes">
        <button className={mode === "deduce" ? "nw-modal__mode nw-modal__mode--active" : "nw-modal__mode"} onClick={() => setMode("deduce")}>Deduce</button>
        <button className={mode === "existing" ? "nw-modal__mode nw-modal__mode--active" : "nw-modal__mode"} onClick={() => setMode("existing")}>Existing branch</button>
      </div>
      {mode === "deduce"
        ? <NewWorktreeForm onCreated={created} />
        : <ExistingBranchForm onCreated={created} />}
    </Modal>
  );
}
