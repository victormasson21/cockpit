// NotepadTile.tsx — a notepad in the tiles column: the shared note editor over <id>.md, under a
// click-to-rename title.
import { useState } from "react";
import { Tile } from "../Tile";
import { NoteEditor } from "../../views/notepad/NoteEditor";
import { useNoteFile } from "../../views/notepad/useNoteFile";
import { useSettings } from "../../settings/store";
import type { NoteTile } from "../../settings/types";
import "./notepad-tile.css";

export function NotepadTile({ note }: { note: NoteTile }) {
  const file = useNoteFile(note.id);
  const renameNote = useSettings((s) => s.renameNote);
  // null = showing the title; a string = the rename draft.
  const [draft, setDraft] = useState<string | null>(null);
  // Escape unmounts the input, and React 19 fires no onBlur on unmount, so Escape discards the draft.
  const commit = () => { if (draft !== null) renameNote(note.id, draft); setDraft(null); };

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
      <NoteEditor note={file} />
    </Tile>
  );
}
