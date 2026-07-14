// WorktreeBody.tsx — the worktree slot body: chips + path + dynamic panes (claude always; host via Run; extra shells via Add) + the bottom Run/Add bar.
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";
import { claudePaneAutostart } from "../../worktrees/claudeCmd";
import { makePtyId } from "../../worktrees/ptyId";
import { EMPTY_PANE_SET, MAX_EXTRAS, isPaneOpen } from "../../worktrees/paneSet";
import { CopyIcon, PlayIcon, PlusIcon } from "../icons";

// `switcher` (calm only) is the icon+dropdown unit, injected into the Claude pane header so the
// dropdown sits level with the restart button (calm has no separate column header).
export function WorktreeBody({ worktree, variant, switcher }: { worktree: Worktree; variant: "full" | "calm"; switcher?: ReactNode }) {
  // Session-only dynamic pane set: which panes exist + their collapse state (absent = Claude only).
  const paneSet = useSettings((s) => s.worktreePanes[worktree.id]) ?? EMPTY_PANE_SET;
  const runHostPane = useSettings((s) => s.runHostPane);
  const addShellPane = useSettings((s) => s.addShellPane);
  const toggleWorktreePane = useSettings((s) => s.toggleWorktreePane);
  const expandWorktreePane = useSettings((s) => s.expandWorktreePane);

  // Full variant routes collapse/expand through the slice so expand can collapse the LIVE siblings.
  const paneProps = (role: string) =>
    variant === "full"
      ? {
          open: isPaneOpen(paneSet, role),
          onToggle: () => toggleWorktreePane(worktree.id, role),
          onExpand: () => expandWorktreePane(worktree.id, role),
        }
      : {}; // calm: single pane, self-managed, no expand

  // Close on host/extras REMOVES the pane: kill the PTY, drop any attention mark, drop it from the set.
  // Await the kill before dropping the pane: the `host` role reuses a fixed pty id, so a fire-and-forget
  // kill racing an immediate re-Run could let pty_ensure reattach the still-alive entry, then the lagging
  // kill removes it — leaving a dead pane. Extras are immune (monotonic role) but share this path.
  const closePane = async (role: string) => {
    const ptyId = makePtyId(worktree.id, role);
    useSettings.getState().clearAttention(ptyId);
    try {
      await invoke("pty_kill", { ptyId });
    } catch (e) {
      console.error("pty_kill failed", e);
    }
    useSettings.getState().removeWorktreePane(worktree.id, role);
  };

  // One-shot: true only in the session that created this worktree, until the claude PTY's first ensure.
  const promptPending = useSettings((s) => Boolean(s.initialPromptPending[worktree.id]));
  const prompt = worktree.prompt; // captured so TS narrowing survives into the JSX callbacks (no `!`)
  const startCmd = worktree.host.startCmd.trim();
  return (
    // Re-keyed by id upstream so switching the picker remounts panes (detach old, attach new) without killing PTYs.
    <div className="wt-col__body">
      {variant === "full" && (
        <>
          <div className="wt-col__chips">
            {worktreeChips(worktree).map((c, i) => (
              <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
                {c.label}
              </button>
            ))}
            {/* user links live in the same row as the derived chips, with + link at the end. */}
            <LinksList worktreeId={worktree.id} links={worktree.links} />
          </div>
          <div className="wt-col__path">
            {worktree.repoPath.split("/").pop()} · {worktree.branch} · {worktree.worktreePath.split("/").pop()}
          </div>
        </>
      )}
      <div className="wt-col__panes">
        {/* attention highlight (border/glow + badge) is owned by WorktreePane via the live store. */}
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          lead={variant === "calm" ? switcher : undefined}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath}
          autostartCmd={claudePaneAutostart(worktree.prompt, promptPending)}
          onEnsured={() => useSettings.getState().clearInitialPrompt(worktree.id)}
          action={variant !== "calm" && prompt ? (
            <button
              className="icon-btn" title={`copy prompt: ${prompt}`}
              onClick={() => navigator.clipboard.writeText(prompt).catch((e) => console.error("copy prompt failed", e))}
            ><CopyIcon /></button>
          ) : undefined}
          {...paneProps("claude")}
        />
        {variant === "full" && paneSet.host && (
          <WorktreePane
            title="localhost" icon={<span className="wt-ico wt-ico--chrome" aria-hidden />}
            worktreeId={worktree.id} role="host" cwd={worktree.worktreePath}
            autostartCmd={worktree.host.startCmd}
            onClose={() => closePane("host")}
            {...paneProps("host")}
          />
        )}
        {variant === "full" && paneSet.extras.map((role) => (
          <WorktreePane
            key={role}
            title="terminal" icon={<span className="wt-ico wt-ico--terminal" aria-hidden />}
            worktreeId={worktree.id} role={role} cwd={worktree.worktreePath}
            onClose={() => closePane(role)}
            {...paneProps(role)}
          />
        ))}
      </div>
      {variant === "full" && (
        <div className="wt-col__actions">
          <button
            className="wt-col__action"
            disabled={paneSet.host || !startCmd}
            title={!startCmd ? "no start command configured" : paneSet.host ? "already running" : `run: ${startCmd}`}
            onClick={() => runHostPane(worktree.id)}
          ><PlayIcon /> Run</button>
          <button
            className="wt-col__action"
            disabled={paneSet.extras.length >= MAX_EXTRAS}
            title={paneSet.extras.length >= MAX_EXTRAS ? `max ${MAX_EXTRAS} extra terminals` : "add a terminal in this worktree"}
            onClick={() => addShellPane(worktree.id)}
          ><PlusIcon /> Add</button>
        </div>
      )}
    </div>
  );
}
