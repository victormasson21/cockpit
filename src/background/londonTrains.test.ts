import { describe, it, expect } from "vitest";
import {
  arrivalsUrl, buildTubeIndex, lineIdOf, mergeLineFeed, nextLineIndex, parseArrivals, segmentAnimation,
  TUBE, TUBE_LINE_IDS, type Vehicle,
} from "./londonTrains";

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

const arrival = (vehicleId: string, naptanId: string, timeToStation: number, lineId = "central") =>
  ({ vehicleId, naptanId, timeToStation, lineId });

describe("arrivalsUrl", () => {
  it("asks for one line at a time", () => {
    // One line per tick, not all 11: the full payload is 3.9 MB and a large main-thread JSON parse
    // (spec §4). ~350 KB parses in ~5ms, and all 11 still refresh about every two minutes.
    expect(arrivalsUrl("waterloo-city")).toBe("https://api.tfl.gov.uk/Line/waterloo-city/Arrivals");
  });
});

describe("parseArrivals", () => {
  it("groups predictions by vehicle, soonest first", () => {
    const [v] = parseArrivals([arrival("101", "B", 200), arrival("101", "A", 30)], "central", 1000);
    expect(v.predictions.map((p) => p.naptanId)).toEqual(["A", "B"]);
    expect(v).toMatchObject({ vehicleId: "101", lineId: "central", fetchedAt: 1000 });
  });
  it("returns one entry per vehicle", () => {
    expect(parseArrivals([arrival("101", "A", 30), arrival("102", "A", 60)], "central", 0)).toHaveLength(2);
  });
  it("drops rows missing the fields a placement needs", () => {
    const rows = [arrival("", "A", 30), { vehicleId: "1", timeToStation: 5, lineId: "central" }, arrival("2", "A", NaN)];
    expect(parseArrivals(rows, "central", 0)).toEqual([]);
  });
  it("ignores a row belonging to another line", () => {
    expect(parseArrivals([arrival("101", "A", 30, "victoria")], "central", 0)).toEqual([]);
  });
  it("survives a payload that is not an array", () => {
    expect(parseArrivals({ message: "rate limited" }, "central", 0)).toEqual([]);
  });
});

describe("mergeLineFeed", () => {
  const vehicle = (id: string, lineId: string): Vehicle =>
    ({ vehicleId: id, lineId, predictions: [{ naptanId: "A", timeToStation: 30 }], fetchedAt: 0 });

  it("leaves the other lines' trains untouched", () => {
    const feed = mergeLineFeed(new Map([["1", vehicle("1", "victoria")]]), "central", [vehicle("2", "central")]);
    expect([...feed.keys()].sort()).toEqual(["1", "2"]);
  });
  // A refresh is the whole truth about that line: a train that has finished its journey is simply
  // absent from the new payload, and must therefore leave the map.
  it("replaces the refreshed line wholesale, so a vanished train disappears", () => {
    const feed = mergeLineFeed(new Map([["1", vehicle("1", "central")]]), "central", [vehicle("2", "central")]);
    expect([...feed.keys()]).toEqual(["2"]);
  });
  it("does not mutate the feed it was given", () => {
    const before = new Map([["1", vehicle("1", "central")]]);
    mergeLineFeed(before, "central", []);
    expect(before.size).toBe(1);
  });
});

describe("nextLineIndex", () => {
  it("advances round the rota", () => {
    expect(nextLineIndex(0, 11)).toBe(1);
  });
  it("wraps at the end", () => {
    expect(nextLineIndex(10, 11)).toBe(0);
  });
});
