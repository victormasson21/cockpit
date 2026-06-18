// NewWorktreeForm.tsx — collapsible manual form: runs git worktree add, stores the model, selects it. Collapsible = sub-project-3 inference seam.
import { useState } from "react";
import { createWorktree, deduceWorktree, type BranchSpec } from "../../worktrees/api";
import { makeWorktree } from "../../worktrees/model";
import { useSettings } from "../../settings/store";
import { KnownReposEditor } from "./KnownReposEditor";

export function NewWorktreeForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const { addWorktree, cockpit } = useSettings();
  const [open, setOpen] = useState(true); // expanded by default while fields are empty
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("main");
  const [startCmd, setStartCmd] = useState("npm run dev");
  const [address, setAddress] = useState("http://localhost:3000");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [deducing, setDeducing] = useState(false);
  const [deduceError, setDeduceError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ prompt: string; repoPath: string; reason: string } | null>(null);

  // deduce: ask the agent for params, pre-fill the editable fields, and record the banner. Never creates anything.
  const runDeduce = async () => {
    setDeduceError(null);
    setDeducing(true);
    try {
      const d = await deduceWorktree(prompt, cockpit.knownRepos);
      setName(d.name);
      setRepoPath(d.repoPath);
      setMode("new");
      setBranch(d.branch);
      setBase(d.base);
      setStartCmd(d.startCmd);
      setAddress(d.address);
      setBanner({ prompt, repoPath: d.repoPath, reason: d.reason });
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
    const spec: BranchSpec = mode === "existing" ? { kind: "existing", branch } : { kind: "new", branch, base };
    try {
      const worktreePath = await createWorktree(repoPath, name, spec);
      const id = `wt-${Date.now()}`;
      addWorktree(makeWorktree({
        id, name, repoPath, branch, worktreePath,
        host: { startCmd, address },
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
    return <div style={{ padding: 6 }}><button onClick={() => setOpen(true)}>+ new worktree</button></div>;
  }

  return (
    <div style={{ padding: 8, borderBottom: "1px solid #eee", fontSize: 12, display: "grid", gap: 4 }}>
      <KnownReposEditor />
      <hr style={{ width: "100%", border: "none", borderTop: "1px solid #eee", margin: "4px 0" }} />
      {/* deduce: one prompt -> pre-filled fields (deduce -> preview/confirm -> create) */}
      <textarea placeholder="describe the task (e.g. fix the login bug)" value={prompt} rows={2}
        onChange={(e) => setPrompt(e.target.value)} />
      <button disabled={deducing || !prompt.trim() || cockpit.knownRepos.length === 0} onClick={runDeduce}>
        {deducing ? "deducing…" : "deduce"}
      </button>
      {cockpit.knownRepos.length === 0 && <div style={{ opacity: 0.6 }}>Add a known repo above to enable deduce.</div>}
      {deduceError && <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{deduceError}</div>}
      {banner && (
        <div style={{ background: "#eef6ff", border: "1px solid #cfe2ff", borderRadius: 4, padding: 6 }}>
          deduced from "{banner.prompt}" → <strong>{banner.repoPath}</strong><br />
          {banner.reason} — review the fields below and Create.
        </div>
      )}
      <hr style={{ width: "100%", border: "none", borderTop: "1px solid #eee", margin: "4px 0" }} />
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
      {error && <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button disabled={busy || !name || !repoPath || !branch} onClick={submit}>{busy ? "creating…" : "create"}</button>
        <button disabled={busy} onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}
