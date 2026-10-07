// PendingBody.tsx — a slot holding a pending worktree: a spinner + status label + the prompt + Cancel, shown
// while deduce → create run in the background. Replaced in place by the real worktree body on success.
import { useSettings } from "../../settings/store";
import type { PendingWorktree } from "../slots";

export function PendingBody({ pending }: { pending: PendingWorktree }) {
  const cancel = useSettings((s) => s.cancelPendingWorktree);
  const label = pending.status === "deducing" ? "deducing…" : "creating…";
  return (
    <div className="wt-col__body wt-col__pending">
      <div className="wt-col__spinner" aria-hidden />
      <div className="wt-col__pending-status">{label}</div>
      <div className="wt-col__pending-prompt">{pending.prompt}</div>
      <button onClick={() => cancel(pending.id)}>Cancel</button>
    </div>
  );
}
