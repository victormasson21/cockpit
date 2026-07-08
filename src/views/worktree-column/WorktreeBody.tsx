// WorktreeBody.tsx — the worktree slot body: chips + path + 3 terminal panes (+ links in full variant).
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";
import { useSettings } from "../../settings/store";
import { claudePaneAutostart } from "../../worktrees/claudeCmd";
import { CopyIcon } from "../icons";

export function WorktreeBody({ worktree, variant }: { worktree: Worktree; variant: "full" | "calm" }) {
  // One-shot: true only in the session that created this worktree, until the claude PTY's first ensure.
  const promptPending = useSettings((s) => Boolean(s.initialPromptPending[worktree.id]));
  const prompt = worktree.prompt; // captured so TS narrowing survives into the JSX callbacks (no `!`)
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
        {variant === "full" && (
          <>
            <WorktreePane title="localhost" icon={<span className="wt-ico wt-ico--chrome" aria-hidden />} worktreeId={worktree.id} role="host" cwd={worktree.worktreePath} autostartCmd={worktree.host.startCmd} />
            <WorktreePane title="git" icon={<span className="wt-ico wt-ico--branch" aria-hidden />} worktreeId={worktree.id} role="git" cwd={worktree.worktreePath} />
          </>
        )}
        {/* attention highlight (border/glow + badge) is owned by WorktreePane via the live store. */}
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath}
          autostartCmd={claudePaneAutostart(worktree.prompt, promptPending)}
          onEnsured={() => useSettings.getState().clearInitialPrompt(worktree.id)}
          action={prompt ? (
            <button
              className="icon-btn" title={`copy prompt: ${prompt}`}
              onClick={() => navigator.clipboard.writeText(prompt).catch((e) => console.error("copy prompt failed", e))}
            ><CopyIcon /></button>
          ) : undefined}
        />
      </div>
    </div>
  );
}
