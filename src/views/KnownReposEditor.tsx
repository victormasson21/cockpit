// KnownReposEditor.tsx — Settings pane: add (via native folder picker, one or many at a time) / remove
// known repo paths + edit each repo's saved host default (start cmd + address).
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../settings/store";
import { discoverRepos } from "../worktrees/api";
import type { HostConfig } from "../settings/types";
import "./KnownReposEditor.css";

// Merge a partial host edit onto the current host, seeding the missing half so HostConfig stays complete
// (both startCmd and address are always present). Pure so the seeding rule is unit-tested without a DOM.
export function mergeHost(current: HostConfig | undefined, patch: Partial<HostConfig>): HostConfig {
  return { startCmd: "", address: "", ...current, ...patch };
}

export interface PickReport {
  added: readonly string[];
  message: string;
}

// What a pick added, and the one line the editor shows about it. Pure so the wording of a partly
// redundant pick (select a group folder twice and most of it is already known) is unit-tested.
export function summarisePicks(found: readonly string[], existing: readonly string[]): PickReport {
  if (found.length === 0) return { added: [], message: "No git repos found in the selection" };
  const added = found.filter((path) => !existing.includes(path));
  const alreadyKnown = found.length - added.length;
  const parts = [
    added.length > 0 ? `Added ${added.length}` : null,
    alreadyKnown > 0 ? `${alreadyKnown} already known` : null,
  ];
  return { added, message: parts.filter((part) => part !== null).join(" · ") };
}

export function KnownReposEditor() {
  const repos = useSettings((s) => s.cockpit.knownRepos);
  const addKnownRepo = useSettings((s) => s.addKnownRepo);
  const removeKnownRepo = useSettings((s) => s.removeKnownRepo);
  const setRepoHost = useSettings((s) => s.setRepoHost);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Open the native folder picker with multi-select on, resolve every pick to repo roots, add them.
  // Selecting the repos themselves and standing inside a folder that holds them both work — the panel
  // returns the same kind of path either way, and discovery decides what it means (see discover_repos).
  const browse = async () => {
    setError(null);
    setNote(null);
    const picked = await open({ directory: true, multiple: true, title: "Select repo folders" } as const);
    if (picked === null) return; // cancelled — silent no-op.
    try {
      const report = summarisePicks(await discoverRepos(picked), repos.map((r) => r.path));
      report.added.forEach(addKnownRepo);
      setNote(report.message);
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
      <div className="known-repos__title">
        <strong>Known repos</strong>
        <button onClick={browse}>+ Browse for repos…</button>
      </div>
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
      {note && <div className="known-repos__note">{note}</div>}
      {error && <div className="known-repos__error">{error}</div>}
    </div>
  );
}
