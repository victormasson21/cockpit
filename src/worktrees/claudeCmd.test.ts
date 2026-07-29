// claudeCmd.test.ts — shell-escaping + one-shot autostart selection for the claude pane.
import { describe, it, expect } from "vitest";
import { claudeAutostart, claudePaneAutostart } from "./claudeCmd";

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
});
