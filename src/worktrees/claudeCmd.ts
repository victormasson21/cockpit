// claudeCmd.ts — pure builders for the claude pane's autostart line (one-shot prompt send). No IO.

// Shell-quote the prompt as one argument: POSIX single-quote idiom (' → '\''). Newlines stay
// literal — zsh keeps reading continuation lines until the closing quote, yielding one arg.
export function claudeAutostart(prompt: string): string {
  return `claude '${prompt.replace(/'/g, "'\\''")}'`;
}

// Autostart for the claude pane: send the prompt only on the one-shot initial spawn; plain claude otherwise.
export function claudePaneAutostart(prompt: string | undefined, pending: boolean): string {
  return pending && prompt ? claudeAutostart(prompt) : "claude";
}
