// keys.ts — pure helpers for translating Shift+Enter into Claude Code's multiline newline escape.

// Claude Code (and POSIX shells) treat a backslash immediately before a newline as a line continuation
// instead of a submit. Sending this on Shift+Enter inserts a newline without submitting. Text, not
// bytes, so it goes through the one pane write path (ptyPane owns the UTF-8 conversion).
export const NEWLINE_ESCAPE = "\\\r"; // '\' then CR

// True only on the Shift+Enter keydown — the moment we want to insert a newline rather than submit.
export function shouldInsertNewline(e: { type: string; key: string; shiftKey: boolean }): boolean {
  return e.type === "keydown" && e.key === "Enter" && e.shiftKey;
}

const WORD_BACK = "\x1bb";
const WORD_FORWARD = "\x1bf";
const LINE_START = "\x01";
const LINE_END = "\x05";

const CURSOR_MOVES: Readonly<Record<string, { word: string; line: string } | undefined>> = {
  ArrowLeft: { word: WORD_BACK, line: LINE_START },
  ArrowRight: { word: WORD_FORWARD, line: LINE_END },
};

export function cursorMoveSequence(e: {
  type: string;
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): string | undefined {
  const move = CURSOR_MOVES[e.key];
  const exactlyOneOfOptionOrCmd = e.altKey !== e.metaKey;
  if (!move || e.type !== "keydown" || e.ctrlKey || e.shiftKey || !exactlyOneOfOptionOrCmd) return undefined;
  return e.altKey ? move.word : move.line;
}
