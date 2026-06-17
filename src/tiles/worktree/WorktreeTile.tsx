// WorktreeTile.tsx — composite viewer for one worktree: recent dropdown + status + links (terminals/form added in later tasks).
import { invoke } from "@tauri-apps/api/core";
import type { TileProps } from "../registry";
import { useSettings } from "../../settings/store";
import { LinksList } from "./LinksList";
import { NewWorktreeForm } from "./NewWorktreeForm";
import { TerminalPane } from "../../worktrees/TerminalPane";

// This instance's config: which worktree to display.
interface WorktreeConfig { worktreeId?: string }

const ROLES = ["git", "host", "claude"] as const;

export function WorktreeTile({ config, updateConfig }: TileProps<WorktreeConfig>) {
  const { cockpit, updateWorktree, removeWorktree } = useSettings();
  const worktrees = cockpit.worktrees;
  const active = worktrees.find((w) => w.id === config.worktreeId);

  // remove: kill the worktree's 3 PTYs, drop the model, clear the selection (spec §C remove_worktree).
  const removeActive = async () => {
    if (!active) return;
    for (const role of ROLES) await invoke("pty_kill", { ptyId: `${active.id}:${role}` });
    removeWorktree(active.id);
    updateConfig({ worktreeId: undefined });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* recent-worktrees dropdown + status toggle + remove */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderBottom: "1px solid #eee" }}>
        <select value={config.worktreeId ?? ""} onChange={(e) => updateConfig({ worktreeId: e.target.value || undefined })}>
          <option value="">— select worktree —</option>
          {worktrees.map((w) => (
            <option key={w.id} value={w.id}>{w.name} [{w.status}]</option>
          ))}
        </select>
        {active && (
          <>
            <button onClick={() => updateWorktree(active.id, { status: active.status === "ongoing" ? "completed" : "ongoing" })}>
              mark {active.status === "ongoing" ? "completed" : "ongoing"}
            </button>
            <button onClick={removeActive}>remove</button>
          </>
        )}
      </div>

      <NewWorktreeForm onCreated={(id) => updateConfig({ worktreeId: id })} />

      {!active ? (
        <div style={{ padding: 12, opacity: 0.6 }}>No worktree selected.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ padding: "4px 6px", fontSize: 12, opacity: 0.7 }}>
            {active.branch} · {active.worktreePath}
          </div>
          {/* Re-keyed by active.id: switching the dropdown remounts these panes (detach old, attach new) without killing the processes (they live in Rust). */}
          <div key={active.id} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <TerminalPane title="git" worktreeId={active.id} role="git" cwd={active.worktreePath} />
            <TerminalPane title="host" worktreeId={active.id} role="host" cwd={active.worktreePath} autostartCmd={active.host.startCmd} />
            <TerminalPane title="claude" worktreeId={active.id} role="claude" cwd={active.worktreePath} autostartCmd="claude" />
          </div>
          <LinksList worktreeId={active.id} links={active.links} />
        </div>
      )}
    </div>
  );
}
