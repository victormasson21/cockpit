// claudeCmd.test.ts — shell-escaping + one-shot autostart selection for the claude pane.
import { describe, it, expect } from "vitest";
import { claudeAutostart, cdCmd, claudePaneAutostart, isClaudeCommand, notepadAutostart, NOTEPAD_SYSTEM_PROMPT, NOTEPAD_ALLOWED_TOOLS } from "./claudeCmd";

describe("claudeAutostart", () => {
  it("wraps a plain prompt in single quotes", () => {
    expect(claudeAutostart("fix the login bug")).toBe("claude 'fix the login bug'");
  });
  it("escapes single quotes with the POSIX '\\'' idiom", () => {
    expect(claudeAutostart("don't break")).toBe("claude 'don'\\''t break'");
  });
  it("passes double quotes, $ and backticks through untouched (single quotes neutralise them)", () => {
    expect(claudeAutostart('echo "$HOME" `id`')).toBe("claude 'echo \"$HOME\" `id`'");
  });
  it("keeps newlines literal inside the quotes (zsh reads continuation lines as one arg)", () => {
    expect(claudeAutostart("line one\nline two")).toBe("claude 'line one\nline two'");
  });
});

describe("cdCmd", () => {
  it("cds into the quoted dir", () => {
    expect(cdCmd("/Users/me/CockpitWorktrees/web app/it's")).toBe("cd '/Users/me/CockpitWorktrees/web app/it'\\''s'");
  });
});

describe("isClaudeCommand", () => {
  it("accepts claude alone or with arguments, ignoring surrounding whitespace", () => {
    expect(isClaudeCommand("claude --resume be83c1b6-b9d7-4e0c-9498-16af432a9082")).toBe(true);
    expect(isClaudeCommand("  claude  ")).toBe(true);
  });
  it("rejects URLs and words that only start with claude", () => {
    expect(isClaudeCommand("https://claude.ai/code")).toBe(false);
    expect(isClaudeCommand("claudette")).toBe(false);
    expect(isClaudeCommand("")).toBe(false);
  });
});

describe("claudePaneAutostart", () => {
  it("uses the prompt only while the initial send is pending", () => {
    expect(claudePaneAutostart("fix it", true)).toBe("claude 'fix it'");
  });
  it("falls back to plain claude when not pending or no prompt", () => {
    expect(claudePaneAutostart("fix it", false)).toBe("claude");
    expect(claudePaneAutostart(undefined, true)).toBe("claude");
    expect(claudePaneAutostart("", true)).toBe("claude");
  });
  it("resumes the previous conversation on a restored pane, falling back if there is none", () => {
    expect(claudePaneAutostart(undefined, false, true)).toBe("claude --continue || claude");
    expect(claudePaneAutostart("fix it", false, true)).toBe("claude --continue || claude");
  });
  it("lets a pending one-shot prompt win over resuming", () => {
    expect(claudePaneAutostart("fix it", true, true)).toBe("claude 'fix it'");
  });
  it("defaults to plain claude when the pane is not restored", () => {
    expect(claudePaneAutostart(undefined, false, false)).toBe("claude");
    expect(claudePaneAutostart(undefined, false)).toBe("claude");
  });
  it("puts a relocated worktree's checkout last on every invocation, after any prompt", () => {
    expect(claudePaneAutostart(undefined, false, false, "/w")).toBe("claude --add-dir '/w'");
    expect(claudePaneAutostart(undefined, false, true, "/w")).toBe("claude --continue --add-dir '/w' || claude --add-dir '/w'");
    expect(claudePaneAutostart("fix it", true, false, "/w")).toBe("claude 'fix it' --add-dir '/w'");
  });
});

describe("notepadAutostart", () => {
  it("launches claude with the notepad system prompt and Edit scoped to the note", () => {
    expect(notepadAutostart()).toBe(
      `claude --append-system-prompt '${NOTEPAD_SYSTEM_PROMPT}' --allowedTools '${NOTEPAD_ALLOWED_TOOLS}'`,
    );
  });
  it("keeps the system prompt free of single quotes, so the quoting above is exact", () => {
    expect(NOTEPAD_SYSTEM_PROMPT).not.toContain("'");
  });
  it("names the note file in both the prompt and the tool scope", () => {
    expect(NOTEPAD_SYSTEM_PROMPT).toContain("note.md");
    expect(NOTEPAD_ALLOWED_TOOLS).toBe("Edit(note.md)");
  });
});
