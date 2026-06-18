// KnownReposEditor.tsx — add/remove list of known repo entries (path + optional saved host) the deduce agent may pick from.
import { useState } from "react";
import { useSettings } from "../../settings/store";

export function KnownReposEditor() {
  const { cockpit, addKnownRepo, removeKnownRepo } = useSettings();
  const repos = cockpit.knownRepos;
  const [path, setPath] = useState("");

  // add the trimmed path, then clear the field (store dedupes).
  const add = () => {
    const p = path.trim();
    if (!p) return;
    addKnownRepo(p);
    setPath("");
  };

  return (
    <div style={{ fontSize: 12, display: "grid", gap: 4 }}>
      <strong>Known repos</strong>
      {repos.length === 0 && <div style={{ opacity: 0.6 }}>Add a repo path so deduction can pick one.</div>}
      {repos.map((r) => (
        <div key={r.path} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</span>
          {r.host && <span style={{ opacity: 0.6 }}>· {r.host.address}</span>}
          <button onClick={() => removeKnownRepo(r.path)}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4 }}>
        <input placeholder="/Users/…/repo" value={path} style={{ flex: 1 }}
          onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button disabled={!path.trim()} onClick={add}>+ repo</button>
      </div>
    </div>
  );
}
