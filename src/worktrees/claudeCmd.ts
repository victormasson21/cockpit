// claudeCmd.ts — pure builders and checks for claude command lines: pane autostart, Copy cd, link commands. No IO.

// Shell-quote the prompt as one argument: POSIX single-quote idiom (' → '\''). Newlines stay
// literal — zsh keeps reading continuation lines until the closing quote, yielding one arg.
const shellQuote = (arg: string): string => `'${arg.replace(/'/g, "'\\''")}'`;

export function claudeAutostart(prompt: string): string {
  return `claude ${shellQuote(prompt)}`;
}

export function cdCmd(dir: string): string {
  return `cd ${shellQuote(dir)}`;
}

export const isClaudeCommand = (text: string): boolean => /^claude(\s|$)/.test(text.trim());

// Resume this worktree's last conversation when the pane came back from a previous session. `|| claude`
// covers `--continue` exiting non-zero because there is nothing to continue (claude was never used
// here), which would otherwise leave the pane on a bare shell showing an error.
export const CONTINUE_CMD = "claude --continue || claude";

// Autostart for the claude pane, in precedence order: a pending one-shot deduce prompt, then resuming a
// restored pane, then a plain session.
export function claudePaneAutostart(prompt: string | undefined, pending: boolean, restored = false): string {
  if (pending && prompt) return claudeAutostart(prompt);
  return restored ? CONTINUE_CMD : "claude";
}

export const NOTE_FILE = "note.md";

// What the notepad's claude session is told about its job. The note is the deliverable; the terminal is
// for instructions. No single quotes in here: the launch wraps it in them verbatim.
export const NOTEPAD_SYSTEM_PROMPT =
  `The user is editing a notepad: the file ./${NOTE_FILE} in the current directory. ` +
  `Read it before acting. When asked to change it, edit it in place with the Edit tool and change only ` +
  `what the request covers. Reply briefly in the terminal; the note itself is the output.`;

// Edit scoped to the note. The spelling is pinned by the packaged-app smoke (spec → Claude session).
export const NOTEPAD_ALLOWED_TOOLS = `Edit(${NOTE_FILE})`;

export function notepadAutostart(): string {
  return `claude --append-system-prompt ${shellQuote(NOTEPAD_SYSTEM_PROMPT)} --allowedTools ${shellQuote(NOTEPAD_ALLOWED_TOOLS)}`;
}
