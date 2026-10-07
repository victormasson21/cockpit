// notes.ts — the notepad tiles' persisted list (id = file name, title = tile heading).
import type { NoteTile } from "../types";
import type { SettingsSlice } from "../storeState";

export const DEFAULT_NOTE: NoteTile = { id: "note-1", title: "Notes" };

// Same rule as the To Do tabs: an empty list means the synthesised default, so no load-time migration.
export const notesOf = (notes: NoteTile[] | undefined): NoteTile[] => (notes?.length ? notes : [DEFAULT_NOTE]);

export interface NotesSlice {
  renameNote: (id: string, title: string) => void;
}

export const createNotesSlice: SettingsSlice<NotesSlice> = (_set, get) => ({
  // An empty title reverts: a heading-less tile has nothing to click to rename it again.
  renameNote: (id, title) =>
    get().setCockpit((c) => {
      const trimmed = title.trim();
      if (!trimmed) return c;
      return { ...c, notes: notesOf(c.notes).map((n) => (n.id === id ? { ...n, title: trimmed } : n)) };
    }),
});
