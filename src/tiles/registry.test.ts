import { describe, it, expect, beforeEach } from "vitest";
import { registerTile, getTile, clearRegistry } from "./registry";

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
});
