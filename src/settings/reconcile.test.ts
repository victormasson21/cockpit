import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import type { TileInstance } from "./types";

const tiles: TileInstance[] = [
  { id: "clock-1", type: "clock", config: {} },
  { id: "notes-1", type: "notes", config: { text: "" } },
];

describe("reconcile", () => {
  it("marks tiles present in the layout as placed", () => {
    const r = reconcile(tiles, ["clock-1"]);
    expect(r.placedIds).toEqual(["clock-1"]);
  });

  it("returns tiles missing from the layout as unplaced", () => {
    const r = reconcile(tiles, ["clock-1"]);
    expect(r.unplacedTiles.map((t) => t.id)).toEqual(["notes-1"]);
  });

  it("flags layout panels with no matching tile as orphans", () => {
    const r = reconcile(tiles, ["clock-1", "ghost-9"]);
    expect(r.orphanPanelIds).toEqual(["ghost-9"]);
  });

  it("handles an empty layout: everything unplaced, no orphans", () => {
    const r = reconcile(tiles, []);
    expect(r.unplacedTiles).toHaveLength(2);
    expect(r.orphanPanelIds).toEqual([]);
    expect(r.placedIds).toEqual([]);
  });

  it("dedups repeated placed panel ids", () => {
    const r = reconcile(tiles, ["clock-1", "clock-1"]);
    expect(r.placedIds).toEqual(["clock-1"]);
  });
});
