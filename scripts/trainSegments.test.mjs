import { describe, it, expect } from "vitest";
import { splineD } from "./mapGeometry.mjs";
import {
  segmentName, segmentBezier, bezierPoint, arcTable, pointAtFraction, sampleStops,
  polylineDeviation, stopsFor, keyframesFor, collectSegments, bakeSegmentCss,
} from "./trainSegments.mjs";

const st = (id, x, y) => ({ id, x, y });

describe("segmentName", () => {
  // Canonical (lexicographic) order is the whole contract between the bake and the runtime: one rule
  // per station PAIR, and the runtime plays it backwards with animation-direction rather than the bake
  // emitting a mirrored twin.
  it("is the same name whichever way the train is travelling", () => {
    expect(segmentName("940GZZLUBNK", "940GZZLUWLO")).toBe(segmentName("940GZZLUWLO", "940GZZLUBNK"));
  });
  it("orders the two ids lexicographically", () => {
    expect(segmentName("B", "A")).toBe("lt-A-B");
  });
});

describe("segmentBezier", () => {
  // The dot has to follow the DRAWN line, so this arithmetic must be splineD's, not merely similar.
  // splineD emits "C c1x c1y c2x c2y x y" per span; the middle span of four points is the one with
  // both neighbours present, which is exactly what segmentBezier is given.
  it("produces the control points splineD draws", () => {
    const pts = [[0, 0], [10, 5], [20, 0], [30, 10]];
    const middle = splineD(pts).split("C")[2]; // spans: [M, 0->1, 1->2, 2->3]
    const [, c1, c2] = segmentBezier(pts[0], pts[1], pts[2], pts[3]);
    const r = (n) => Math.round(n * 10) / 10;
    expect(middle.trim().startsWith(`${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])}`)).toBe(true);
  });
  it("starts at p1 and ends at p2", () => {
    const bez = segmentBezier([0, 0], [1, 1], [2, 2], [3, 3]);
    expect(bezierPoint(bez, 0)).toEqual([1, 1]);
    expect(bezierPoint(bez, 1)).toEqual([2, 2]);
  });
});

describe("arcTable / pointAtFraction", () => {
  it("measures a straight segment's length as its chord", () => {
    const table = arcTable(segmentBezier([0, 0], [0, 0], [100, 0], [100, 0]));
    expect(table.total).toBeCloseTo(100, 3);
  });
  it("places the half-way fraction at the half-way point of a straight segment", () => {
    const table = arcTable(segmentBezier([0, 0], [0, 0], [100, 0], [100, 0]));
    const [x, y] = pointAtFraction(table, 0.5);
    expect(x).toBeCloseTo(50, 3);
    expect(y).toBeCloseTo(0, 6);
  });
  // Equal-ARC-LENGTH spacing is what makes the train's speed constant: the keyframe percentages are
  // evenly spaced, so evenly spaced positions have to mean evenly spaced DISTANCE, not parameter t.
  it("spaces samples evenly by distance, not by t", () => {
    const bez = segmentBezier([0, 0], [0, 0], [40, 40], [80, 0]);
    const spread = (points) => {
      const gaps = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
      return Math.max(...gaps) / Math.min(...gaps);
    };
    // Chord gaps are never EXACTLY equal on a curve — a bendier stretch chords shorter than it arcs — so
    // this contrasts the two samplings rather than demanding perfection. Sampling by t is visibly uneven.
    expect(spread(sampleStops(arcTable(bez), 5))).toBeLessThan(1.05);
    expect(spread(Array.from({ length: 5 }, (_, i) => bezierPoint(bez, i / 4)))).toBeGreaterThan(1.3);
  });
});

describe("stopsFor", () => {
  it("spends two stops on a segment that does not bow at all", () => {
    const table = arcTable(segmentBezier([0, 0], [0, 0], [100, 0], [100, 0]));
    expect(stopsFor(table, 0.4)).toHaveLength(2);
  });
  it("spends more stops on a curved segment", () => {
    const table = arcTable(segmentBezier([0, 100], [0, 0], [100, 0], [100, 100]));
    expect(stopsFor(table, 0.4).length).toBeGreaterThan(2);
  });
  it("gets the polyline within tolerance of the curve", () => {
    const table = arcTable(segmentBezier([0, 100], [0, 0], [100, 0], [100, 100]));
    expect(polylineDeviation(table, stopsFor(table, 0.4))).toBeLessThanOrEqual(0.4);
  });
  it("never exceeds the stop ceiling", () => {
    const table = arcTable(segmentBezier([0, 900], [0, 0], [900, 0], [900, 900]));
    expect(stopsFor(table, 0.001, 6).length).toBeLessThanOrEqual(6);
  });
});

describe("polylineDeviation", () => {
  it("is zero when the stops lie on a straight curve", () => {
    const table = arcTable(segmentBezier([0, 0], [0, 0], [100, 0], [100, 0]));
    expect(polylineDeviation(table, [[0, 0], [100, 0]])).toBeCloseTo(0, 6);
  });
});

describe("keyframesFor", () => {
  it("runs from 0% to 100% and translates in px", () => {
    expect(keyframesFor("lt-A-B", [[0, 0], [10, 20]]))
      .toBe("@keyframes lt-A-B{0%{transform:translate(0px,0px)}100%{transform:translate(10px,20px)}}");
  });
});

describe("collectSegments", () => {
  it("emits one entry per adjacent station pair", () => {
    const segs = collectSegments([{ id: "x", stations: [st("A", 0, 0), st("B", 10, 0), st("C", 20, 0)] }]);
    expect([...segs.keys()].sort()).toEqual(["lt-A-B", "lt-B-C"]);
  });
  it("orients the curve lo -> hi however the sequence runs", () => {
    const down = collectSegments([{ id: "x", stations: [st("B", 10, 0), st("A", 0, 0)] }]);
    expect(bezierPoint(segmentBezier(...down.get("lt-A-B").points), 0)).toEqual([0, 0]);
  });
  // The bake dedupes whole station SEQUENCES, so a line's branches redraw their shared trunk (~10 deep
  // on the Northern line's core). One keyframes rule per pair is deliberate: the duplicate strokes are
  // near-identical, so the dot follows one of them exactly and no one can tell which.
  it("keeps one entry when two sequences share a trunk segment", () => {
    const segs = collectSegments([
      { id: "n", stations: [st("A", 0, 0), st("B", 10, 0)] },
      { id: "n-1", stations: [st("A", 0, 0), st("B", 10, 0)] },
    ]);
    expect(segs.size).toBe(1);
  });
  // A quadruple with real neighbours describes the drawn curve; an end-of-sequence one duplicates its
  // own endpoint (splineD's rule) and is straighter than the truth. Prefer the informed occurrence.
  it("prefers an occurrence that has both neighbours", () => {
    const segs = collectSegments([
      { id: "n", stations: [st("A", 0, 0), st("B", 10, 0)] },
      { id: "n-1", stations: [st("Z", -10, 30), st("A", 0, 0), st("B", 10, 0), st("Y", 20, 30)] },
    ]);
    expect(segs.get("lt-A-B").interior).toBe(true);
  });
  it("skips a self-loop", () => {
    expect(collectSegments([{ id: "x", stations: [st("A", 0, 0), st("A", 0, 0)] }]).size).toBe(0);
  });
});

describe("bakeSegmentCss", () => {
  it("emits exactly one keyframes rule per segment", () => {
    const rules = bakeSegmentCss([{ id: "x", stations: [st("A", 0, 0), st("B", 10, 0), st("C", 20, 0)] }]);
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.startsWith("@keyframes lt-"))).toBe(true);
  });
});
