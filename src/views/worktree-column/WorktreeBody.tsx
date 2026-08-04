// WorktreeBody.tsx — the worktree slot body: chips + dynamic panes (claude always; host via Run; extra shells via Add) + the bottom Run/Add bar.
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { WorktreeInfo } from "./WorktreeInfo";
import { LinksList } from "../../tiles/worktree/LinksList";
import { claudePaneAutostart } from "../../worktrees/claudeCmd";
import { resolveHost } from "../../worktrees/model";
import { closePane } from "../../worktrees/paneLifecycle";
import { EMPTY_PANE_SET, MAX_EXTRAS, isPaneOpen } from "../../worktrees/paneSet";
import { CopyIcon, PlayIcon, PlusIcon } from "../icons";

// `switcher` (calm density only) is the icon+dropdown unit, injected into the Claude pane header so the
// dropdown sits level with the restart button (calm has no separate column header). It is the one
// difference CSS cannot express, which is why it is a prop and the rest of calm's declutter is not.
export function WorktreeBody({ worktree, switcher }: { worktree: Worktree; switcher?: ReactNode }) {
  // Session-only dynamic pane set: which panes exist + their collapse state (absent = Claude only).
  const paneSet = useSettings((s) => s.worktreePanes[worktree.id]) ?? EMPTY_PANE_SET;
  const runHostPane = useSettings((s) => s.runHostPane);
  const addShellPane = useSettings((s) => s.addShellPane);
  const toggleWorktreePane = useSettings((s) => s.toggleWorktreePane);
  const expandWorktreePane = useSettings((s) => s.expandWorktreePane);
  const knownRepos = useSettings((s) => s.cockpit.knownRepos);

  const paneProps = (role: string) => ({
    open: isPaneOpen(paneSet, role),
    onToggle: () => toggleWorktreePane(worktree.id, role),
    onExpand: () => expandWorktreePane(worktree.id, role),
  });

  // Close on host/extras REMOVES the pane (kill + drop) — the ordering that matters is in closePane.
  const close = (role: string) => { void closePane(worktree.id, role); };

  // One-shot: true only in the session that created this worktree, until the claude PTY's first ensure.
  const promptPending = useSettings((s) => Boolean(s.initialPromptPending[worktree.id]));
  // True only for the first spawn after a restart, on a worktree the previous session had open.
  const restored = useSettings((s) => Boolean(s.restoredWorktrees[worktree.id]));
  const prompt = worktree.prompt; // captured so TS narrowing survives into the JSX callbacks (no `!`)
  // Resolved live (not read off the model) so a repo default saved after this worktree was created still applies.
  const host = resolveHost(worktree, knownRepos);
  const startCmd = host.startCmd;
  return (
    // Re-keyed by id upstream so switching the picker remounts panes (detach old, attach new) without killing PTYs.
    <div className="wt-col__body">
      <div className="wt-col__chips">
        {/* identity (repo/branch/dir) is behind this hover popup rather than its own row */}
        <WorktreeInfo worktree={worktree} />
        {worktreeChips(worktree, host.address).map((c, i) => (
          <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
            {c.label}
          </button>
        ))}
        {/* user links live in the same row as the derived chips, with + link at the end. */}
        <LinksList worktreeId={worktree.id} worktreePath={worktree.worktreePath} links={worktree.links} />
      </div>
      <div className="wt-col__panes">
        {/* attention highlight (border/glow + badge) is owned by WorktreePane via the live store. */}
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          lead={switcher}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath}
          autostartCmd={claudePaneAutostart(worktree.prompt, promptPending, restored)}
          onEnsured={() => {
            // Both one-shots are consumed by the first ensure: a later restart runs plain `claude`.
            useSettings.getState().clearInitialPrompt(worktree.id);
            useSettings.getState().clearRestored(worktree.id);
          }}
          action={prompt ? (
            <button
              className="icon-btn wt-pane__copy" title={`copy prompt: ${prompt}`}
              onClick={() => navigator.clipboard.writeText(prompt).catch((e) => console.error("copy prompt failed", e))}
            ><CopyIcon /></button>
          ) : undefined}
          {...paneProps("claude")}
        />
        {paneSet.host && (
          <WorktreePane
            title="localhost" icon={<span className="wt-ico wt-ico--chrome" aria-hidden />}
            worktreeId={worktree.id} role="host" cwd={worktree.worktreePath}
            autostartCmd={startCmd}
            onClose={() => close("host")}
            {...paneProps("host")}
          />
        )}
        {paneSet.extras.map((role) => (
          <WorktreePane
            key={role}
            title="terminal" icon={<span className="wt-ico wt-ico--terminal" aria-hidden />}
            worktreeId={worktree.id} role={role} cwd={worktree.worktreePath}
            onClose={() => close(role)}
            {...paneProps(role)}
          />
        ))}
      </div>
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
    </div>
  );
}
