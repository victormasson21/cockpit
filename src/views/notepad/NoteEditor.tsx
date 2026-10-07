// NoteEditor.tsx — a note's textarea over its colour overlay, driven by a useNoteFile handle.
import { useRef } from "react";
import { CodeOverlay, syncScroll } from "./CodeOverlay";
import type { NoteFile } from "./useNoteFile";
import "./notepad.css";

export function NoteEditor({ note }: { note: NoteFile }) {
  const overlayRef = useRef<HTMLPreElement>(null);
  return (
    // Overlay first, textarea (positioned) after: caret and selection paint over the coloured glyphs.
    <div className="notepad__editor-wrap">
      <CodeOverlay ref={overlayRef} editorRef={note.editorRef} text={note.text} />
      <textarea
        ref={note.editorRef} className="notepad__text notepad__editor" value={note.text} placeholder="Paste or type…" spellCheck={false}
        onChange={(e) => note.onChange(e.target.value)} onBlur={note.onBlur}
        onScroll={(e) => syncScroll(overlayRef.current, e.currentTarget)}
      />
    </div>
  );
}
