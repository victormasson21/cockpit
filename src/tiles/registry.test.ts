import { describe, it, expect, beforeEach } from "vitest";
import { registerTile, getTile, clearRegistry, newInstance } from "./registry";

describe("tile registry", () => {
  beforeEach(() => clearRegistry());

  it("registers and retrieves a tile definition by type", () => {
    const def = { type: "clock", displayName: "Clock", defaultConfig: {}, component: () => null };
    registerTile(def);
    expect(getTile("clock")).toBe(def);
  });

  it("returns undefined for an unregistered type", () => {
    expect(getTile("nope")).toBeUndefined();
  });

  it("clones defaultConfig into a new instance (no shared reference)", () => {
    registerTile({ type: "notes", displayName: "Notes", defaultConfig: { text: "" }, component: () => null });
    const a = newInstance("notes", "1");
    (a.config as { text: string }).text = "mutated";
    // A second instance must still get a pristine default, proving the clone isn't shared.
    expect((newInstance("notes", "2").config as { text: string }).text).toBe("");
  });

  it("falls back to empty config for an unknown type", () => {
    expect(newInstance("ghost", "x")).toEqual({ id: "x", type: "ghost", config: {} });
  });
});
