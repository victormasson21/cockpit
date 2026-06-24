// ScratchBody.tsx — a slot holding a single scratch login-shell pane (no repo/branch, no chips/path/links).
import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { WorktreePane } from "./WorktreePane";

export function ScratchBody({ scratchId }: { scratchId: string }) {
  // The shell needs a real cwd; default it to the user's home (resolved once via the Tauri path API).
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => { homeDir().then(setHome).catch(() => setHome("")); }, []);
  if (home === null) return <div className="wt-col__empty">starting terminal…</div>;
  return (
    <div className="wt-col__body">
      <div className="wt-col__panes">
        <WorktreePane title="Terminal" icon={<span className="wt-ico wt-ico--terminal" aria-hidden />} worktreeId={scratchId} role="shell" cwd={home} />
      </div>
    </div>
  );
}
