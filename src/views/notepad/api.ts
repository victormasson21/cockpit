// api.ts — typed wrappers over the notepad IPC commands (one note.md under the settings dir).
import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust Note: the text plus the file's mtime, the frontend's "is this newer than mine" stamp.
export interface Note {
  text: string;
  mtimeMs: number;
}

export const readNote = () => invoke<Note>("note_read");
// Resolves to the mtime the write produced.
export const writeNote = (text: string) => invoke<number>("note_write", { text });
// The note's directory (created if missing) — the claude pane's cwd.
export const noteDir = () => invoke<string>("note_dir");
