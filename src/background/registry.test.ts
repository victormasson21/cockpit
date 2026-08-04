import { describe, it, expect } from "vitest";
import { BACKGROUNDS, NO_BACKGROUND, resolveBackground } from "./registry";

describe("resolveBackground", () => {
  it("is off when no background has ever been chosen", () => {
    expect(resolveBackground(undefined)).toBeNull();
  });
  it("is off when off was chosen explicitly", () => {
    expect(resolveBackground(NO_BACKGROUND)).toBeNull();
  });
  it("resolves a shipped variant to its entry", () => {
    const first = BACKGROUNDS[0];
    expect(resolveBackground(first.id)).toBe(first);
  });
  // The case that matters: a cockpit.json naming a variant we have since deleted must fall back to a
  // blank ground, not blank the app or throw.
  it("falls back to off for an id we no longer ship", () => {
    expect(resolveBackground("variant-we-deleted")).toBeNull();
  });
  it("treats the empty string as off (a cleared field)", () => {
    expect(resolveBackground("")).toBeNull();
  });
});

describe("BACKGROUNDS", () => {
  it("ships at least one variant, so the picker is never empty", () => {
    expect(BACKGROUNDS.length).toBeGreaterThan(0);
  });
  it("has unique ids (they are persisted keys)", () => {
    expect(new Set(BACKGROUNDS.map((b) => b.id)).size).toBe(BACKGROUNDS.length);
  });
  it("never uses the off id for a real variant", () => {
    expect(BACKGROUNDS.map((b) => b.id)).not.toContain(NO_BACKGROUND);
  });
});
