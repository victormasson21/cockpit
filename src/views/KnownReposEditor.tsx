// KnownReposEditor.tsx — Settings pane: add/remove known repo paths + edit each repo's saved host default (start cmd + address).
import { useState } from "react";
import { useSettings } from "../settings/store";
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
  const [path, setPath] = useState("");

  // add the trimmed path, then clear the field (store dedupes).
  const add = () => {
    const p = path.trim();
    if (!p) return;
    addKnownRepo(p);
    setPath("");
  };

  // Patch one field of a repo's host default; seed the missing half from the current host (or empty).
  const editHost = (repoPath: string, patch: Partial<HostConfig>) => {
    setRepoHost(repoPath, mergeHost(repos.find((r) => r.path === repoPath)?.host, patch));
  };

  return (
    <div className="known-repos">
      <strong>Known repos</strong>
      {repos.length === 0 && <div className="known-repos__empty">Add a repo path so deduction can pick one.</div>}
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
        <input placeholder="/Users/…/repo" value={path}
          onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button disabled={!path.trim()} onClick={add}>+ repo</button>
      </div>
    </div>
  );
}
