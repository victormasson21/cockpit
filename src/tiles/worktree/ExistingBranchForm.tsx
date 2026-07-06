// ExistingBranchForm.tsx — pick a known repo + one of its branches (recency-sorted), then check it out as a worktree.
import { useState } from "react";
import { createWorktree, listBranches, type BranchInfo } from "../../worktrees/api";
import { makeWorktree } from "../../worktrees/model";
import { deriveBranchName } from "./branchName";
import { useSettings } from "../../settings/store";
import "./ExistingBranchForm.css";

export function ExistingBranchForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const { cockpit, addWorktree } = useSettings();
  const [repoPath, setRepoPath] = useState("");
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pickRepo: load the chosen repo's branches (recency-sorted by the backend) and reset the selection.
  const pickRepo = async (path: string) => {
    setRepoPath(path);
    setBranch("");
    setName("");
    setBranches([]);
    setError(null);
    if (!path) return;
    setLoading(true);
    try {
      setBranches(await listBranches(path));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // pickBranch: select a branch and pre-fill the (editable) worktree name from it.
  const pickBranch = (b: string) => {
    setBranch(b);
    setName(deriveBranchName(b));
  };

  // submit: check out the existing branch into a new worktree, persist the model, hand the id to the parent.
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const worktreePath = await createWorktree(repoPath, name, { kind: "existing", branch });
      const id = `wt-${Date.now()}`;
      // Reuse the repo's saved host default if present; else leave host blank (user can fill in the column later).
      const host = cockpit.knownRepos.find((r) => r.path === repoPath)?.host ?? { startCmd: "", address: "" };
      addWorktree(makeWorktree({ id, name, repoPath, branch, worktreePath, host }));
      onCreated(id);
    } catch (e) {
      // The picker already disables in-use branches; this is the safety net if one gets claimed after listing.
      const msg = String(e);
      setError(/already checked out/i.test(msg)
        ? "That branch is already checked out elsewhere — pick a branch that isn't in use."
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eb-form">
      <select className="eb-form__repo" value={repoPath} onChange={(e) => pickRepo(e.target.value)}>
        <option value="">select repo…</option>
        {cockpit.knownRepos.map((r) => (<option key={r.path} value={r.path}>{r.path}</option>))}
      </select>
      {cockpit.knownRepos.length === 0 && (
        <div className="eb-form__hint">Add a known repo (in the New worktree form) to enable this.</div>
      )}
      {loading && <div className="eb-form__hint">loading branches…</div>}
      {repoPath && !loading && branches.length === 0 && !error && (
        <div className="eb-form__hint">no local branches found.</div>
      )}
      {branches.length > 0 && (
        <select className="eb-form__branch" value={branch} onChange={(e) => pickBranch(e.target.value)}>
          <option value="">select branch…</option>
          {branches.map((b) => (
            // Disable branches already checked out elsewhere — git can't worktree-add them.
            <option key={b.name} value={b.name} disabled={b.checkedOut}>
              {b.name} — {b.lastCommitRelative}{b.checkedOut ? " · checked out" : ""}
            </option>
          ))}
        </select>
      )}
      <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <div className="eb-form__error">{error}</div>}
      <button className="eb-form__create" disabled={busy || !repoPath || !branch || !name} onClick={submit}>
        {busy ? "Creating…" : "Create"}
      </button>
    </div>
  );
}
