// WorktreeBody.tsx — the worktree slot body: chips + path + 3 terminal panes (+ links in full variant).
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";

type PaneRole = "host" | "git" | "claude";

export function WorktreeBody({ worktree, variant }: { worktree: Worktree; variant: "full" | "calm" }) {
  // Full variant coordinates the 3 panes' open-state so "expand" can collapse a pane's siblings.
  const [openPanes, setOpenPanes] = useState<Record<PaneRole, boolean>>({ host: true, git: true, claude: true });
  const paneProps = (role: PaneRole) =>
    variant === "full"
      ? {
          open: openPanes[role],
          onToggle: () => setOpenPanes((p) => ({ ...p, [role]: !p[role] })),
          onExpand: () => setOpenPanes({ host: false, git: false, claude: false, [role]: true }),
        }
      : {}; // calm: single pane, self-managed, no expand
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
            <WorktreePane title="localhost" icon={<span className="wt-ico wt-ico--chrome" aria-hidden />} worktreeId={worktree.id} role="host" cwd={worktree.worktreePath} autostartCmd={worktree.host.startCmd} {...paneProps("host")} />
            <WorktreePane title="git" icon={<span className="wt-ico wt-ico--branch" aria-hidden />} worktreeId={worktree.id} role="git" cwd={worktree.worktreePath} {...paneProps("git")} />
          </>
        )}
        {/* attention highlight (border/glow + badge) is owned by WorktreePane via the live store. */}
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath} autostartCmd="claude"
          {...paneProps("claude")}
        />
      </div>
    </div>
  );
}
