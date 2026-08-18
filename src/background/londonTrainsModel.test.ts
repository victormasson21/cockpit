import { describe, it, expect } from "vitest";
import {
  arrivalsUrl, buildTubeIndex, derivePlacements, inFrame, lineIdOf, mergeLineFeed, nextLineIndex,
  choosePrevious, keepRunning, parseArrivals, placementPosition, placementVisible, resolvePlacement,
  resolvePrevious, segmentAnimation, segmentSeconds, trainStyle, TUBE, TUBE_LINE_IDS, vehicleKey,
  type Placement, type Sighting, type Vehicle,
} from "./londonTrainsModel";

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
    expect(v).toMatchObject({ key: "central:101", vehicleId: "101", lineId: "central", fetchedAt: 1000 });
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
    ({ key: vehicleKey(lineId, id), vehicleId: id, lineId, predictions: [{ naptanId: "A", timeToStation: 30 }], fetchedAt: 0 });

  it("leaves the other lines' trains untouched", () => {
    const feed = mergeLineFeed(new Map([["victoria:1", vehicle("1", "victoria")]]), "central", [vehicle("2", "central")]);
    expect([...feed.keys()].sort()).toEqual(["central:2", "victoria:1"]);
  });
  // ⚠️ The bug this key exists for: vehicleId is the train-set number and 105 of them were live on more
  // than one line at once. Keyed on it alone, each line's refresh destroyed the other line's train —
  // 161 of 375 trains in service — and the survivor inherited a stranger's route.
  it("keeps two same-numbered trains that are on different lines", () => {
    const feed = mergeLineFeed(new Map([["victoria:205", vehicle("205", "victoria")]]), "bakerloo", [vehicle("205", "bakerloo")]);
    expect([...feed.keys()].sort()).toEqual(["bakerloo:205", "victoria:205"]);
  });
  // A refresh is the whole truth about that line: a train that has finished its journey is simply
  // absent from the new payload, and must therefore leave the map.
  it("replaces the refreshed line wholesale, so a vanished train disappears", () => {
    const feed = mergeLineFeed(new Map([["central:1", vehicle("1", "central")]]), "central", [vehicle("2", "central")]);
    expect([...feed.keys()]).toEqual(["central:2"]);
  });
  it("does not mutate the feed it was given", () => {
    const before = new Map([["central:1", vehicle("1", "central")]]);
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
  key: vehicleKey("northern", "v1"), vehicleId: "v1", lineId: "northern", fetchedAt,
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
  // Length, not the feed's timings. The gap between the two soonest predictions describes the segment
  // AFTER this one (p10 27s live), so 43% of trains had eta > it and clamped to progress 0: parked at a
  // station, then racing. Geometry is also STABLE between ticks, which is what stops every animation
  // being rewritten on every re-derive.
  it("scales with the segment's length", () => {
    expect(segmentSeconds({ x: 0, y: 0 }, { x: 82, y: 0 })).toBeCloseTo(100, 5);
    expect(segmentSeconds({ x: 0, y: 0 }, { x: 164, y: 0 })).toBeCloseTo(200, 5);
  });
  it("gives the same answer whichever way round it is asked", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 90, y: 140 };
    expect(segmentSeconds(a, b)).toBe(segmentSeconds(b, a));
  });
  it("floors a very short segment, so a dot never teleports across it", () => {
    expect(segmentSeconds({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(25);
  });
  it("caps a very long one", () => {
    expect(segmentSeconds({ x: 0, y: 0 }, { x: 5000, y: 0 })).toBe(300);
  });
});

describe("choosePrevious", () => {
  it("takes the only candidate", () => {
    expect(choosePrevious(["EUS"], null, index)).toBe("EUS");
  });
  it("has nothing to take when the branch resolved to nothing", () => {
    expect(choosePrevious([], null, index)).toBeNull();
  });
  // Both candidates are real track, so either keeps the dot ON the network — which is the whole point of
  // choosing rather than falling back to a straight line across London.
  it("prefers the candidate nearest where the train already was", () => {
    expect(choosePrevious(["BNK", "WRR"], { x: 150, y: 320 }, index)).toBe("WRR");
    expect(choosePrevious(["BNK", "WRR"], { x: 300, y: 300 }, index)).toBe("BNK");
  });
  // Deterministic rather than arbitrary: resolvePrevious walks the sequences in a fixed order, so a
  // never-seen train picks the same branch every tick instead of flickering between two.
  it("is stable when there is nothing to go on", () => {
    expect(choosePrevious(["BNK", "WRR"], null, index)).toBe("BNK");
    expect(choosePrevious(["BNK", "WRR"], null, index)).toBe("BNK");
  });
});

describe("resolvePlacement", () => {
  const EUS_BNK_SECONDS = Math.hypot(100, 100) / 0.82; // ~172.5s

  it("puts a resolved train on its segment, part-way along", () => {
    const p = resolvePlacement(vehicle([["BNK", 30], ["LDB", 150]]), 0, undefined, index);
    expect(p).toMatchObject({ kind: "segment", name: "lt-BNK-EUS", reverse: true });
    const seg = p as Extract<Placement, { kind: "segment" }>;
    expect(seg.seconds).toBeCloseTo(EUS_BNK_SECONDS, 5);
    expect(seg.progress).toBeCloseTo(1 - 30 / EUS_BNK_SECONDS, 6);
  });
  it("ages the prediction by how long ago it was fetched", () => {
    // Fetched 60s ago, so 90s-to-go is now 30s: the same place as the case above.
    const p = resolvePlacement(vehicle([["BNK", 90], ["LDB", 210]]), 60_000, undefined, index);
    expect((p as Extract<Placement, { kind: "segment" }>).progress).toBeCloseTo(1 - 30 / EUS_BNK_SECONDS, 6);
  });
  it("runs the segment forwards when the travel matches the canonical order", () => {
    // EUS → WRR: "EUS" sorts first, so the baked rule already runs the way this train is going.
    expect(resolvePlacement(vehicle([["WRR", 30], ["CHX", 150]]), 0, undefined, index))
      .toMatchObject({ kind: "segment", name: "lt-EUS-WRR", reverse: false });
  });
  it("parks a train at the station it has not left yet", () => {
    // eta longer than the segment takes: it is still dwelling back at `from`, not flying.
    expect((resolvePlacement(vehicle([["BNK", 900], ["LDB", 1000]]), 0, undefined, index) as Extract<Placement, { kind: "segment" }>).progress)
      .toBe(0);
  });

  // ── Never off the network ────────────────────────────────────────────────────────────────────────
  // Measured against the live feed: the spec's glide-to-next-station fallback put dots 34-208px off the
  // track and moved them up to 1,859px between ticks, because "next" can be most of London away. Every
  // case below therefore lands on a real segment or a real station.
  it("still picks a real segment when the branch is ambiguous", () => {
    const previous: Sighting = { placement: { kind: "still", at: { x: 150, y: 320 } }, atMs: 0 };
    expect(resolvePlacement(vehicle([["EUS", 40], ["KNG", 160]]), 0, previous, index))
      .toMatchObject({ kind: "segment", name: "lt-EUS-WRR" });
  });
  it("picks a real segment when the branch is ambiguous and the train is new", () => {
    expect(resolvePlacement(vehicle([["EUS", 30], ["KNG", 150]]), 0, undefined, index))
      .toMatchObject({ kind: "segment", name: "lt-BNK-EUS" });
  });
  it("holds at the station when only one prediction is left", () => {
    const previous: Sighting = { placement: { kind: "still", at: { x: 0, y: 0 } }, atMs: 0 };
    for (const seen of [undefined, previous]) {
      expect(resolvePlacement(vehicle([["BNK", 40]]), 0, seen, index))
        .toEqual({ kind: "still", at: { id: "BNK", x: 300, y: 300 } });
    }
  });
  it("holds at the station when the two predictions are adjacent on no branch", () => {
    expect(resolvePlacement(vehicle([["BNK", 30], ["CHX", 150]]), 0, undefined, index))
      .toEqual({ kind: "still", at: { id: "BNK", x: 300, y: 300 } });
  });
  // Parking it at its last known station was MEASURED as one of the biggest teleport sources: the next
  // refetch finds the train elsewhere and snaps it there. Vanishing until then is the honest render.
  it("drops a train whose whole known journey is already in the past", () => {
    expect(resolvePlacement(vehicle([["BNK", 10], ["LDB", 20]], 0), 60_000, undefined, index)).toBeNull();
  });
  it("drops a train whose next station is not in the baked network", () => {
    expect(resolvePlacement(vehicle([["NOPE", 30], ["LDB", 150]]), 0, undefined, index)).toBeNull();
  });
  it("drops a train whose predictions are too old to age", () => {
    expect(resolvePlacement(vehicle([["BNK", 30], ["LDB", 150]], 0), 600_000, undefined, index)).toBeNull();
  });
  it("ignores a repeated station when choosing the station-after-next", () => {
    // The Circle line revisits stations, so the second prediction is not always a different place.
    expect(resolvePlacement(vehicle([["BNK", 30], ["BNK", 60], ["LDB", 150]]), 0, undefined, index))
      .toMatchObject({ kind: "segment", name: "lt-BNK-EUS" });
  });
});

describe("keepRunning", () => {
  const seg = (progress: number, over = {}): Placement =>
    ({ kind: "segment", name: "lt-A-B", reverse: false, seconds: 100, progress, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, ...over });

  // The fix for "the whole map twitches every 11s": ~170 animations were being rewritten in unison on
  // every re-derive. Returning the PREVIOUS placement makes the emitted style byte-identical, so React
  // writes nothing and the running animation is never interrupted.
  it("keeps the running animation when the re-derive agrees with it", () => {
    const previous: Sighting = { placement: seg(0.2), atMs: 0 };
    expect(keepRunning(previous, seg(0.3), 10_000)).toBe(previous.placement);
  });
  it("interrupts it when the fresh prediction genuinely disagrees", () => {
    const previous: Sighting = { placement: seg(0.2), atMs: 0 };
    const fresh = seg(0.8);
    expect(keepRunning(previous, fresh, 10_000)).toBe(fresh);
  });
  it("interrupts it when the train has moved on to another segment", () => {
    const previous: Sighting = { placement: seg(0.2), atMs: 0 };
    const fresh = seg(0.3, { name: "lt-B-C" });
    expect(keepRunning(previous, fresh, 10_000)).toBe(fresh);
  });
  it("interrupts it when the direction flips", () => {
    const previous: Sighting = { placement: seg(0.2), atMs: 0 };
    const fresh = seg(0.3, { reverse: true });
    expect(keepRunning(previous, fresh, 10_000)).toBe(fresh);
  });
  it("has nothing to keep for a still train, or a train never seen", () => {
    const fresh = seg(0.3);
    expect(keepRunning(undefined, fresh, 0)).toBe(fresh);
    expect(keepRunning({ placement: { kind: "still", at: { x: 0, y: 0 } }, atMs: 0 }, fresh, 0)).toBe(fresh);
  });
});

describe("placementPosition", () => {
  it("holds a still placement wherever it is", () => {
    expect(placementPosition({ kind: "still", at: { x: 5, y: 6 } }, 999)).toEqual({ x: 5, y: 6 });
  });
  it("advances a segment along its chord by the time elapsed", () => {
    const p: Placement = { kind: "segment", name: "lt-A-B", reverse: false, seconds: 100, progress: 0, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    expect(placementPosition(p, 25)).toEqual({ x: 25, y: 0 });
    expect(placementPosition(p, 500)).toEqual({ x: 100, y: 0 });
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
  const feed = new Map([["northern:v1", vehicle([["BNK", 30], ["LDB", 150]])]]);

  it("returns a train per placeable vehicle", () => {
    const { trains } = derivePlacements(feed, 0, new Map(), index);
    expect(trains).toHaveLength(1);
    expect(trains[0]).toMatchObject({ key: "northern:v1", vehicleId: "v1", lineId: "northern" });
  });
  // The sightings are what the next pass compares against, so they must record every train that
  // resolved — including ones off-frame, which have no element but are still tracked (spec §6).
  it("records a sighting for a train it does not draw", () => {
    const offFrame = new Map([["northern:v1", vehicle([["FAR", 30]])]]);
    const farIndex = buildTubeIndex([{ id: "northern", stations: [{ id: "FAR", x: -9000, y: -9000 }] }]);
    const { trains, sightings } = derivePlacements(offFrame, 0, new Map(), farIndex);
    expect(trains).toHaveLength(0);
    expect(sightings.has("northern:v1")).toBe(true);
  });
  it("forgets a train it can no longer place", () => {
    const gone = new Map([["northern:v1", vehicle([["NOPE", 30]])]]);
    expect(derivePlacements(gone, 0, new Map(), index).sightings.size).toBe(0);
  });
  // A kept animation MUST keep its original start time. Stamping it with `now` each tick would slide the
  // implied position forward by one tick every tick, and the drift would grow without bound.
  it("keeps the original start time of an animation it did not interrupt", () => {
    const first = derivePlacements(feed, 0, new Map(), index);
    const second = derivePlacements(feed, 11_000, first.sightings, index);
    expect(second.sightings.get("northern:v1")).toEqual({ placement: first.sightings.get("northern:v1")!.placement, atMs: 0 });
  });
  // Load-bearing for londonTrains.tsx's memoised dot: it bails out on a shallow prop compare, so an
  // uninterrupted animation must come back as the very SAME object, not an equal one. If this ever
  // becomes toEqual-but-not-toBe, every dot on screen silently starts reconciling again every tick.
  it("hands back the very same placement object, which is what lets the layer memoise a dot", () => {
    const first = derivePlacements(feed, 0, new Map(), index);
    const second = derivePlacements(feed, 11_000, first.sightings, index);
    expect(second.trains[0].placement).toBe(first.trains[0].placement);
  });
  it("re-stamps one it did interrupt", () => {
    const first = derivePlacements(feed, 0, new Map(), index);
    // Far enough on that the fresh prediction disagrees with the running animation.
    const later = new Map([["northern:v1", vehicle([["LDB", 30], ["BNK", 150]])]]);
    expect(derivePlacements(later, 11_000, first.sightings, index).sightings.get("northern:v1")!.atMs).toBe(11_000);
  });
});

describe("trainStyle", () => {
  // The negative delay is the whole trick: the animation is the segment's full run, and starting it
  // part-way through is what puts the train where it actually is (the same idiom nightSky uses to age
  // its stars). Reverse traversal plays the one baked rule backwards.
  it("starts a segment part-way through, in the right direction", () => {
    expect(trainStyle({ kind: "segment", name: "lt-A-B", reverse: true, seconds: 120, progress: 0.25, from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }))
      .toEqual({ animationName: "lt-A-B", animationDuration: "120s", animationDelay: "-30s", animationDirection: "reverse" });
  });
  it("runs a resolved segment forwards by default", () => {
    expect(trainStyle({ kind: "segment", name: "lt-A-B", reverse: false, seconds: 60, progress: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }))
      .toMatchObject({ animationDirection: "normal", animationDelay: "-0s" });
  });
  it("pins a still train in place with no animation at all", () => {
    expect(trainStyle({ kind: "still", at: { x: 7, y: 8 } }))
      .toEqual({ animationName: "none", transform: "translate(7px, 8px)" });
  });
});
