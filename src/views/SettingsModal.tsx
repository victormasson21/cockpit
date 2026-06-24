// SettingsModal.tsx — manage known repos: add/remove paths + view and hand-edit each repo's saved host default.
// Absorbs the former inline KnownReposEditor; the host start command is where the install step lives (e.g. `pnpm install && pnpm run dev`).
import { useState } from "react";
import { Modal } from "./Modal";
import { useSettings } from "../settings/store";
import type { HostConfig } from "../settings/types";

// Merge a partial host edit onto the current host, seeding the missing half so HostConfig stays complete
// (both startCmd and address are always present). Pure so the seeding rule is unit-tested without a DOM.
export function mergeHost(current: HostConfig | undefined, patch: Partial<HostConfig>): HostConfig {
  return { startCmd: "", address: "", ...current, ...patch };
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
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
    <Modal title="Settings" onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 13 }}>Known repos</strong>
        {repos.length === 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>Add a repo path so deduction can pick one.</div>}
        {repos.map((r) => (
          <div key={r.path} style={{ display: "grid", gap: 4, paddingBottom: 8, borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</span>
              <button onClick={() => removeKnownRepo(r.path)}>✕</button>
            </div>
            {/* Host default: editable start command (carries the install step) + address. Saved per repo for future deduces. */}
            <input placeholder="start command (e.g. pnpm install && pnpm run dev)" value={r.host?.startCmd ?? ""}
              onChange={(e) => editHost(r.path, { startCmd: e.target.value })} />
            <input placeholder="host address (e.g. http://localhost:5173)" value={r.host?.address ?? ""}
              onChange={(e) => editHost(r.path, { address: e.target.value })} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 6 }}>
          <input placeholder="/Users/…/repo" value={path} style={{ flex: 1 }}
            onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button disabled={!path.trim()} onClick={add}>+ repo</button>
        </div>
      </div>
    </Modal>
  );
}
