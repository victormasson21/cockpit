import { describe, it, expect } from "vitest";
import { buildTubeIndex, lineIdOf, segmentAnimation, TUBE, TUBE_LINE_IDS } from "./londonTrains";

const st = (id: string, x: number, y: number) => ({ id, x, y });

describe("lineIdOf", () => {
  // The baked sequence ids are `central`, `central-1`, …: one line, many branches. Only the numeric
  // suffix is the branch — `hammersmith-city` and `waterloo-city` are line names with a hyphen in them.
  it("strips a branch suffix", () => {
    expect(lineIdOf("northern-2")).toBe("northern");
  });
  it("leaves a hyphenated line name alone", () => {
    expect(lineIdOf("hammersmith-city")).toBe("hammersmith-city");
    expect(lineIdOf("waterloo-city-3")).toBe("waterloo-city");
  });
});

describe("buildTubeIndex", () => {
  it("groups every branch of a line under the line id", () => {
    const index = buildTubeIndex([
      { id: "northern", stations: [st("A", 0, 0), st("B", 1, 1)] },
      { id: "northern-1", stations: [st("A", 0, 0), st("C", 2, 2)] },
    ]);
    expect(index.sequencesByLine.get("northern")).toHaveLength(2);
  });
  it("indexes every station by NaptanId", () => {
    const index = buildTubeIndex([{ id: "x", stations: [st("A", 3, 4)] }]);
    expect(index.stations.get("A")).toEqual({ id: "A", x: 3, y: 4 });
  });
  it("lists each line once", () => {
    const index = buildTubeIndex([
      { id: "x", stations: [st("A", 0, 0)] },
      { id: "x-1", stations: [st("B", 1, 1)] },
    ]);
    expect(index.lineIds).toEqual(["x"]);
  });
});

describe("the real baked data", () => {
  it("covers the 11 Underground lines", () => {
    expect(TUBE_LINE_IDS).toHaveLength(11);
    expect(TUBE_LINE_IDS).toContain("waterloo-city");
  });
  it("indexes every station the sequences mention", () => {
    expect(TUBE.stations.size).toBeGreaterThan(200);
  });
});

describe("segmentAnimation", () => {
  it("names the pair canonically and flags the direction", () => {
    expect(segmentAnimation("A", "B")).toEqual({ name: "lt-A-B", reverse: false });
    expect(segmentAnimation("B", "A")).toEqual({ name: "lt-A-B", reverse: true });
  });
  it("names a real pair of NaptanIds", () => {
    expect(segmentAnimation("940GZZLUWLO", "940GZZLUBNK").name).toBe("lt-940GZZLUBNK-940GZZLUWLO");
  });
  // That these names match the BAKED rules is pinned in scripts/trainSegments.test.mjs, which can read
  // the generated stylesheet off disk — a `?raw` import of a .css yields an empty string under Vite,
  // and this project has no @types/node for the fs route.
});
