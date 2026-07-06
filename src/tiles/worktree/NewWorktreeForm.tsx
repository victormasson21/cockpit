// NewWorktreeForm.tsx — prompt-only new-worktree form: fire the deduce→create background chain, close instantly.
// No fields, no separate Deduce step, no review: the store action places a spinning pending tile and does the rest.
import { useState } from "react";
import { useSettings } from "../../settings/store";
import "./NewWorktreeForm.css";

type View = "cockpit" | "worktrees" | "calm";

export function NewWorktreeForm({ view, onClose }: { view: View; onClose: () => void }) {
  const { startDeduceWorktree, clearWorktreeError, worktreeError, cockpit } = useSettings();
  // Seed from a prior failure so a reopened modal shows the prompt the user was working on.
  const [prompt, setPrompt] = useState(worktreeError?.prompt ?? "");
  const noRepos = cockpit.knownRepos.length === 0;

  // submit: hand the prompt to the store's background chain, then close the modal immediately.
  const submit = () => {
    clearWorktreeError();
    startDeduceWorktree(prompt.trim(), view);
    onClose();
  };

  return (
    <div className="nw-form">
      <textarea placeholder="describe the task (e.g. fix the login bug)" value={prompt} rows={3}
        autoFocus onChange={(e) => setPrompt(e.target.value)} />
      {noRepos && <div className="nw-form__hint">Add a known repo in Settings (⚙) to enable deduce.</div>}
      {worktreeError && <div className="nw-form__error">{worktreeError.message}</div>}
      <button className="nw-form__create" disabled={!prompt.trim() || noRepos} onClick={submit}>Create</button>
    </div>
  );
}
