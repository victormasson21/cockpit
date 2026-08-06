import { describe, it, expect } from "vitest";
import { bakeLayer, mergeChains, simplify, projectionFor, project, toPathD, splineD, toAreaD, bakeArea } from "./mapGeometry.mjs";

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

describe("bakeLayer", () => {
  // A deliberately lopsided box: 2 degrees of longitude over 1 of latitude, so x and y scales differ
  // and a transposition cannot hide behind symmetry.
  const P = projectionFor({ west: 0, east: 2, south: 0, north: 1 }, 200);

  // THE test that earns this function its place in the tested module. Overpass hands back [lon, lat];
  // `project` takes (lat, lon). Swapping them still produces plausible-looking road geometry — just
  // somewhere other than London — and the only other check on it is a human recognising the skyline.
  it("reads each point as [lon, lat], not [lat, lon]", () => {
    expect(bakeLayer([[[1.5, 0.25], [1.8, 0.1]]], P, 1)).toBe("M150 75L180 90");
  });
  // Merging happens in lat/lon, BEFORE projecting: junction endpoints are bit-identical there, and
  // projecting first would round them apart and leave two subpaths where the road is one.
  it("joins ways sharing a lat/lon endpoint into a single subpath", () => {
    const d = bakeLayer([[[0, 0], [1, 0.5]], [[1, 0.5], [2, 1]]], P, 1);
    expect(d.match(/M/g)).toHaveLength(1);
  });
  // Tolerance is an argument, not a constant closed over from the bake script — which is what let this
  // function move out of the untested half in the first place.
  it("thins with the tolerance it is given", () => {
    const kink = [[[0, 1], [1, 0.95], [2, 1]]];
    expect(bakeLayer(kink, P, 1)).toBe("M0 0L100 5L200 0");
    expect(bakeLayer(kink, P, 20)).toBe("M0 0L200 0");
  });
});

describe("toPathD", () => {
  // One <path> per class is what keeps a whole road class at ONE DOM node instead of the ~13,600 ways
  // OSM returns: a single d string may hold many DISCONNECTED subpaths.
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

describe("toAreaD", () => {
  // Water is a filled shape, so every ring must come out CLOSED — an open subpath would fill to a
  // straight chord across the river's mouth instead of following its bank.
  it("closes each ring with Z", () => {
    expect(toAreaD([[[0, 0], [10, 0], [10, 10], [0, 0]]])).toBe("M0 0L10 0L10 10Z");
  });
  // A closed ring repeats its first point last, and Z already draws that segment.
  it("drops the repeated closing point", () => {
    expect(toAreaD([[[0, 0], [10, 0], [10, 10], [0, 0]]])).not.toContain("L0 0Z");
  });
  it("emits several rings into one string, so islands can punch holes under evenodd", () => {
    const outer = [[0, 0], [30, 0], [30, 30], [0, 0]];
    const island = [[10, 10], [15, 10], [15, 15], [10, 10]];
    expect(toAreaD([outer, island])).toBe("M0 0L30 0L30 30ZM10 10L15 10L15 15Z");
  });
  it("skips a ring with fewer than three distinct points, which encloses no area", () => {
    expect(toAreaD([[[0, 0], [5, 5], [0, 0]]])).toBe("");
  });
  // Tenth-pixel precision, unlike toPathD's whole pixels: a filled edge shows every quantisation step,
  // and the frame is routinely displayed larger than its 2000-unit viewBox.
  it("keeps tenths rather than snapping to whole pixels", () => {
    expect(toAreaD([[[0, 0], [10.25, 0], [10, 10.44], [0, 0]]])).toBe("M0 0L10.3 0L10 10.4Z");
  });
  it("skips a ring that rounds away to nothing", () => {
    expect(toAreaD([[[0, 0], [0.02, 0.01], [0.01, 0.02], [0, 0]]])).toBe("");
  });
});

describe("bakeArea", () => {
  const P = projectionFor({ west: 0, east: 1, south: 0, north: 1 }, 100);

  // Same lat/lon-vs-x/y trap as bakeLayer: rings arrive as [lon, lat] but project takes (lat, lon).
  it("reads rings as [lon, lat] and closes them", () => {
    const ring = [[0.1, 0.9], [0.3, 0.9], [0.3, 0.7], [0.1, 0.9]];
    const d = bakeArea([ring], P, 1);
    expect(d.startsWith("M10 ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
  // mergeChains is what stitches a multipolygon's split member ways back into whole rings.
  it("stitches a ring split across two ways", () => {
    const half1 = [[0.1, 0.9], [0.3, 0.9]];
    const half2 = [[0.3, 0.9], [0.3, 0.7], [0.1, 0.9]];
    expect(bakeArea([half1, half2], P, 1)).toBe(bakeArea([[[0.1, 0.9], [0.3, 0.9], [0.3, 0.7], [0.1, 0.9]]], P, 1));
  });
});
