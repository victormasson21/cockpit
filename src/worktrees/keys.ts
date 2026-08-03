// keys.ts — pure helpers for translating Shift+Enter into Claude Code's multiline newline escape.

// Claude Code (and POSIX shells) treat a backslash immediately before a newline as a line continuation
// instead of a submit. Sending this on Shift+Enter inserts a newline without submitting. Text, not
// bytes, so it goes through the one pane write path (ptyPane owns the UTF-8 conversion).
export const NEWLINE_ESCAPE = "\\\r"; // '\' then CR

// True only on the Shift+Enter keydown — the moment we want to insert a newline rather than submit.
export function shouldInsertNewline(e: { type: string; key: string; shiftKey: boolean }): boolean {
  return e.type === "keydown" && e.key === "Enter" && e.shiftKey;
}
