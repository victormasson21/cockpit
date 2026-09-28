// noteSync.test.ts — the reload rule between the editor and note.md, and caret clamping after a reload.
import { describe, expect, it } from "vitest";
import { clampCaret, shouldReload } from "./noteSync";

describe("shouldReload", () => {
  it("reloads when the file is newer and the editor is clean", () => {
    expect(shouldReload({ diskMtime: 200, knownMtime: 100, dirty: false })).toBe(true);
  });
  it("never reloads over unsaved typing — the editor's next save wins", () => {
    expect(shouldReload({ diskMtime: 200, knownMtime: 100, dirty: true })).toBe(false);
  });
  it("ignores an equal mtime, so the editor's own write never bounces back", () => {
    expect(shouldReload({ diskMtime: 100, knownMtime: 100, dirty: false })).toBe(false);
  });
  it("ignores an older mtime — a vanished file reads as 0 and must not blank the editor", () => {
    expect(shouldReload({ diskMtime: 0, knownMtime: 100, dirty: false })).toBe(false);
  });
  it("loads a fresh file on first poll (nothing known yet)", () => {
    expect(shouldReload({ diskMtime: 1, knownMtime: 0, dirty: false })).toBe(true);
  });
});

describe("clampCaret", () => {
  it("keeps a caret that still fits", () => expect(clampCaret(5, 10)).toBe(5));
  it("pulls a caret past the end back to the end", () => expect(clampCaret(50, 10)).toBe(10));
  it("never goes negative", () => expect(clampCaret(-3, 10)).toBe(0));
});
