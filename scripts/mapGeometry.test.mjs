import { describe, it, expect } from "vitest";
import { mergeChains, simplify, projectionFor, project, toPathD, splineD } from "./mapGeometry.mjs";

describe("mergeChains", () => {
  // OSM splits a road at every junction, so the raw data is thousands of 2-point stubs. This is the
  // step that makes simplification effective: measured on the primary tier it turned a 2x reduction
  // into a 10x one.
  it("joins two ways that share an endpoint", () => {
    expect(mergeChains([[[0, 0], [1, 1]], [[1, 1], [2, 2]]])).toEqual([[[0, 0], [1, 1], [2, 2]]]);
  });
  it("joins a way that shares an endpoint in reverse", () => {
    expect(mergeChains([[[0, 0], [1, 1]], [[2, 2], [1, 1]]])).toEqual([[[0, 0], [1, 1], [2, 2]]]);
  });
  it("extends a chain from its front as well as its back", () => {
    expect(mergeChains([[[1, 1], [2, 2]], [[0, 0], [1, 1]]])).toEqual([[[0, 0], [1, 1], [2, 2]]]);
  });
  it("leaves disconnected ways alone", () => {
    const lines = [[[0, 0], [1, 1]], [[5, 5], [6, 6]]];
    expect(mergeChains(lines)).toHaveLength(2);
  });
  it("never drops or duplicates a point across a merge", () => {
    const merged = mergeChains([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]]]);
    expect(merged).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]]);
  });
});

describe("simplify", () => {
  it("drops a point that lies on the straight line between its neighbours", () => {
    expect(simplify([[0, 0], [5, 0], [10, 0]], 1)).toEqual([[0, 0], [10, 0]]);
  });
  it("keeps a point that deviates by more than the tolerance", () => {
    expect(simplify([[0, 0], [5, 4], [10, 0]], 1)).toHaveLength(3);
  });
  it("always keeps both endpoints", () => {
    const out = simplify([[0, 0], [1, 0], [2, 0], [3, 0]], 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([3, 0]);
  });
  it("returns short inputs untouched", () => {
    expect(simplify([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]]);
  });
});

describe("projectionFor", () => {
  const BBOX = { west: -0.2549, east: 0.0495, south: 51.448, north: 51.566 };

  // The correction DIVIDES: a degree of longitude covers less ground than a degree of latitude this
  // far north, so pixels-per-degree of latitude is the LARGER number. Multiplying instead (an easy
  // slip, and one made while scoping this) squashes London vertically.
  it("scales latitude more than longitude", () => {
    const p = projectionFor(BBOX, 2000);
    expect(p.scaleY).toBeGreaterThan(p.scaleX);
  });
  // The whole point of the correction: 21km x 13km of real ground must come out ~1.6:1 in pixels.
  it("produces a frame with the same aspect ratio as the real ground", () => {
    const p = projectionFor(BBOX, 2000);
    expect(p.width / p.height).toBeCloseTo(1.6, 1);
  });
  it("puts the north-west corner of the bbox at the origin", () => {
    const p = projectionFor(BBOX, 2000);
    expect(project(BBOX.north, BBOX.west, p)).toEqual([0, 0]);
  });
  it("puts the south-east corner at the far corner of the frame", () => {
    const p = projectionFor(BBOX, 2000);
    const [x, y] = project(BBOX.south, BBOX.east, p);
    expect(x).toBeCloseTo(p.width, 0);
    expect(y).toBeCloseTo(p.height, 0);
  });
});

describe("toPathD", () => {
  // One <path> per class is what keeps the layer at ~7 nodes instead of the ~13,600 ways OSM returns:
  // a single d string may hold many DISCONNECTED subpaths.
  it("emits one subpath per line, in a single string", () => {
    expect(toPathD([[[0, 0], [1, 1]], [[5, 5], [6, 6]]])).toBe("M0 0L1 1M5 5L6 6");
  });
  it("rounds to whole pixels, because the render target is ~10m per pixel", () => {
    expect(toPathD([[[0.4, 0.6], [1.5, 1.4]]])).toBe("M0 1L2 1");
  });
  it("drops consecutive duplicates created by that rounding", () => {
    expect(toPathD([[[0, 0], [0.2, 0.2], [5, 5]]])).toBe("M0 0L5 5");
  });
  it("skips a line that rounds away to a single point", () => {
    expect(toPathD([[[0, 0], [0.1, 0.1]]])).toBe("");
  });
});

describe("splineD", () => {
  // TfL's lineStrings are station-to-station CHORDS, not track geometry (the Victoria line returns 16
  // coordinates for 16 stations), so the tube layer is polygonal straight from the API.
  it("starts at the first point", () => {
    expect(splineD([[0, 0], [10, 10], [20, 0]])).toMatch(/^M0 0/);
  });
  it("emits a cubic segment per gap between points", () => {
    expect(splineD([[0, 0], [10, 10], [20, 0]]).match(/C/g)).toHaveLength(2);
  });
  it("falls back to a straight subpath when there is nothing to curve", () => {
    expect(splineD([[0, 0], [10, 10]])).toBe("M0 0L10 10");
  });
});
