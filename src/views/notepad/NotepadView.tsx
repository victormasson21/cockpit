// NotepadView.tsx — the Cockpit Notepad tab: the editor over note.md, plus an optional claude pane that
// edits the same file.
import { noteDir } from "./api";
import { useNoteFile } from "./useNoteFile";
import { NoteEditor } from "./NoteEditor";
import { NOTE_NAME, notepadAutostart } from "../../worktrees/claudeCmd";
import { NOTEPAD_ID } from "../../worktrees/ptyId";
import { killPanes } from "../../worktrees/paneLifecycle";
import { WorktreePane } from "../worktree-column/WorktreePane";
import { PlusIcon } from "../icons";
import "../worktree-column/WorktreeColumn.css";
import "./notepad.css";

export function NotepadView({ claudeDir, onOpenClaude, onCloseClaude }: {
  claudeDir: string | null; // set = the claude pane is open, and this is its cwd
  onOpenClaude: (dir: string) => void;
  onCloseClaude: () => void;
}) {
  const note = useNoteFile(NOTE_NAME);

  // The file must exist before Claude reads it.
  const openClaude = async () => {
    await note.ensureOnDisk();
    onOpenClaude(await noteDir());
  };
  const closeClaude = async () => {
    await killPanes(NOTEPAD_ID, ["claude"]);
    onCloseClaude();
  };

  return (
    <div className="notepad">
      <NoteEditor note={note} />
      {/* A direct flex child, so the pane's own open/closed flex rules decide how much column it takes. */}
      {claudeDir && (
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          worktreeId={NOTEPAD_ID} role="claude" cwd={claudeDir} autostartCmd={notepadAutostart()}
          onClose={() => void closeClaude()}
        />
      )}
      <div className="wt-col__actions notepad__actions">
        <button
          className="wt-col__action" disabled={claudeDir !== null}
          title={claudeDir ? "already running" : "start a claude session on this note"}
          onClick={() => void openClaude()}
        ><PlusIcon /> Claude</button>
      </div>
    </div>
  );
}
