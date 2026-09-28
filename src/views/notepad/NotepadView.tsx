// NotepadView.tsx — the Cockpit Notepad tab: a textarea over note.md, kept in step with the file by a
// poll, plus an optional claude pane that edits the same file.
import { useCallback, useEffect, useRef, useState } from "react";
import { readNote, writeNote, noteDir } from "./api";
import { clampCaret, shouldReload } from "./noteSync";
import { notepadAutostart } from "../../worktrees/claudeCmd";
import { NOTEPAD_ID } from "../../worktrees/ptyId";
import { killPanes } from "../../worktrees/paneLifecycle";
import { WorktreePane } from "../worktree-column/WorktreePane";
import { CodeOverlay, syncScroll } from "./CodeOverlay";
import { PlusIcon } from "../icons";
import "../worktree-column/WorktreeColumn.css";
import "./notepad.css";

const SAVE_DEBOUNCE_MS = 500; // same figure as the settings save: absorb typing, not thrash the disk
const POLL_MS = 1000;

export function NotepadView({ claudeDir, onOpenClaude, onCloseClaude }: {
  claudeDir: string | null; // set = the claude pane is open, and this is its cwd
  onOpenClaude: (dir: string) => void;
  onCloseClaude: () => void;
}) {
  const [text, setText] = useState("");
  // Refs, not state, for what the poll and the debounced save read: they must see the latest values
  // without re-arming the interval or the timer on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;
  const dirtyRef = useRef(false);
  const knownMtimeRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);

  // Write what the editor holds now. Dirty clears only if nothing was typed during the write.
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const snapshot = textRef.current;
    try {
      knownMtimeRef.current = await writeNote(snapshot);
      if (textRef.current === snapshot) dirtyRef.current = false;
    } catch (e) {
      console.error("note save failed", e);
    }
  }, []);

  const onChange = (next: string) => {
    setText(next);
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };

  // Poll the file: an external edit (Claude's) lands in the editor only when nothing here is unsaved.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const note = await readNote();
        if (cancelled) return;
        if (!shouldReload({ diskMtime: note.mtimeMs, knownMtime: knownMtimeRef.current, dirty: dirtyRef.current })) return;
        knownMtimeRef.current = note.mtimeMs;
        const el = editorRef.current;
        setText(note.text);
        // Restore the caret after React has applied the new value; only when the editor has focus,
        // since setSelectionRange scrolls the textarea.
        if (el && document.activeElement === el) {
          const caret = clampCaret(el.selectionStart, note.text.length);
          requestAnimationFrame(() => el.setSelectionRange(caret, caret));
        }
      } catch (e) {
        console.error("note read failed", e);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // A tab switch unmounts the view; unsaved typing must not die with it.
  useEffect(() => () => { if (dirtyRef.current) void save(); }, [save]);

  // The file must exist before Claude reads it: flush unsaved typing, or write the empty note when the
  // file has never existed (mtime 0). A clean editor with a file on disk saves nothing — a save there
  // could overwrite a Claude edit the poll has not seen yet.
  const openClaude = async () => {
    if (dirtyRef.current || knownMtimeRef.current === 0) await save();
    onOpenClaude(await noteDir());
  };
  const closeClaude = async () => {
    await killPanes(NOTEPAD_ID, ["claude"]);
    onCloseClaude();
  };

  return (
    <div className="notepad">
      {/* Overlay first, textarea (positioned) after: caret and selection paint over the coloured glyphs. */}
      <div className="notepad__editor-wrap">
        <CodeOverlay ref={overlayRef} editorRef={editorRef} text={text} />
        <textarea
          ref={editorRef} className="notepad__text notepad__editor" value={text} placeholder="Paste or type…" spellCheck={false}
          onChange={(e) => onChange(e.target.value)} onBlur={() => { if (dirtyRef.current) void save(); }}
          onScroll={(e) => syncScroll(overlayRef.current, e.currentTarget)}
        />
      </div>
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
