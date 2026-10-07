// useNoteFile.ts — keeps an editor and one note file in step: debounced save, mtime poll, flush on unmount.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { readNote, writeNote } from "./api";
import { clampCaret, shouldReload } from "./noteSync";

const SAVE_DEBOUNCE_MS = 500; // same figure as the settings save: absorb typing, not thrash the disk
const POLL_MS = 1000;

export interface NoteFile {
  text: string;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (next: string) => void;
  onBlur: () => void;
  ensureOnDisk: () => Promise<void>;
}

export function useNoteFile(name: string): NoteFile {
  const [text, setText] = useState("");
  // Refs, not state, for what the poll and the debounced save read: they must see the latest values
  // without re-arming the interval or the timer on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;
  const dirtyRef = useRef(false);
  const knownMtimeRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Write what the editor holds now. Dirty clears only if nothing was typed during the write.
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const snapshot = textRef.current;
    try {
      knownMtimeRef.current = await writeNote(name, snapshot);
      if (textRef.current === snapshot) dirtyRef.current = false;
    } catch (e) {
      console.error("note save failed", e);
    }
  }, [name]);

  const onChange = (next: string) => {
    setText(next);
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };

  const onBlur = () => { if (dirtyRef.current) void save(); };

  // Poll the file: an external edit (Claude's) lands in the editor only when nothing here is unsaved.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const note = await readNote(name);
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
  }, [name]);

  // A tab switch unmounts the view; unsaved typing must not die with it.
  useEffect(() => () => { if (dirtyRef.current) void save(); }, [save]);

  // Flush unsaved typing, or write the empty note when the file has never existed (mtime 0). A clean
  // editor with a file on disk saves nothing — a save there could overwrite an external edit the poll
  // has not seen yet.
  const ensureOnDisk = async () => {
    if (dirtyRef.current || knownMtimeRef.current === 0) await save();
  };

  return { text, editorRef, onChange, onBlur, ensureOnDisk };
}
