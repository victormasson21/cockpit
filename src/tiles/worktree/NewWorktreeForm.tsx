// NewWorktreeForm.tsx — collapsible manual form: runs git worktree add, stores the model, selects it. Collapsible = sub-project-3 inference seam.
import { useState } from "react";
import { createWorktree, deduceWorktree } from "../../worktrees/api";
import { makeWorktree, sourceLinkFrom, branchSpecFrom, FORM_DEFAULTS } from "../../worktrees/model";
import type { WorktreeLink } from "../../settings/types";
import { useSettings } from "../../settings/store";
import "./NewWorktreeForm.css";

export function NewWorktreeForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const { addWorktree, cockpit, setRepoHost } = useSettings();
  const [open, setOpen] = useState(true); // expanded by default while fields are empty
  const [name, setName] = useState(FORM_DEFAULTS.name);
  const [repoPath, setRepoPath] = useState(FORM_DEFAULTS.repoPath);
  const [mode, setMode] = useState<"existing" | "new">(FORM_DEFAULTS.mode);
  const [branch, setBranch] = useState(FORM_DEFAULTS.branch);
  const [base, setBase] = useState(FORM_DEFAULTS.base);
  const [startCmd, setStartCmd] = useState(FORM_DEFAULTS.startCmd);
  const [address, setAddress] = useState(FORM_DEFAULTS.address);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [deducing, setDeducing] = useState(false);
  const [deduceError, setDeduceError] = useState<string | null>(null);
  const [prNumber, setPrNumber] = useState(0);
  const [sourceLink, setSourceLink] = useState<WorktreeLink | null>(null);
  const [banner, setBanner] = useState<{ prompt: string; repoPath: string; reason: string; hostFromSaved: boolean; source: WorktreeLink | null; existingBranch: boolean; branch: string } | null>(null);

  // clearDeduction: drop the staged-deduction unit so a stale deduction can't misroute a later Create.
  const clearDeduction = () => {
    setPrNumber(0);
    setSourceLink(null);
    setBanner(null);
    setDeduceError(null);
  };

  // resetForm: full clean slate — staged unit + visible fields back to defaults + prompt + errors.
  const resetForm = () => {
    clearDeduction();
    setName(FORM_DEFAULTS.name);
    setRepoPath(FORM_DEFAULTS.repoPath);
    setMode(FORM_DEFAULTS.mode);
    setBranch(FORM_DEFAULTS.branch);
    setBase(FORM_DEFAULTS.base);
    setStartCmd(FORM_DEFAULTS.startCmd);
    setAddress(FORM_DEFAULTS.address);
    setPrompt("");
    setError(null);
  };

  // deduce: ask the agent for params, pre-fill the editable fields, and record the banner. Never creates anything.
  const runDeduce = async () => {
    setDeduceError(null);
    setDeducing(true);
    try {
      const d = await deduceWorktree(prompt, cockpit.knownRepos.map((r) => r.path));
      setName(d.name);
      setRepoPath(d.repoPath);
      setMode(d.existingBranch ? "existing" : "new");
      setPrNumber(d.prNumber ?? 0);
      setBranch(d.branch);
      setBase(d.base);
      // A repo's saved host default wins over the agent's guess (port/start cmd aren't reliably inferable).
      const saved = cockpit.knownRepos.find((r) => r.path === d.repoPath)?.host;
      setStartCmd(saved?.startCmd ?? d.startCmd);
      setAddress(saved?.address ?? d.address);
      const sl = sourceLinkFrom(d);
      setSourceLink(sl);
      setBanner({ prompt, repoPath: d.repoPath, reason: d.reason, hostFromSaved: !!(saved?.startCmd && saved?.address), source: sl, existingBranch: !!d.existingBranch, branch: d.branch });
    } catch (e) {
      setDeduceError(String(e));
    } finally {
      setDeducing(false);
    }
  };

  // submit: create the git worktree, then persist + select the model.
  const submit = async () => {
    setError(null);
    setBusy(true);
    const spec = branchSpecFrom({ prNumber, mode, branch, base });
    try {
      const worktreePath = await createWorktree(repoPath, name, spec);
      const id = `wt-${Date.now()}`;
      addWorktree(makeWorktree({
        id, name, repoPath, branch, worktreePath,
        host: { startCmd, address },
        links: sourceLink ? [sourceLink] : [],
      }));
      onCreated(id);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <div className="nw-form"><button onClick={() => { resetForm(); setOpen(true); }}>+ new worktree</button></div>;
  }

  return (
    <div className="nw-form">
      {/* deduce: one prompt -> pre-filled fields (deduce -> preview/confirm -> create) */}
      <textarea placeholder="describe the task (e.g. fix the login bug)" value={prompt} rows={2}
        onChange={(e) => { setPrompt(e.target.value); clearDeduction(); }} />
      <button className="nw-form__deduce" disabled={deducing || !prompt.trim() || cockpit.knownRepos.length === 0} onClick={runDeduce}>
        {deducing ? "deducing…" : "deduce"}
      </button>
      {cockpit.knownRepos.length === 0 && <div className="nw-form__hint">Add a known repo in Settings (⚙) to enable deduce.</div>}
      {deduceError && <div className="nw-form__error">{deduceError}</div>}
      {banner && (
        <div className="nw-form__banner">
          deduced from "{banner.prompt}" → <strong>{banner.repoPath}</strong><br />
          {banner.reason} — review the fields below and Create.
          {banner.hostFromSaved && <><br />host loaded from this repo's saved default.</>}
          {banner.source && <><br />🔗 {banner.source.label} — link will be added.</>}
          {banner.existingBranch && <><br />will check out existing branch <strong>{banner.branch}</strong>.</>}
        </div>
      )}
      <hr className="nw-form__sep" />
      <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="repo path (/Users/…/repo)" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <label><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> new branch</label>
        <label><input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> existing</label>
      </div>
      <input placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
      {mode === "new" && <input placeholder="base branch" value={base} onChange={(e) => setBase(e.target.value)} />}
      <input placeholder="start command" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} />
      <input placeholder="host address" value={address} onChange={(e) => setAddress(e.target.value)} />
      {/* save the current host as this repo's default so next deduce pre-fills it */}
      {repoPath && (
        <button disabled={!startCmd || !address} onClick={() => setRepoHost(repoPath, { startCmd, address })}>
          save host as default for this repo
        </button>
      )}
      {error && <div className="nw-form__error">{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="nw-form__create" disabled={busy || !name || !repoPath || !branch} onClick={submit}>{busy ? "creating…" : "create"}</button>
        <button disabled={busy} onClick={() => { resetForm(); setOpen(false); }}>cancel</button>
      </div>
    </div>
  );
}
