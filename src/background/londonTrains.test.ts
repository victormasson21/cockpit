import { describe, it, expect } from "vitest";
import {
  arrivalsUrl, buildTubeIndex, derivePlacements, inFrame, lineIdOf, mergeLineFeed, nextLineIndex,
  parseArrivals, placementPosition, placementVisible, reflectBehind, resolvePlacement, resolvePrevious,
  segmentAnimation, segmentSeconds, TUBE, TUBE_LINE_IDS,
  type Placement, type Sighting, type Vehicle,
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

// A hand-built Northern line, which is the case the structural disambiguation exists for: two branches
// share EUS and CTN but run through different central stations, and (in the real data) share a
// destination too, so only the station-after-next tells them apart.
//   via Bank:  KNG - EUS - BNK - LDB
//   via CX:    KNG - EUS - WRR - CHX
const NORTHERN = [
  { id: "northern", stations: [{ id: "KNG", x: 100, y: 100 }, { id: "EUS", x: 200, y: 200 }, { id: "BNK", x: 300, y: 300 }, { id: "LDB", x: 400, y: 400 }] },
  { id: "northern-1", stations: [{ id: "KNG", x: 100, y: 100 }, { id: "EUS", x: 200, y: 200 }, { id: "WRR", x: 150, y: 320 }, { id: "CHX", x: 120, y: 440 }] },
];
const index = buildTubeIndex(NORTHERN);
const vehicle = (predictions: [string, number][], fetchedAt = 0): Vehicle => ({
  vehicleId: "v1", lineId: "northern", fetchedAt,
  predictions: predictions.map(([naptanId, timeToStation]) => ({ naptanId, timeToStation })),
});

describe("resolvePrevious", () => {
  // The API gives the line but NOT the branch, and destinationNaptanId does not close the gap (spec §5).
  // The station-after-next does, structurally, with no string matching.
  it("picks the branch the station-after-next identifies", () => {
    expect(resolvePrevious("northern", "BNK", "LDB", index)).toEqual(["EUS"]);
    expect(resolvePrevious("northern", "WRR", "CHX", index)).toEqual(["EUS"]);
  });
  it("resolves a train running the other way", () => {
    expect(resolvePrevious("northern", "EUS", "KNG", index)).toEqual(["BNK", "WRR"]);
  });
  it("is one answer when two branches agree on the previous station", () => {
    expect(resolvePrevious("northern", "EUS", "BNK", index)).toEqual(["KNG"]);
  });
  it("has no answer when the pair is not adjacent anywhere on the line", () => {
    expect(resolvePrevious("northern", "BNK", "CHX", index)).toEqual([]);
  });
  it("has no answer at a terminus, where there is no previous station", () => {
    expect(resolvePrevious("northern", "KNG", "EUS", index)).toEqual([]);
  });
});

describe("segmentSeconds", () => {
  it("is the gap between the two soonest predictions", () => {
    expect(segmentSeconds(30, 150)).toBe(120);
  });
  it("falls back to a default when the gap is nonsense", () => {
    // A train sitting at a terminus can report predictions out of order or equal (spec §10.3).
    expect(segmentSeconds(90, 90)).toBe(100);
    expect(segmentSeconds(90, 30)).toBe(100);
  });
  it("clamps an implausible gap", () => {
    expect(segmentSeconds(0, 5)).toBe(20);
    expect(segmentSeconds(0, 9999)).toBe(300);
  });
});

describe("resolvePlacement", () => {
  it("puts a resolved train on its segment, part-way along", () => {
    // 120s segment, 30s to go → 75% of the way from EUS to BNK.
    const p = resolvePlacement(vehicle([["BNK", 30], ["LDB", 150]]), 0, undefined, index);
    expect(p).toMatchObject({ kind: "segment", name: "lt-BNK-EUS", reverse: true, seconds: 120 });
    expect((p as Extract<Placement, { kind: "segment" }>).progress).toBeCloseTo(0.75, 6);
  });
  it("ages the prediction by how long ago it was fetched", () => {
    // Fetched 60s ago, so 90s-to-go is now 30s: the same three-quarters along.
    const p = resolvePlacement(vehicle([["BNK", 90], ["LDB", 210]]), 60_000, undefined, index);
    expect((p as Extract<Placement, { kind: "segment" }>).progress).toBeCloseTo(0.75, 6);
  });
  it("runs the segment forwards when the travel matches the canonical order", () => {
    // EUS → WRR: "EUS" sorts first, so the baked rule already runs the way this train is going.
    const p = resolvePlacement(vehicle([["WRR", 30], ["CHX", 150]]), 0, undefined, index);
    expect(p).toMatchObject({ kind: "segment", name: "lt-EUS-WRR", reverse: false });
  });

  // ── The fallback ladder (spec §5) ────────────────────────────────────────────────────────────────
  it("glides from the last known position when the branch is ambiguous", () => {
    const previous: Sighting = { placement: { kind: "still", at: { x: 50, y: 50 } }, atMs: 0 };
    const p = resolvePlacement(vehicle([["EUS", 40], ["KNG", 160]]), 0, previous, index);
    // `to` is the indexed station, so it carries its NaptanId alongside the coordinates.
    expect(p).toEqual({ kind: "glide", from: { x: 50, y: 50 }, to: { id: "EUS", x: 200, y: 200 }, seconds: 40, progress: 0 });
  });
  it("places a first sighting back along the segment when the branch is ambiguous", () => {
    // No last position to glide from, so the only trustworthy geometry is next and after-next: the
    // train sits behind `next`, on the far side from where it is heading.
    const p = resolvePlacement(vehicle([["EUS", 30], ["KNG", 150]]), 0, undefined, index);
    expect(p).toMatchObject({ kind: "still" });
    // 75% along, so 25% of the KNG→EUS vector beyond EUS: (200,200) + 0.25 * (100,100).
    expect((p as Extract<Placement, { kind: "still" }>).at).toEqual({ x: 225, y: 225 });
  });
  it("drops a train whose next station is not in the baked network", () => {
    expect(resolvePlacement(vehicle([["NOPE", 30], ["LDB", 150]]), 0, undefined, index)).toBeNull();
  });
  it("holds a train with only one prediction left at that station", () => {
    expect(resolvePlacement(vehicle([["BNK", 40]]), 0, undefined, index))
      .toEqual({ kind: "still", at: { id: "BNK", x: 300, y: 300 } });
  });
  it("glides a train with only one prediction left, if it has been seen before", () => {
    const previous: Sighting = { placement: { kind: "still", at: { x: 0, y: 0 } }, atMs: 0 };
    expect(resolvePlacement(vehicle([["BNK", 40]]), 0, previous, index))
      .toMatchObject({ kind: "glide", to: { x: 300, y: 300 }, seconds: 40 });
  });
  it("holds a train whose whole known journey is in the past at its destination", () => {
    expect(resolvePlacement(vehicle([["BNK", 10], ["LDB", 20]], 0), 60_000, undefined, index))
      .toEqual({ kind: "still", at: { id: "LDB", x: 400, y: 400 } });
  });
  it("drops a train whose predictions are too old to age", () => {
    expect(resolvePlacement(vehicle([["BNK", 30], ["LDB", 150]], 0), 600_000, undefined, index)).toBeNull();
  });
  it("ignores a repeated station when choosing the station-after-next", () => {
    // The Circle line revisits stations, so the second prediction is not always a different place.
    const p = resolvePlacement(vehicle([["BNK", 30], ["BNK", 60], ["LDB", 150]]), 0, undefined, index);
    expect(p).toMatchObject({ kind: "segment", name: "lt-BNK-EUS" });
  });
});

describe("placementPosition", () => {
  it("holds a still placement wherever it is", () => {
    expect(placementPosition({ kind: "still", at: { x: 5, y: 6 } }, 999)).toEqual({ x: 5, y: 6 });
  });
  it("advances a glide by the time elapsed", () => {
    const p: Placement = { kind: "glide", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, seconds: 100, progress: 0 };
    expect(placementPosition(p, 25)).toEqual({ x: 25, y: 0 });
  });
  it("never runs a placement past its destination", () => {
    const p: Placement = { kind: "glide", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, seconds: 100, progress: 0 };
    expect(placementPosition(p, 500)).toEqual({ x: 100, y: 0 });
  });
});

describe("reflectBehind", () => {
  it("steps back from next, away from where the train is heading", () => {
    expect(reflectBehind({ x: 100, y: 0 }, { x: 200, y: 0 }, 0.5)).toEqual({ x: 50, y: 0 });
  });
});

describe("inFrame", () => {
  it("keeps a station inside the frame", () => {
    expect(inFrame({ x: 1000, y: 600 })).toBe(true);
  });
  it("keeps a station just outside, so a train enters smoothly", () => {
    expect(inFrame({ x: -40, y: 600 })).toBe(true);
  });
  it("drops a station far outside the frame", () => {
    // 36% of trains in service are outside the frame (spec §3): they are still tracked, just not drawn.
    expect(inFrame({ x: -500, y: -300 })).toBe(false);
  });
  it("renders a segment with one end in view", () => {
    expect(placementVisible({ kind: "segment", name: "lt-A-B", reverse: false, seconds: 60, progress: 0, from: { x: -500, y: -500 }, to: { x: 100, y: 100 } })).toBe(true);
  });
});

describe("derivePlacements", () => {
  const feed = new Map([["v1", vehicle([["BNK", 30], ["LDB", 150]])]]);

  it("returns a train per placeable vehicle", () => {
    const { trains } = derivePlacements(feed, 0, new Map(), index);
    expect(trains).toHaveLength(1);
    expect(trains[0]).toMatchObject({ vehicleId: "v1", lineId: "northern" });
  });
  // The sightings are what the ambiguous-branch fallback glides FROM, so they must record every train
  // that resolved — including ones off-frame, which have no element but are still tracked (spec §6).
  it("records a sighting for a train it does not draw", () => {
    const offFrame = new Map([["v1", vehicle([["FAR", 30]])]]);
    const farIndex = buildTubeIndex([{ id: "northern", stations: [{ id: "FAR", x: -9000, y: -9000 }] }]);
    const { trains, sightings } = derivePlacements(offFrame, 0, new Map(), farIndex);
    expect(trains).toHaveLength(0);
    expect(sightings.has("v1")).toBe(true);
  });
  it("forgets a train it can no longer place", () => {
    const gone = new Map([["v1", vehicle([["NOPE", 30]])]]);
    expect(derivePlacements(gone, 0, new Map(), index).sightings.size).toBe(0);
  });
});
