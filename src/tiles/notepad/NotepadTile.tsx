// NotepadTile.tsx — a notepad in the tiles column: the note rendered as markdown, swapped for the shared
// editor over <id>.md while you edit it, under a click-to-rename title.
import { useEffect, useState, type ReactNode } from "react";
import Markdown, { type MarkdownToJSX } from "markdown-to-jsx/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Tile } from "../Tile";
import { NoteEditor } from "../../views/notepad/NoteEditor";
import { useNoteFile } from "../../views/notepad/useNoteFile";
import { useSettings } from "../../settings/store";
import type { NoteTile } from "../../settings/types";
import "./notepad-tile.css";

// A link in the webview would navigate the whole app away; open it in the browser instead, and keep
// the click from also switching the note into edit mode.
function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (href) void openUrl(href); }}>
      {children}
    </a>
  );
}

// Raw HTML stays text: the note is also written by Claude, and markup in the webview can reach Tauri IPC.
const MARKDOWN_OPTIONS: MarkdownToJSX.Options = {
  disableParsingRawHTML: true,
  overrides: { a: { component: ExternalLink } },
};

export function NotepadTile({ note }: { note: NoteTile }) {
  const file = useNoteFile(note.id);
  const renameNote = useSettings((s) => s.renameNote);
  // null = showing the title; a string = the rename draft.
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Escape unmounts the input, and React 19 fires no onBlur on unmount, so Escape discards the draft.
  const commit = () => { if (draft !== null) renameNote(note.id, draft); setDraft(null); };

  // Entering edit mode mounts the textarea: focus it with the caret at the end of the note.
  useEffect(() => {
    const el = file.editorRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing, file.editorRef]);

  const title = draft !== null ? (
    <input
      className="notepad-tile__title-edit" autoFocus value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  ) : (
    <button className="notepad-tile__title" title="Click to rename" onClick={() => setDraft(note.title)}>{note.title}</button>
  );

  return (
    <Tile title={title} icon={<span>✎</span>} className="notepad-tile">
      {editing ? (
        <div className="notepad-tile__edit" onBlur={() => setEditing(false)}>
          <NoteEditor note={file} />
        </div>
      ) : (
        <div className="notepad-tile__view" onClick={() => setEditing(true)}>
          {file.text.trim()
            ? <Markdown options={MARKDOWN_OPTIONS}>{file.text}</Markdown>
            : <span className="notepad-tile__placeholder">Click to write…</span>}
        </div>
      )}
    </Tile>
  );
}
