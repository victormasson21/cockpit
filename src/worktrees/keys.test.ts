import { describe, it, expect } from "vitest";
import { shouldInsertNewline, NEWLINE_ESCAPE } from "./keys";

describe("shouldInsertNewline", () => {
  it("is true for Shift+Enter keydown", () => {
    expect(shouldInsertNewline({ type: "keydown", key: "Enter", shiftKey: true })).toBe(true);
  });
  it("is false for plain Enter (that should submit)", () => {
    expect(shouldInsertNewline({ type: "keydown", key: "Enter", shiftKey: false })).toBe(false);
  });
  it("is false on keyup (fires once, on keydown)", () => {
    expect(shouldInsertNewline({ type: "keyup", key: "Enter", shiftKey: true })).toBe(false);
  });
  it("is false for other keys with Shift held", () => {
    expect(shouldInsertNewline({ type: "keydown", key: "a", shiftKey: true })).toBe(false);
  });
});

describe("NEWLINE_ESCAPE", () => {
  it("is backslash followed by carriage return", () => {
    expect(NEWLINE_ESCAPE).toEqual([92, 13]);
  });
});
