// WorktreeBody.tsx — the worktree slot body: chips + dynamic panes (claude always; host via Run; extra shells via Add) + the bottom Run/Add bar.
import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { WorktreeInfo } from "./WorktreeInfo";
import { LinksList } from "../../tiles/worktree/LinksList";
import { claudePaneAutostart } from "../../worktrees/claudeCmd";
import { resolveHost, isPrimaryTree, editorRoots } from "../../worktrees/model";
import { currentBranch, branchRoots, openInEditor } from "../../worktrees/api";
import { closePane } from "../../worktrees/paneLifecycle";
import { EMPTY_PANE_SET, MAX_EXTRAS, isPaneOpen } from "../../worktrees/paneSet";
import { CopyIcon, PlayIcon, PlusIcon } from "../icons";

export function WorktreeBody({ worktree }: { worktree: Worktree }) {
  // Session-only dynamic pane set: which panes exist + their collapse state (absent = Claude only).
  const paneSet = useSettings((s) => s.worktreePanes[worktree.id]) ?? EMPTY_PANE_SET;
  const runHostPane = useSettings((s) => s.runHostPane);
  const addShellPane = useSettings((s) => s.addShellPane);
  const toggleWorktreePane = useSettings((s) => s.toggleWorktreePane);
  const expandWorktreePane = useSettings((s) => s.expandWorktreePane);
  const knownRepos = useSettings((s) => s.cockpit.knownRepos);
  const updateWorktree = useSettings((s) => s.updateWorktree);

  // A primary-tree entity is the user's own clone, so they switch branches in it outside cockpit and the
  // model's snapshot goes stale — taking the ⓘ row and the branch-derived chips with it. Re-read HEAD on
  // mount and whenever the window regains focus (they left to run git somewhere else and came back).
  const primary = isPrimaryTree(worktree);
  useEffect(() => {
    if (!primary) return;
    const syncHead = () => {
      currentBranch(worktree.repoPath)
        .then((head) => { if (head !== worktree.branch) updateWorktree(worktree.id, { branch: head }); })
        .catch((e) => console.warn("HEAD re-read failed:", e));
    };
    syncHead();
    window.addEventListener("focus", syncHead);
    return () => window.removeEventListener("focus", syncHead);
  }, [primary, worktree.id, worktree.repoPath, worktree.branch, updateWorktree]);

  // Open the work in VS Code. The same-branch scan runs on the click, not on mount: it costs a git call
  // per known repo, and the answer is only wanted when the button is pressed. A failed scan still opens
  // the worktree itself — one folder is a degraded answer, no folder is a dead button.
  const openEditor = async () => {
    const detected = await branchRoots(worktree.worktreePath, knownRepos.map((r) => r.path)).catch((e) => {
      console.warn("same-branch scan failed:", e);
      return [];
    });
    await openInEditor(worktree.name, editorRoots(worktree.worktreePath, detected)).catch((e) =>
      console.error("VS Code launch failed:", e),
    );
  };

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
        <button
          className="wt-chip wt-chip--editor"
          title="open in VS Code — with any same-branch trees from your other repos"
          onClick={openEditor}
        >
          VS Code
        </button>
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
