// ExistingBranchForm.tsx — pick a known repo + one of its branches (recency-sorted), then either check it
// out as a new worktree or, for the branch the repo's own tree holds, open that tree in place.
import { useState } from "react";
import { createWorktree, listBranches, type BranchInfo } from "../../worktrees/api";
import { makeWorktree, isPrimaryTree } from "../../worktrees/model";
import { deriveBranchName } from "./branchName";
import { useSettings } from "../../settings/store";
import { Dropdown } from "../../views/Dropdown";
import type { DropdownGroup } from "../../views/dropdownModel";
import "./ExistingBranchForm.css";

// Hint tags appended after a branch's recency in the picker's dim hint slot.
const OPEN_IN_PLACE_TAG = " · open in place";
const CLAIMED_TAG = " · checked out";
// Heading over the repo's own branch. Its position at the top already implies it, but a heading says it
// outright — otherwise "the first row is your clone's branch" is a convention the reader has to know.
const PRIMARY_GROUP_LABEL = "Checked out in the repo";

// True when the selected branch is the one the repo's own tree has checked out: picking it opens that
// tree in place, so there is no `git worktree add` to run and nothing new on disk.
export function opensInPlace(branches: BranchInfo[], branch: string): boolean {
  return branches.some((b) => b.name === branch && b.primaryTree);
}

// The picker's groups: the repo's own branch under its own heading, then every other branch in the
// recency order git gave. Those others stay disabled when checked out — git refuses to worktree-add a
// branch another tree already holds. A detached repo tree flags no branch, so the heading is omitted.
export function branchPickerGroups(branches: BranchInfo[]): DropdownGroup[] {
  const tagFor = (b: BranchInfo) => {
    if (b.primaryTree) return OPEN_IN_PLACE_TAG;
    return b.checkedOut ? CLAIMED_TAG : "";
  };
  const row = (b: BranchInfo) => ({
    value: b.name,
    label: b.name,
    hint: `${b.lastCommitRelative}${tagFor(b)}`,
    disabled: b.checkedOut && !b.primaryTree,
  });
  const primary = branches.filter((b) => b.primaryTree).map(row);
  const rest = branches.filter((b) => !b.primaryTree).map(row);
  const primaryGroup = primary.length > 0 ? [{ label: PRIMARY_GROUP_LABEL, options: primary }] : [];
  return [...primaryGroup, { options: rest }];
}

export function ExistingBranchForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const knownRepos = useSettings((s) => s.cockpit.knownRepos);
  const worktrees = useSettings((s) => s.cockpit.worktrees);
  const addWorktree = useSettings((s) => s.addWorktree);
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

  // pickBranch: select a branch and pre-fill the (editable) name — the repo's own directory name when
  // this opens the primary tree (the entity IS the repo), otherwise the branch-derived slug.
  const pickBranch = (b: string) => {
    setBranch(b);
    const repoName = repoPath.split("/").pop() ?? b;
    setName(opensInPlace(branches, b) ? repoName : deriveBranchName(b));
  };

  const inPlace = opensInPlace(branches, branch);
  // Opening a repo that already has an entity would give one directory two columns and two Claude
  // panes racing in it — reveal the existing one instead of minting a second.
  const alreadyOpen = worktrees.find((w) => isPrimaryTree(w) && w.repoPath === repoPath);
  const action = inPlace ? { idle: "Open", busy: "Opening…" } : { idle: "Create", busy: "Creating…" };

  // submit: check out the existing branch into a new worktree — or, in place, adopt the repo's own tree
  // with no git call at all — then persist the model and hand the id to the parent.
  const submit = async () => {
    if (inPlace && alreadyOpen) {
      onCreated(alreadyOpen.id);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const worktreePath = inPlace ? repoPath : await createWorktree(repoPath, name, { kind: "existing", branch });
      const id = `wt-${Date.now()}`;
      // Snapshot the repo's saved host default if present; a blank host is fine — `resolveStartCmd` falls
      // back to the repo default at Run time, so a default saved after this checkout still reaches the button.
      const host = knownRepos.find((r) => r.path === repoPath)?.host ?? { startCmd: "", address: "" };
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
      <Dropdown variant="form" placeholder="select repo…" value={repoPath || null} onChange={pickRepo}
        groups={[{ options: knownRepos.map((r) => ({ value: r.path, label: r.path })) }]} />
      {knownRepos.length === 0 && (
        <div className="eb-form__hint">Add a known repo (in the New worktree form) to enable this.</div>
      )}
      {loading && <div className="eb-form__hint">loading branches…</div>}
      {repoPath && !loading && branches.length === 0 && !error && (
        <div className="eb-form__hint">no local branches found.</div>
      )}
      {branches.length > 0 && (
        <Dropdown variant="form" placeholder="select branch…" value={branch || null} onChange={pickBranch}
          groups={branchPickerGroups(branches)} />
      )}
      <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <div className="eb-form__error">{error}</div>}
      <button className="eb-form__create" disabled={busy || !repoPath || !branch || !name} onClick={submit}>
        {busy ? action.busy : action.idle}
      </button>
    </div>
  );
}
