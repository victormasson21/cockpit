// claudeCmd.ts — pure builders for the claude pane's autostart line (one-shot prompt send). No IO.

// Shell-quote the prompt as one argument: POSIX single-quote idiom (' → '\''). Newlines stay
// literal — zsh keeps reading continuation lines until the closing quote, yielding one arg.
export function claudeAutostart(prompt: string): string {
  return `claude '${prompt.replace(/'/g, "'\\''")}'`;
}

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
