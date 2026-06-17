// NewWorktreeForm.tsx — collapsible manual form: runs git worktree add, stores the model, selects it. Collapsible = sub-project-3 inference seam.
import { useState } from "react";
import { createWorktree, type BranchSpec } from "../../worktrees/api";
import { makeWorktree } from "../../worktrees/model";
import { useSettings } from "../../settings/store";

export function NewWorktreeForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const { addWorktree } = useSettings();
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
