import { describe, it, expect } from "vitest";
import { BACKGROUNDS, DEFAULT_BACKGROUND, NO_BACKGROUND, resolveBackground } from "./registry";

const theDefault = BACKGROUNDS.find((b) => b.id === DEFAULT_BACKGROUND);

describe("resolveBackground", () => {
  // Explicit off is the ONLY route to no background; every other unresolvable value means "no valid
  // stored choice", which is the fresh-install situation and gets the default.
  it("is off only when off was chosen explicitly", () => {
    expect(resolveBackground(NO_BACKGROUND)).toBeNull();
  });
  it("shows the default when no background has ever been chosen", () => {
    expect(resolveBackground(undefined)).toBe(theDefault);
  });
  it("resolves a shipped variant to its entry", () => {
    const first = BACKGROUNDS[0];
    expect(resolveBackground(first.id)).toBe(first);
  });
  // The case that matters: a cockpit.json naming a variant we have since deleted must degrade to the
  // default, never blank the app or throw.
  it("falls back to the default for an id we no longer ship", () => {
    expect(resolveBackground("variant-we-deleted")).toBe(theDefault);
  });
  it("treats the empty string as unset, not as off", () => {
    expect(resolveBackground("")).toBe(theDefault);
  });
});

describe("DEFAULT_BACKGROUND", () => {
  it("names a variant that is actually shipped", () => {
    expect(theDefault).toBeDefined();
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
  it("ships the London map variant", () => {
    expect(BACKGROUNDS.some((b) => b.id === "london-map")).toBe(true);
  });
  // Both the TfL and OpenStreetMap licences require credit, and a background has nowhere to show it —
  // so the variant carries the text and the picker displays it. An empty string would silently
  // satisfy the type while breaching the licence.
  it("has non-empty attribution wherever attribution is declared", () => {
    for (const b of BACKGROUNDS) {
      if (b.attribution !== undefined) expect(b.attribution.trim().length).toBeGreaterThan(0);
    }
  });
  it("credits both open-data sources on the London map", () => {
    const attribution = BACKGROUNDS.find((b) => b.id === "london-map")?.attribution ?? "";
    expect(attribution).toMatch(/TfL/);
    expect(attribution).toMatch(/OpenStreetMap/);
  });
});
