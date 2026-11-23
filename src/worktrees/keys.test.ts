import { describe, it, expect } from "vitest";
import { shouldInsertNewline, NEWLINE_ESCAPE, cursorMoveSequence } from "./keys";

const chord = (key: string, modifiers: Partial<Parameters<typeof cursorMoveSequence>[0]> = {}) => ({
  type: "keydown",
  key,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("cursorMoveSequence", () => {
  it("moves back a word on Option+Left", () => {
    expect(cursorMoveSequence(chord("ArrowLeft", { altKey: true }))).toBe("\x1bb");
  });
  it("moves forward a word on Option+Right", () => {
    expect(cursorMoveSequence(chord("ArrowRight", { altKey: true }))).toBe("\x1bf");
  });
  it("moves to the line start on Cmd+Left", () => {
    expect(cursorMoveSequence(chord("ArrowLeft", { metaKey: true }))).toBe("\x01");
  });
  it("moves to the line end on Cmd+Right", () => {
    expect(cursorMoveSequence(chord("ArrowRight", { metaKey: true }))).toBe("\x05");
  });
  it("leaves a plain arrow to xterm", () => {
    expect(cursorMoveSequence(chord("ArrowLeft"))).toBeUndefined();
  });
  it("leaves the vertical arrows to xterm", () => {
    expect(cursorMoveSequence(chord("ArrowUp", { altKey: true }))).toBeUndefined();
  });
  it("leaves Option+Cmd held together to xterm", () => {
    expect(cursorMoveSequence(chord("ArrowLeft", { altKey: true, metaKey: true }))).toBeUndefined();
  });
  it("leaves Shift and Ctrl chords to xterm", () => {
    expect(cursorMoveSequence(chord("ArrowLeft", { altKey: true, shiftKey: true }))).toBeUndefined();
    expect(cursorMoveSequence(chord("ArrowLeft", { metaKey: true, ctrlKey: true }))).toBeUndefined();
  });
  it("fires once, on keydown", () => {
    expect(cursorMoveSequence(chord("ArrowLeft", { altKey: true, type: "keyup" }))).toBeUndefined();
  });
});

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
    expect(NEWLINE_ESCAPE).toBe("\\\r");
  });
  // It was a byte array before ptyPane owned the encoding — pin the bytes it must still produce.
  it("encodes to the same two bytes as before", () => {
    expect(Array.from(new TextEncoder().encode(NEWLINE_ESCAPE))).toEqual([92, 13]);
  });
});
