// KnownReposEditor.tsx — Settings pane: add (via native folder picker) / remove known repo paths
// + edit each repo's saved host default (start cmd + address).
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../settings/store";
import { resolveRepoRoot } from "../worktrees/api";
import type { HostConfig } from "../settings/types";
import "./KnownReposEditor.css";

// Merge a partial host edit onto the current host, seeding the missing half so HostConfig stays complete
// (both startCmd and address are always present). Pure so the seeding rule is unit-tested without a DOM.
export function mergeHost(current: HostConfig | undefined, patch: Partial<HostConfig>): HostConfig {
  return { startCmd: "", address: "", ...current, ...patch };
}

export function KnownReposEditor() {
  const { cockpit, addKnownRepo, removeKnownRepo, setRepoHost } = useSettings();
  const repos = cockpit.knownRepos;
  const [error, setError] = useState<string | null>(null);

  // Open the native folder picker; validate + normalize the pick to its repo root, then add it.
  const browse = async () => {
    setError(null);
    const picked = await open({ directory: true, multiple: false, title: "Select a repo folder" });
    if (typeof picked !== "string") return; // cancelled (null) — silent no-op.
    try {
      addKnownRepo(await resolveRepoRoot(picked)); // store dedupes by path.
    } catch (e) {
      setError(String(e));
    }
  };

  // Patch one field of a repo's host default; seed the missing half from the current host (or empty).
  const editHost = (repoPath: string, patch: Partial<HostConfig>) => {
    setRepoHost(repoPath, mergeHost(repos.find((r) => r.path === repoPath)?.host, patch));
  };

  return (
    <div className="known-repos">
      <strong>Known repos</strong>
      {repos.length === 0 && <div className="known-repos__empty">Add a repo so deduction can pick one.</div>}
      {repos.map((r) => (
        <div key={r.path} className="known-repos__row">
          <div className="known-repos__head">
            <span className="known-repos__path">{r.path}</span>
            <button className="icon-btn" aria-label="remove repo" onClick={() => removeKnownRepo(r.path)}>✕</button>
          </div>
          {/* Host default: editable start command (carries the install step) + address. Saved per repo for future deduces. */}
          <input placeholder="start command (e.g. pnpm install && pnpm run dev)" value={r.host?.startCmd ?? ""}
            onChange={(e) => editHost(r.path, { startCmd: e.target.value })} />
          <input placeholder="host address (e.g. http://localhost:5173)" value={r.host?.address ?? ""}
            onChange={(e) => editHost(r.path, { address: e.target.value })} />
        </div>
      ))}
      <div className="known-repos__add">
        <button onClick={browse}>+ Browse for repo…</button>
      </div>
      {error && <div className="known-repos__error">{error}</div>}
    </div>
  );
}
