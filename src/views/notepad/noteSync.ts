// noteSync.ts — pure decisions for keeping the Notepad editor and note.md in step. No IO, no React.

// Reload from disk only when the file is newer than what the editor last wrote or loaded AND the editor
// holds nothing unsaved — unsaved typing always wins, and its next save overwrites the file.
export function shouldReload({ diskMtime, knownMtime, dirty }: { diskMtime: number; knownMtime: number; dirty: boolean }): boolean {
  return !dirty && diskMtime > knownMtime;
}

// After a reload the caret stays where it was, clamped to the new text.
export const clampCaret = (pos: number, length: number): number => Math.max(0, Math.min(pos, length));
