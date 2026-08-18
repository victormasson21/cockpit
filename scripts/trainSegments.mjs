// trainSegments.mjs — pure geometry for the live-trains bake: turning each station-to-station span of
// the map's Catmull-Rom tube geometry into a list of `translate()` stops. No I/O lives here, which is
// what makes it unit-testable; reading the baked map and writing the CSS are in bake-train-segments.mjs.
//
// Why stops at all: a train interpolating linearly between two stations flies along the CHORD while the
// drawn line bows away from it (spec §6.1 — measured, up to 32px). Pre-baked @keyframes give exact
// curve-following with zero per-frame main-thread work, which is the point: `offset-path` would also
// follow the curve but is not compositor-accelerated in WebKit.

// How far the stop polyline may cut the corner off the curve, in USER units, and the ceiling on stops per
// segment. They live HERE, as the defaults of the functions that consume them, rather than in the bake
// script: the committed stylesheet is only reproducible if every caller uses the same numbers, and a
// default that differs from what the bake passes is a wrong answer waiting for someone to take it.
// Measured: 0.4px costs 102 KB and 0.8px costs 78 KB, and 0.8 user units is ~0.6 device px at a typical
// window fit — well inside the dot's own ~4px radius, so the extra 24 KB buys nothing anybody can see.
// The ceiling bounds the pathological case rather than describing any real segment.
export const TOLERANCE_PX = 0.8;
export const MAX_STOPS = 24;

// The two ids sorted, so ONE rule serves both directions — the runtime plays it backwards with
// `animation-direction: reverse`. NaptanIds are alphanumeric, so they need no escaping as CSS idents,
// and the `lt-` prefix keeps the name from starting with a digit.
export function segmentName(aId, bId) {
  const [lo, hi] = [aId, bId].sort();
  return `lt-${lo}-${hi}`;
}

// Catmull-Rom → one cubic Bézier, tension 1/6. This arithmetic is splineD's, copied deliberately rather
// than imported: splineD emits a whole `d` string for a chain, and what is needed here is one span's
// control points. A test pins the two against each other, because a dot following a DIFFERENT curve
// from the drawn line is exactly the bug this whole approach exists to avoid.
export function segmentBezier(p0, p1, p2, p3) {
  return [
    p1,
    [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
    [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
    p2,
  ];
}

export function bezierPoint([a, b, c, d], t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    a[0] * w[0] + b[0] * w[1] + c[0] * w[2] + d[0] * w[3],
    a[1] * w[0] + b[1] * w[1] + c[1] * w[2] + d[1] * w[3],
  ];
}

// A cubic's parameter t is NOT proportional to distance along it, so sampling at even t would make the
// train speed up and slow down within a single segment. This table converts between the two.
export function arcTable(bez, steps = 64) {
  const points = [bezierPoint(bez, 0)];
  const lengths = [0];
  for (let i = 1; i <= steps; i++) {
    const p = bezierPoint(bez, i / steps);
    const prev = points[i - 1];
    lengths.push(lengths[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    points.push(p);
  }
  return { points, lengths, total: lengths[steps] };
}

export function pointAtFraction(table, f) {
  if (table.total === 0) return table.points[0];
  const target = table.total * Math.min(1, Math.max(0, f));
  let i = 1;
  while (i < table.lengths.length - 1 && table.lengths[i] < target) i++;
  const before = table.lengths[i - 1];
  const span = table.lengths[i] - before;
  const t = span === 0 ? 0 : (target - before) / span;
  const [ax, ay] = table.points[i - 1];
  const [bx, by] = table.points[i];
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

// Evenly spaced by DISTANCE, so evenly spaced keyframe percentages mean constant speed.
export function sampleStops(table, count) {
  return Array.from({ length: count }, (_, i) => pointAtFraction(table, count === 1 ? 0 : i / (count - 1)));
}

function pointToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// How far the stop polyline strays from the real curve — CSS interpolates linearly between stops, so
// this, not the stop count, is what "accurate enough" means.
export function polylineDeviation(table, stops) {
  let worst = 0;
  for (const p of table.points) {
    let best = Infinity;
    for (let i = 1; i < stops.length; i++) best = Math.min(best, pointToSegment(p, stops[i - 1], stops[i]));
    worst = Math.max(worst, best);
  }
  return worst;
}

// Adaptive: the fewest stops that hold the tolerance. 22% of segments bow under 1px and get two stops,
// so only genuinely curved ones cost bytes (spec §6.1).
export function stopsFor(table, tolerance = TOLERANCE_PX, max = MAX_STOPS) {
  for (let n = 2; n < max; n++) {
    const stops = sampleStops(table, n);
    if (polylineDeviation(table, stops) <= tolerance) return stops;
  }
  return sampleStops(table, max);
}

export function keyframesFor(name, stops) {
  const r = (n) => Math.round(n * 10) / 10; // 0.1px is far below anything visible and shortens the file
  const body = stops
    .map((p, i) => `${r((i / (stops.length - 1)) * 100)}%{transform:translate(${r(p[0])}px,${r(p[1])}px)}`)
    .join("");
  return `@keyframes ${name}{${body}}`;
}

// One entry per DISTINCT station pair, oriented lo → hi. Two things are load-bearing:
//   - The map's bake dedupes whole station SEQUENCES, so branches redraw their shared trunk and the same
//     pair recurs with different neighbours. Emitting one rule per pair means the dot follows one of
//     those near-identical strokes exactly; emitting one per occurrence would double the file for a
//     difference no one can see.
//   - Prefer an INTERIOR occurrence. At the end of a sequence splineD duplicates the endpoint as its own
//     missing neighbour, which makes the span straighter than the drawn trunk actually is.
export function collectSegments(tubeLines) {
  const out = new Map();
  for (const seq of tubeLines) {
    const st = seq.stations;
    for (let i = 0; i < st.length - 1; i++) {
      const [a, b] = [st[i], st[i + 1]];
      if (a.id === b.id) continue;
      const name = segmentName(a.id, b.id);
      const interior = Boolean(st[i - 1] && st[i + 2]);
      const existing = out.get(name);
      if (existing && (existing.interior || !interior)) continue;
      const quad = [st[i - 1] ?? a, a, b, st[i + 2] ?? b].map((p) => [p.x, p.y]);
      // Catmull-Rom is symmetric, so reversing the quadruple is the whole of "run it the other way".
      out.set(name, { name, interior, points: a.id < b.id ? quad : quad.reverse() });
    }
  }
  return out;
}

export function bakeSegmentCss(tubeLines, tolerance = TOLERANCE_PX, maxStops = MAX_STOPS) {
  return [...collectSegments(tubeLines).values()].map((seg) =>
    keyframesFor(seg.name, stopsFor(arcTable(segmentBezier(...seg.points)), tolerance, maxStops)),
  );
}

// Each segment's SPLINE arc length, keyed by the same name as its @keyframes rule. The runtime derives a
// segment's duration from its length, and the animation runs along the spline — so the chord it could
// compute itself underestimates every curved segment, and the dot runs late all the way along it.
// Rounded to 0.1px like the keyframes: far below anything visible, and it shortens the file.
export function bakeSegmentLengths(tubeLines) {
  const out = {};
  for (const seg of collectSegments(tubeLines).values()) {
    out[seg.name] = Math.round(arcTable(segmentBezier(...seg.points)).total * 10) / 10;
  }
  return out;
}
