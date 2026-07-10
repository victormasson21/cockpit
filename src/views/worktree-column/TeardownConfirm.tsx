// TeardownConfirm.tsx — Delete/Wipe confirmation: probes the worktree for uncommitted changes, warns,
// and runs the teardown sequence on confirm. Force-removes when dirty (the warning is the user's heads-up).
import { useEffect, useState } from "react";
import type { Worktree } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { worktreeStatus, type WorktreeStatus } from "../../worktrees/api";
import { teardownWorktree } from "../../worktrees/teardown";
import { paneRoles, EMPTY_PANE_SET } from "../../worktrees/paneSet";
import { Modal } from "../Modal";

export function TeardownConfirm({ worktree, action, onClose, onDone }: {
  worktree: Worktree;
  action: "delete" | "wipe";
  onClose: () => void;
  onDone: (warning: string | null) => void;
}) {
  const { removeWorktree } = useSettings();
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A non-fatal warning (e.g. Wipe of the default branch: worktree removed, branch kept). When set,
  // the teardown already succeeded — we keep the dialog open to show it, and Done reports it upward.
  const [warning, setWarning] = useState<string | null>(null);

  // Probe dirtiness on open; on failure default to dirty (forces a deliberate force-remove ack).
  useEffect(() => {
    worktreeStatus(worktree.worktreePath).then(setStatus).catch(() => setStatus({ exists: true, dirty: true }));
  }, [worktree.worktreePath]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const st = useSettings.getState();
      const w = await teardownWorktree(
        worktree,
        { wipe: action === "wipe", force: status?.dirty ?? true },
        removeWorktree,
        paneRoles(st.worktreePanes[worktree.id] ?? EMPTY_PANE_SET),
      );
      if (w) {
        setWarning(w); // teardown succeeded with a caveat — show it, let the user dismiss.
        setBusy(false);
      } else {
        onDone(null); // clean: parent closes the dialog + clears the slot.
      }
    } catch (e) {
      setError(String(e)); // remove failed: keep model + dialog open so the user can retry.
      setBusy(false);
    }
  };

  const title = action === "wipe" ? "Wipe worktree" : "Delete worktree";
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <p className="tc__line">
        <code>{worktree.branch}</code> · <span className="tc__path">{worktree.worktreePath}</span>
      </p>
      {/* Post-teardown warning takes over: the worktree is already gone; just report + dismiss. */}
      {warning ? (
        <>
          <p className="tc__warn">{warning}</p>
          <div className="tc__actions">
            <button className="wt-col__danger" onClick={() => onDone(warning)}>Done</button>
          </div>
        </>
      ) : (
        <>
          {status === null && <p className="tc__line">Checking for uncommitted changes…</p>}
          {status?.dirty && <p className="tc__warn">This worktree has uncommitted changes — they will be lost (force remove).</p>}
          {action === "wipe" && <p className="tc__warn">The local branch <code>{worktree.branch}</code> will be deleted. (The remote is left untouched.)</p>}
          {action === "delete" && <p className="tc__line">The branch is kept; only the worktree is removed.</p>}
          {error && <div className="tc__error">{error}</div>}
          <div className="tc__actions">
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button className="wt-col__danger" onClick={confirm} disabled={busy || status === null}>
              {busy ? "Working…" : action === "wipe" ? "Wipe" : "Delete"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
