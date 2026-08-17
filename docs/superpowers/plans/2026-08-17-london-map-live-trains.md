# London map — live trains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second London-map background variant in which the 11 Underground lines carry live
line-coloured train dots, gliding along the drawn (splined) track between stations from TfL's arrival
predictions.

**Architecture:** Five new files plus two one-line edits to shipped code (spec §8). A hand-run bake
script derives one `@keyframes` rule per station-to-station segment from the coordinates **already**
committed in `londonMap.data.ts` — no network, no re-bake of the map. At runtime a pure module turns
arrival predictions into `{ segment, progress }` placements, and each train is one `<circle>` carrying
`animation-name: lt-<a>-<b>` with a negative `animation-delay`, so the compositor drives all motion and
the main thread does work only once per ~11s tick.

**Tech Stack:** TypeScript + React 19 (Vite), vitest (`environment: "node"` — pure tests only, no DOM),
plain `.mjs` Node scripts for the bake, CSS animations. No new dependencies. No Rust changes.

## Global Constraints

- **Spec is authoritative:** `docs/superpowers/specs/2026-08-17-london-map-live-trains-design.md`. Do not
  re-measure the TfL API and do not re-derive its decisions.
- **`src/background/londonMap.data.ts` MUST NOT be modified**, and `scripts/bake-london-map.mjs` MUST NOT
  be re-run (spec §8). The segment keyframes are derived *downstream* from it.
- **Only two shipped files may be touched:** `registry.tsx` (one added entry) and `londonMap.tsx` (accept
  an optional child). Everything else is additive, so the feature deletes cleanly.
- **Animate `transform`/`opacity` only** (`background.css` variant contract) — this layer sits behind live
  terminals. No `offset-path` (not compositor-accelerated in WebKit; spec §6.1).
- **Polling runs only when the variant is mounted AND `document.visibilityState === "visible"`.** A hidden
  window freezes CSS animations but not timers.
- **`prefers-reduced-motion: reduce` → trains hold still**, no animation.
- Pure logic lives in its own module and is unit-tested (`scripts/mapGeometry.test.mjs`,
  `src/background/nightSky.test.ts` are the conventions). Polling and rendering are GUI-smoke concerns.
- Background variant stylesheets are an **allowed literal-colour site** — the 11 TfL line hexes belong in
  `londonTrains.css`, never in theme tokens.
- British English in prose and comments; comments explain **why**, not what; smallest change that works.
- **Do not commit or push unless the user asks.** (Steps below say "commit" — run them; the plan's commits
  stay local, nothing is pushed.)
- Definition of done: `npx vitest run`, `npm run build`, `cargo test` (in `src-tauri/`) green, plus a GUI
  eyeball.

**Facts established by reading the repo (do not re-derive):**

- `LONDON_MAP.tubeLines` is `{ id: string; stations: { id: string; x: number; y: number }[] }[]` —
  **50 sequences over 11 lines**, ids `central`, `central-1`, … (`lineId = id.replace(/-\d+$/, "")`),
  272 distinct stations, 452 station placements, coordinates already in the 2000×1246 pixel space.
- **314 distinct undirected station pairs**; 200 of them touch the frame.
- The map draws each sequence with `splineD(stations)` — uniform Catmull-Rom, tension 1/6. The bake here
  must reproduce that arithmetic exactly.
- `.lm` sets `fill: none; stroke: #fff` on the whole `<svg>`, so a train `<circle>` must get its `fill`
  and `stroke` from CSS (a `fill=` **attribute would lose to that rule**).
- `tauri.conf.json` has `"csp": null`, so a webview `fetch` to `api.tfl.gov.uk` needs no config change.
- vitest runs with `environment: "node"`. There is no DOM in tests — component rendering is not testable
  here, by existing design.

---

### Task 1: Pure segment geometry for the bake

Catmull-Rom sampling that matches `splineD`, arc-length-uniform stop placement, adaptive stop counts, and
the canonical segment naming. Pure `.mjs`, mirroring `scripts/mapGeometry.mjs` exactly (I/O lives in the
bake script, Task 2).

**Files:**
- Create: `scripts/trainSegments.mjs`
- Test: `scripts/trainSegments.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `segmentName(aId: string, bId: string): string` → `lt-<lo>-<hi>`, ids sorted lexicographically.
  - `segmentBezier(p0, p1, p2, p3): [Pt, Pt, Pt, Pt]` where `Pt = [x, y]` — the cubic control points.
  - `bezierPoint(bez, t): Pt`
  - `arcTable(bez, steps?): { points: Pt[]; lengths: number[]; total: number }`
  - `pointAtFraction(table, f): Pt`
  - `sampleStops(table, count): Pt[]`
  - `polylineDeviation(table, stops): number`
  - `stopsFor(table, tolerance, max?): Pt[]`
  - `keyframesFor(name: string, stops: Pt[]): string`
  - `collectSegments(tubeLines): Map<string, { name, interior: boolean, points: [Pt,Pt,Pt,Pt] }>`
  - `bakeSegmentCss(tubeLines, tolerance?, maxStops?): string[]` (one `@keyframes` rule per entry)

- [ ] **Step 1: Write the failing test**

Create `scripts/trainSegments.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/trainSegments.test.mjs`
Expected: FAIL — `Failed to resolve import "./trainSegments.mjs"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/trainSegments.mjs`:

```js
// trainSegments.mjs — pure geometry for the live-trains bake: turning each station-to-station span of
// the map's Catmull-Rom tube geometry into a list of `translate()` stops. No I/O lives here, which is
// what makes it unit-testable; reading the baked map and writing the CSS are in bake-train-segments.mjs.
//
// Why stops at all: a train interpolating linearly between two stations flies along the CHORD while the
// drawn line bows away from it (spec §6.1 — measured, up to 32px). Pre-baked @keyframes give exact
// curve-following with zero per-frame main-thread work, which is the point: `offset-path` would also
// follow the curve but is not compositor-accelerated in WebKit.

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
// so only genuinely curved ones cost bytes (spec §6.1). The ceiling bounds the pathological case
// rather than describing any real segment.
export function stopsFor(table, tolerance, max = 24) {
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

export function bakeSegmentCss(tubeLines, tolerance = 0.4, maxStops = 24) {
  return [...collectSegments(tubeLines).values()].map((seg) =>
    keyframesFor(seg.name, stopsFor(arcTable(segmentBezier(...seg.points)), tolerance, maxStops)),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/trainSegments.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/trainSegments.mjs scripts/trainSegments.test.mjs
git commit -m "feat(background): pure segment geometry for the live-trains bake"
```

---

### Task 2: Bake the per-segment keyframes

The I/O half: read the committed map data, emit `londonTrainSegments.data.css`. Needs **no network** —
that independence is what keeps the trains deletable without touching the map (spec §8).

**Files:**
- Create: `scripts/bake-train-segments.mjs`
- Create (generated, committed): `src/background/londonTrainSegments.data.css`

**Interfaces:**
- Consumes: `bakeSegmentCss`, `collectSegments` from Task 1.
- Produces: a CSS file whose rules are named `lt-<loNaptan>-<hiNaptan>`, one per distinct station pair.

- [ ] **Step 1: Write the bake script**

Create `scripts/bake-train-segments.mjs`:

```js
// bake-train-segments.mjs — writes one @keyframes rule per Underground station-to-station segment, so a
// live train can follow the DRAWN (splined) line with zero per-frame main-thread work.
//
// Run by hand: `node scripts/bake-train-segments.mjs`. It is NOT part of the build.
//
// It reads src/background/londonMap.data.ts and NOTHING ELSE — no Overpass, no TfL, no key. That is
// deliberate (spec §8): the map and the trains stay separate units, so the trains can be deleted without
// re-baking the map, and this script is safe to re-run at any time because its input is committed.
import { readFile, writeFile } from "node:fs/promises";
import { bakeSegmentCss, collectSegments } from "./trainSegments.mjs";

const IN = new URL("../src/background/londonMap.data.ts", import.meta.url);
const OUT = new URL("../src/background/londonTrainSegments.data.css", import.meta.url);

const TOLERANCE_PX = 0.4; // how far a stop polyline may stray from the curve; below a dot's own radius
const MAX_STOPS = 24;

// The data file is `export const LONDON_MAP = {...} as const;` — one JSON object with a TS wrapper. It is
// read as text and JSON.parse'd rather than imported, because this is plain Node with no TS loader.
async function readMap() {
  const src = await readFile(IN, "utf8");
  const open = src.indexOf("{");
  const close = src.lastIndexOf("} as const;");
  if (open === -1 || close === -1) throw new Error("londonMap.data.ts is not the expected `= {...} as const;` shape");
  return JSON.parse(src.slice(open, close + 1));
}

async function main() {
  const map = await readMap();
  const segments = collectSegments(map.tubeLines);
  const rules = bakeSegmentCss(map.tubeLines, TOLERANCE_PX, MAX_STOPS);
  const stops = rules.reduce((n, r) => n + (r.match(/%\{/g)?.length ?? 0), 0);

  const css = `/* londonTrainSegments.data.css — GENERATED by scripts/bake-train-segments.mjs. Do not edit by hand;
   re-run the script instead. Derived entirely from the station coordinates in londonMap.data.ts, which it
   does NOT modify — no network access, no API key.

   One rule per Underground station pair, named lt-<loNaptanId>-<hiNaptanId>, running lo -> hi. A train
   travelling hi -> lo plays the same rule with animation-direction: reverse. Stops are spaced evenly by
   DISTANCE along the splined curve, so evenly spaced percentages mean constant speed.

   Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016 and Geomni UK
   Map data © and database rights [2019]. That is verbatim the form TfL's Transport Data Service terms
   require, years and brackets included — do not tidy it.
   Map data © OpenStreetMap contributors, available under the Open Database License (ODbL). */
${rules.join("\n")}
`;
  await writeFile(OUT, css);
  console.log(`${segments.size} segments, ${stops} stops, ${(css.length / 1024).toFixed(1)} KB`);
  console.log(`wrote ${OUT.pathname}`);
}

await main();
```

- [ ] **Step 2: Run the bake**

Run: `node scripts/bake-train-segments.mjs`
Expected: `314 segments, <N> stops, <S> KB` then `wrote …/londonTrainSegments.data.css`.

- [ ] **Step 3: Check the generated output before it is committed (spec §10.2)**

Run:
```bash
head -c 600 src/background/londonTrainSegments.data.css; echo
grep -c "@keyframes" src/background/londonTrainSegments.data.css
du -h src/background/londonTrainSegments.data.css
```
Expected: the header comment, then `314` rules. **If the file exceeds ~120 KB, raise `TOLERANCE_PX`**
— a dot is several px across, so sub-pixel accuracy is not worth tens of KB.

**As built:** `TOLERANCE_PX = 0.8` → 314 segments, 1,597 stops, **78.6 KB**. Measured alternatives:
0.4px = 102 KB, 0.6px = 87 KB, 1.2px = 67 KB. Stop counts run 2 (57 straight segments) to 17, so nothing
reaches the `MAX_STOPS = 24` ceiling and the adaptive sampling is doing its job.

- [ ] **Step 4: Commit**

```bash
git add scripts/bake-train-segments.mjs src/background/londonTrainSegments.data.css
git commit -m "feat(background): bake per-segment train keyframes from the map data"
```

---

### Task 3: Runtime tube index and segment naming

The runtime's view of the baked data: line → branch sequences, NaptanId → point, and the animation name
for a segment. Also the test that pins the bake and the runtime to the **same** naming rule — they agree
by convention, not by a shared import, so the guarantee has to be tested (spec §9).

**Files:**
- Create: `src/background/londonTrains.ts`
- Test: `src/background/londonTrains.test.ts`

**Interfaces:**
- Consumes: `LONDON_MAP` from `./londonMap.data`; the generated CSS from Task 2 (read as a file, in the test only).
- Produces:
  - `interface Point { x: number; y: number }`, `interface Station extends Point { id: string }`
  - `lineIdOf(sequenceId: string): string`
  - `interface TubeIndex { sequencesByLine: Map<string, Station[][]>; stations: Map<string, Station>; lineIds: string[] }`
  - `buildTubeIndex(tubeLines): TubeIndex`
  - `TUBE: TubeIndex` (built once from `LONDON_MAP.tubeLines`)
  - `TUBE_LINE_IDS: string[]`
  - `segmentAnimation(fromId: string, toId: string): { name: string; reverse: boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/background/londonTrains.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { LONDON_MAP } from "./londonMap.data";
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

  // THE contract test. The bake (a .mjs script) and the runtime (TS) each build the name themselves —
  // there is no shared module to import across that boundary — so a divergence would silently leave
  // trains with an animation-name nothing defines: they would all pile up at one corner of the map.
  const css = readFileSync(new URL("./londonTrainSegments.data.css", import.meta.url), "utf8");
  const baked = new Set([...css.matchAll(/@keyframes\s+(lt-[\w-]+)/g)].map((m) => m[1]));
  const pairs = new Set<string>();
  for (const seq of LONDON_MAP.tubeLines) {
    for (let i = 0; i < seq.stations.length - 1; i++) {
      const [a, b] = [seq.stations[i], seq.stations[i + 1]];
      if (a.id !== b.id) pairs.add(segmentAnimation(a.id, b.id).name);
    }
  }

  it("has a baked keyframes rule for every segment a train can be placed on", () => {
    expect([...pairs].filter((name) => !baked.has(name))).toEqual([]);
  });
  it("bakes no rule that no segment references", () => {
    expect([...baked].filter((name) => !pairs.has(name))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: FAIL — cannot resolve `./londonTrains`.

- [ ] **Step 3: Write the implementation**

Create `src/background/londonTrains.ts` (this file grows in Tasks 4–6; add only this section now):

```ts
// londonTrains.ts — pure logic for the "London map · live" variant: TfL arrival predictions in, a
// placement per train out. No DOM and no fetch live here (those are in londonTrains.tsx), which is what
// makes the whole derivation — including the branch disambiguation and its fallback ladder — testable.
import { LONDON_MAP } from "./londonMap.data";

export interface Point { x: number; y: number }
export interface Station extends Point { id: string }

// ── The baked network, indexed ──────────────────────────────────────────────────────────────────────

// Baked sequence ids are `central`, `central-1`, …: the NUMERIC suffix is the branch. Anchored to the
// end so `hammersmith-city` and `waterloo-city` survive intact.
export const lineIdOf = (sequenceId: string): string => sequenceId.replace(/-\d+$/, "");

export interface TubeIndex {
  sequencesByLine: Map<string, Station[][]>;
  stations: Map<string, Station>;
  lineIds: string[];
}

export function buildTubeIndex(
  tubeLines: readonly { readonly id: string; readonly stations: readonly Station[] }[],
): TubeIndex {
  const sequencesByLine = new Map<string, Station[][]>();
  const stations = new Map<string, Station>();
  for (const seq of tubeLines) {
    const lineId = lineIdOf(seq.id);
    const branches = sequencesByLine.get(lineId) ?? [];
    branches.push(seq.stations.map((s) => ({ id: s.id, x: s.x, y: s.y })));
    sequencesByLine.set(lineId, branches);
    for (const s of seq.stations) stations.set(s.id, { id: s.id, x: s.x, y: s.y });
  }
  return { sequencesByLine, stations, lineIds: [...sequencesByLine.keys()] };
}

// Built once at module load: the geometry is a static import, so there is nothing to invalidate.
export const TUBE = buildTubeIndex(LONDON_MAP.tubeLines);

// The line ids TfL's API uses are the same strings the map was baked from, so this doubles as the poll
// rota — there is no separate list to keep in step.
export const TUBE_LINE_IDS = TUBE.lineIds;

// The @keyframes rule for a segment, plus whether the train runs against it. One rule per station PAIR
// is baked (lo → hi), so the other direction is `animation-direction: reverse` rather than a second
// rule. scripts/trainSegments.mjs builds this name the same way; londonTrains.test.ts pins the two
// together, because nothing but that test connects them.
export function segmentAnimation(fromId: string, toId: string): { name: string; reverse: boolean } {
  const [lo, hi] = [fromId, toId].sort();
  return { name: `lt-${lo}-${hi}`, reverse: fromId !== lo };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: PASS — in particular both coverage cases (every segment has a rule, no orphan rules).

- [ ] **Step 5: Commit**

```bash
git add src/background/londonTrains.ts src/background/londonTrains.test.ts
git commit -m "feat(background): index the baked tube network for live trains"
```

---

### Task 4: Ingest the arrivals feed

Reading TfL's payload into a per-vehicle feed, and the round-robin rota. Everything here is pure; the
`fetch` that supplies it arrives in Task 6.

**Files:**
- Modify: `src/background/londonTrains.ts` (append a section)
- Test: `src/background/londonTrains.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 3 beyond the file it lives in.
- Produces:
  - `interface Prediction { naptanId: string; timeToStation: number }`
  - `interface Vehicle { vehicleId: string; lineId: string; predictions: Prediction[]; fetchedAt: number }`
  - `type Feed = ReadonlyMap<string, Vehicle>` (keyed by `vehicleId`)
  - `arrivalsUrl(lineId: string): string`
  - `parseArrivals(payload: unknown, lineId: string, fetchedAt: number): Vehicle[]`
  - `mergeLineFeed(feed: Feed, lineId: string, vehicles: Vehicle[]): Map<string, Vehicle>`
  - `nextLineIndex(i: number, total: number): number`
  - `STALE_SECONDS: number`

- [ ] **Step 1: Write the failing test**

Append to `src/background/londonTrains.test.ts`:

```ts
import { arrivalsUrl, mergeLineFeed, nextLineIndex, parseArrivals, type Vehicle } from "./londonTrains";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: FAIL — `parseArrivals` etc. are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/background/londonTrains.ts`:

```ts
// ── The feed ────────────────────────────────────────────────────────────────────────────────────────

export interface Prediction { naptanId: string; timeToStation: number }

// One train, with its whole onward journey: TfL returns ~15 predictions per vehicleId, not just the next
// stop, which is what lets a single fetch keep a train moving for minutes (spec §3).
export interface Vehicle {
  vehicleId: string;
  lineId: string;
  predictions: Prediction[];
  fetchedAt: number;
}

export type Feed = ReadonlyMap<string, Vehicle>;

// Predictions older than this are not aged into a position at all — after a long spell hidden, or a run
// of failed fetches, the honest render is nothing rather than a network of ghosts parked at termini.
export const STALE_SECONDS = 300;

export const arrivalsUrl = (lineId: string): string => `https://api.tfl.gov.uk/Line/${lineId}/Arrivals`;

interface RawArrival { vehicleId?: unknown; lineId?: unknown; naptanId?: unknown; timeToStation?: unknown }

// The payload is a flat list of predictions; this is the only place that trusts TfL's field names.
// Everything downstream sees Vehicles with predictions ALREADY SORTED soonest-first, which §5's
// "two soonest predictions" rule depends on.
export function parseArrivals(payload: unknown, lineId: string, fetchedAt: number): Vehicle[] {
  if (!Array.isArray(payload)) return [];
  const byVehicle = new Map<string, Prediction[]>();
  for (const row of payload as RawArrival[]) {
    const vehicleId = typeof row?.vehicleId === "string" ? row.vehicleId : "";
    const naptanId = typeof row?.naptanId === "string" ? row.naptanId : "";
    const timeToStation = typeof row?.timeToStation === "number" ? row.timeToStation : NaN;
    if (!vehicleId || !naptanId || !Number.isFinite(timeToStation) || row.lineId !== lineId) continue;
    byVehicle.set(vehicleId, [...(byVehicle.get(vehicleId) ?? []), { naptanId, timeToStation }]);
  }
  return [...byVehicle].map(([vehicleId, predictions]) => ({
    vehicleId,
    lineId,
    fetchedAt,
    predictions: predictions.sort((a, b) => a.timeToStation - b.timeToStation),
  }));
}

// A line's fetch is the complete truth about that line, so its previous entries go before the new ones
// land — otherwise a terminated train would linger for as long as the app ran.
export function mergeLineFeed(feed: Feed, lineId: string, vehicles: Vehicle[]): Map<string, Vehicle> {
  const next = new Map(feed);
  for (const [id, v] of next) if (v.lineId === lineId) next.delete(id);
  for (const v of vehicles) next.set(v.vehicleId, v);
  return next;
}

export const nextLineIndex = (i: number, total: number): number => (i + 1) % total;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/londonTrains.ts src/background/londonTrains.test.ts
git commit -m "feat(background): ingest TfL arrivals into a per-vehicle feed"
```

---

### Task 5: Derive a placement — branch disambiguation and the fallback ladder

The heart of the feature (spec §5). Given a vehicle's predictions, work out which **segment** it is on,
how far along, and what to do when the branch cannot be resolved.

**Files:**
- Modify: `src/background/londonTrains.ts` (append a section)
- Test: `src/background/londonTrains.test.ts` (append)

**Interfaces:**
- Consumes: `TubeIndex`, `buildTubeIndex`, `segmentAnimation`, `Vehicle`, `STALE_SECONDS`, `Point`.
- Produces:
  - `type Placement = { kind: "segment"; name: string; reverse: boolean; seconds: number; progress: number; from: Point; to: Point } | { kind: "glide"; from: Point; to: Point; seconds: number; progress: number } | { kind: "still"; at: Point }`
  - `interface Sighting { placement: Placement; atMs: number }`
  - `interface Train { vehicleId: string; lineId: string; placement: Placement }`
  - `resolvePrevious(lineId: string, nextId: string, afterId: string, index?: TubeIndex): string[]`
  - `segmentSeconds(nextEta: number, afterEta: number): number`
  - `reflectBehind(next: Point, after: Point, fraction: number): Point`
  - `placementPosition(placement: Placement, elapsedSeconds: number): Point`
  - `resolvePlacement(v: Vehicle, nowMs: number, previous: Sighting | undefined, index?: TubeIndex): Placement | null`
  - `inFrame(p: Point, margin?: number): boolean`, `placementVisible(p: Placement, margin?: number): boolean`, `FRAME_MARGIN`
  - `derivePlacements(feed: Feed, nowMs: number, previous: ReadonlyMap<string, Sighting>, index?: TubeIndex): { trains: Train[]; sightings: Map<string, Sighting> }`

- [ ] **Step 1: Write the failing test**

Append to `src/background/londonTrains.test.ts`:

```ts
import {
  derivePlacements, inFrame, placementPosition, placementVisible, reflectBehind, resolvePlacement,
  resolvePrevious, segmentSeconds, type Placement, type Sighting,
} from "./londonTrains";

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
const vehicle = (predictions: [string, number][], fetchedAt = 0) => ({
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
    // Fetched 60s ago, so 30s-to-go is now due: the train is at the station.
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
    expect(p).toEqual({ kind: "glide", from: { x: 50, y: 50 }, to: { x: 200, y: 200 }, seconds: 40, progress: 0 });
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
      .toEqual({ kind: "still", at: { x: 300, y: 300 } });
  });
  it("glides a train with only one prediction left, if it has been seen before", () => {
    const previous: Sighting = { placement: { kind: "still", at: { x: 0, y: 0 } }, atMs: 0 };
    expect(resolvePlacement(vehicle([["BNK", 40]]), 0, previous, index))
      .toMatchObject({ kind: "glide", to: { x: 300, y: 300 }, seconds: 40 });
  });
  it("holds a train whose whole known journey is in the past at its destination", () => {
    expect(resolvePlacement(vehicle([["BNK", 10], ["LDB", 20]], 0), 60_000, undefined, index))
      .toEqual({ kind: "still", at: { x: 400, y: 400 } });
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
    const offFrame = new Map([["v1", { ...vehicle([["FAR", 30]]), lineId: "northern" }]]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: FAIL — `resolvePrevious` and friends are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/background/londonTrains.ts`:

```ts
// ── Deriving a position (spec §5) ───────────────────────────────────────────────────────────────────

export const DEFAULT_SEGMENT_SECONDS = 100; // when the two predictions give no usable gap
export const MIN_SEGMENT_SECONDS = 20;
export const MAX_SEGMENT_SECONDS = 300;

export type Placement =
  // On a drawn segment, playing that segment's baked @keyframes. The from/to points are carried for the
  // frame test and for the fallback ladder's "last known position"; the CURVE itself is the CSS rule's.
  | { kind: "segment"; name: string; reverse: boolean; seconds: number; progress: number; from: Point; to: Point }
  // A straight run to the next station, for when the branch could not be resolved.
  | { kind: "glide"; from: Point; to: Point; seconds: number; progress: number }
  | { kind: "still"; at: Point };

export interface Sighting { placement: Placement; atMs: number }
export interface Train { vehicleId: string; lineId: string; placement: Placement }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

// Which station a train on this line must have come from, given where it is going next and the station
// after that. The pair (next, after-next) is what distinguishes via-Bank from via-CX: no string
// matching, no cross-poll state. More than one answer means the branches genuinely disagree.
export function resolvePrevious(lineId: string, nextId: string, afterId: string, index = TUBE): string[] {
  const found = new Set<string>();
  for (const seq of index.sequencesByLine.get(lineId) ?? []) {
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].id !== nextId) continue;
      // The previous station is the neighbour on the OPPOSITE side from the station-after-next.
      if (seq[i + 1]?.id === afterId && seq[i - 1]) found.add(seq[i - 1].id);
      if (seq[i - 1]?.id === afterId && seq[i + 1]) found.add(seq[i + 1].id);
    }
  }
  return [...found];
}

// How long this segment takes: the gap between the two soonest predictions. Predictions at the tails of
// a journey can be equal, or out of order, so an unusable gap falls back rather than producing a
// negative duration (spec §10.3).
export function segmentSeconds(nextEta: number, afterEta: number): number {
  const gap = afterEta - nextEta;
  if (!Number.isFinite(gap) || gap <= 0) return DEFAULT_SEGMENT_SECONDS;
  return Math.min(MAX_SEGMENT_SECONDS, Math.max(MIN_SEGMENT_SECONDS, gap));
}

// Where a train probably is when its branch is unknown and it has never been seen: behind `next`, on the
// far side from where it is heading. The station-after-next is the only other point that can be trusted,
// and the vector between them carries roughly a segment's length, so stepping back by the fraction of
// the run still to go lands somewhere plausible on the right side of the station.
export function reflectBehind(next: Point, after: Point, fraction: number): Point {
  return { x: next.x + (next.x - after.x) * fraction, y: next.y + (next.y - after.y) * fraction };
}

// Where a placement has reached, `elapsedSeconds` after it was derived. Used only to give the fallback
// ladder something to glide FROM, so a segment is measured along its CHORD rather than its curve: the
// error is the same few px §6.1 measures, and it is the starting point of an already-approximate glide.
export function placementPosition(placement: Placement, elapsedSeconds: number): Point {
  if (placement.kind === "still") return placement.at;
  const { from, to, seconds, progress } = placement;
  const f = clamp01(progress + (seconds > 0 ? elapsedSeconds / seconds : 1));
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
}

export function resolvePlacement(
  v: Vehicle,
  nowMs: number,
  previous: Sighting | undefined,
  index = TUBE,
): Placement | null {
  const age = (nowMs - v.fetchedAt) / 1000;
  if (age > STALE_SECONDS) return null;
  const point = (id: string): Point | null => index.stations.get(id) ?? null;
  // A vehicle carries its whole onward journey, so ageing the predictions advances it through several
  // stations between fetches — which is what makes a ~2 minute refresh cycle enough (spec §3).
  const aged = v.predictions.map((p) => ({ id: p.naptanId, eta: p.timeToStation - age }));
  const upcoming = aged.filter((p) => p.eta > 0);

  // Its known journey has run out: it has arrived at the last station we were told about.
  if (!upcoming.length) {
    const end = point(aged[aged.length - 1]?.id ?? "");
    return end ? { kind: "still", at: end } : null;
  }

  const next = upcoming[0];
  const nextAt = point(next.id);
  if (!nextAt) return null; // a station outside the baked set → drop the train (spec §5)

  // Not merely upcoming[1]: a looping line (the Circle) can predict the same station twice, and a
  // repeat says nothing about which way the train is facing.
  const after = upcoming.find((p) => p.id !== next.id);
  const afterAt = after ? point(after.id) : null;

  const glideTo = (to: Point, seconds: number, seen: Sighting): Placement => ({
    kind: "glide",
    from: placementPosition(seen.placement, (nowMs - seen.atMs) / 1000),
    to,
    seconds: Math.max(1, seconds),
    progress: 0,
  });

  if (after && afterAt) {
    const seconds = segmentSeconds(next.eta, after.eta);
    const progress = clamp01(1 - next.eta / seconds);
    const previousIds = resolvePrevious(v.lineId, next.id, after.id, index);
    const fromAt = previousIds.length === 1 ? point(previousIds[0]) : null;
    if (fromAt) {
      const { name, reverse } = segmentAnimation(previousIds[0], next.id);
      return { kind: "segment", name, reverse, seconds, progress, from: fromAt, to: nextAt };
    }
    if (previous) return glideTo(nextAt, next.eta, previous);
    return { kind: "still", at: reflectBehind(nextAt, afterAt, 1 - progress) };
  }

  // One prediction left, so there is no second point to reflect through either.
  if (previous) return glideTo(nextAt, next.eta, previous);
  return { kind: "still", at: nextAt };
}

// ── Which trains get an element ─────────────────────────────────────────────────────────────────────

// A little beyond the frame, so a train slides in rather than appearing at the edge. Off-frame trains
// are still tracked — they just cost no DOM (spec §6).
export const FRAME_MARGIN = 80;

export function inFrame(p: Point, margin = FRAME_MARGIN): boolean {
  return p.x >= -margin && p.x <= LONDON_MAP.width + margin && p.y >= -margin && p.y <= LONDON_MAP.height + margin;
}

export function placementVisible(placement: Placement, margin = FRAME_MARGIN): boolean {
  return placement.kind === "still"
    ? inFrame(placement.at, margin)
    : inFrame(placement.from, margin) || inFrame(placement.to, margin);
}

// One pass over the feed: every vehicle that can be placed yields a sighting (the ladder's memory), and
// the ones near the frame also yield an element.
export function derivePlacements(
  feed: Feed,
  nowMs: number,
  previous: ReadonlyMap<string, Sighting>,
  index = TUBE,
): { trains: Train[]; sightings: Map<string, Sighting> } {
  const trains: Train[] = [];
  const sightings = new Map<string, Sighting>();
  for (const v of feed.values()) {
    const placement = resolvePlacement(v, nowMs, previous.get(v.vehicleId), index);
    if (!placement) continue;
    sightings.set(v.vehicleId, { placement, atMs: nowMs });
    if (placementVisible(placement)) trains.push({ vehicleId: v.vehicleId, lineId: v.lineId, placement });
  }
  return { trains, sightings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/background/londonTrains.ts src/background/londonTrains.test.ts
git commit -m "feat(background): derive train positions with structural branch disambiguation"
```

---

### Task 6: The layer — styles, artwork and polling

The rendering half: one `<circle>` per visible train, its motion entirely a baked `@keyframes`; polling
that stops when the window is hidden; the 11 line colours as literals in the variant stylesheet.

**Files:**
- Modify: `src/background/londonTrains.ts` (append `trainStyle`)
- Test: `src/background/londonTrains.test.ts` (append `trainStyle` cases)
- Create: `src/background/londonTrains.css`
- Create: `src/background/londonTrains.tsx`
- Modify: `src/background/londonMap.tsx` (accept an optional child inside the tube `<g>`)

**Interfaces:**
- Consumes: everything from Tasks 3–5, plus the generated CSS from Task 2.
- Produces: `trainStyle(placement: Placement): CSSProperties`; `LondonTrains(): ReactElement`;
  `LondonMap({ children }: { children?: ReactNode })`.

- [ ] **Step 1: Write the failing test**

Append to `src/background/londonTrains.test.ts`:

```ts
import { trainStyle } from "./londonTrains";

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
  // A glide has no baked rule to play, so its two ends arrive as custom properties that the one generic
  // lt-glide keyframes substitutes — which keeps the fallback on the compositor too.
  it("hands a glide its endpoints as custom properties", () => {
    expect(trainStyle({ kind: "glide", from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, seconds: 40, progress: 0 }))
      .toEqual({
        animationName: "lt-glide", animationDuration: "40s", animationDelay: "-0s",
        "--lt-fx": "1px", "--lt-fy": "2px", "--lt-tx": "3px", "--lt-ty": "4px",
      });
  });
  it("pins a still train in place with no animation at all", () => {
    expect(trainStyle({ kind: "still", at: { x: 7, y: 8 } }))
      .toEqual({ animationName: "none", transform: "translate(7px, 8px)" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: FAIL — `trainStyle` is not exported.

- [ ] **Step 3: Implement `trainStyle`**

Add the type-only import at the top of `src/background/londonTrains.ts` (it belongs here, not earlier:
`noUnusedLocals` is on, so an import added before its first use fails `npm run build`):

```ts
import type { CSSProperties } from "react";
```

Then append:

```ts
// ── The handoff to CSS ──────────────────────────────────────────────────────────────────────────────

// The model carries numbers; the stylesheet owns the look (the same split as nightSky's *Style helpers).
// Note what is NOT here: reduced motion. A paused animation with a negative delay renders the exact
// point on the CURVE that a train has reached and never moves from it, so holding still is one rule in
// the stylesheet rather than a second code path with a chord-approximated position.
export function trainStyle(placement: Placement): CSSProperties {
  if (placement.kind === "still") {
    return { animationName: "none", transform: `translate(${placement.at.x}px, ${placement.at.y}px)` };
  }
  const timing = {
    animationDuration: `${placement.seconds}s`,
    animationDelay: `-${placement.progress * placement.seconds}s`,
  };
  if (placement.kind === "segment") {
    return { animationName: placement.name, ...timing, animationDirection: placement.reverse ? "reverse" : "normal" };
  }
  return {
    animationName: "lt-glide",
    ...timing,
    "--lt-fx": `${placement.from.x}px`, "--lt-fy": `${placement.from.y}px`,
    "--lt-tx": `${placement.to.x}px`, "--lt-ty": `${placement.to.y}px`,
  } as CSSProperties;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/londonTrains.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the stylesheet**

Create `src/background/londonTrains.css`:

```css
/* londonTrains.css — the live trains' artwork. The 11 official TfL line colours are literal here by
   design: a background IS colour (see the variant contract in background.css).

   Only `transform` animates, driven by the pre-baked per-segment @keyframes in
   londonTrainSegments.data.css, so every dot lives on the compositor and the main thread stays idle
   behind the live terminals — the same contract the map itself keeps. */

.lt__train {
  /* `.lm` sets `fill: none; stroke: #fff` on the whole <svg>, and a CSS rule beats a presentation
     attribute, so both have to be set HERE — a fill="…" on the circle would silently lose. */
  stroke: none;
  animation-timing-function: linear;
  animation-iteration-count: 1;
  /* `both`, so a train that has arrived holds at its station instead of snapping back to the start —
     which is also what a real train does while the next refresh is on its way. */
  animation-fill-mode: both;
}

/* The one rule the baked file cannot provide: a straight run between two points known only at runtime
   (the ambiguous-branch fallback). Custom properties are substituted per element, so a single rule
   serves every glide, and the motion stays a compositor-driven animation like all the rest. */
@keyframes lt-glide {
  from { transform: translate(var(--lt-fx), var(--lt-fy)); }
  to { transform: translate(var(--lt-tx), var(--lt-ty)); }
}

/* The glow. It is a radial-gradient FILL, not an SVG filter and not box-shadow, for three reasons:
   a shadow leaves the core fully opaque and only softens outwards (a hard core with a soft rim — the
   lesson from the night sky's stars); a filter would have to be applied per train, and ~280 filter
   regions is a different order of cost from 280 gradient fills; and one gradient per line means the
   halo and the core are a single element, so a train is one <circle> rather than three nodes.

   The stops carry the SHAPE (shared) and the per-line blocks below carry the COLOUR, which is what
   keeps every hex in this stylesheet. */
.lt__stop--core { stop-opacity: 0.95; }
.lt__stop--mid { stop-opacity: 0.5; }
.lt__stop--edge { stop-opacity: 0; }

/* Per line: the gradient's colour, and the fill that references it. The hexes are TfL's official 2016
   palette, verbatim, with two documented exceptions — see northern and piccadilly. The map's own lines
   stay white, so these dots carry the only colour on screen (spec §6). */
#lt-g-bakerloo stop { stop-color: #b36305; }
.lt__train--bakerloo { fill: url(#lt-g-bakerloo); }

#lt-g-central stop { stop-color: #e32017; }
.lt__train--central { fill: url(#lt-g-central); }

#lt-g-circle stop { stop-color: #ffd300; }
.lt__train--circle { fill: url(#lt-g-circle); }

#lt-g-district stop { stop-color: #00782a; }
.lt__train--district { fill: url(#lt-g-district); }

#lt-g-hammersmith-city stop { stop-color: #f3a9bb; }
.lt__train--hammersmith-city { fill: url(#lt-g-hammersmith-city); }

#lt-g-jubilee stop { stop-color: #a0a5a9; }
.lt__train--jubilee { fill: url(#lt-g-jubilee); }

#lt-g-metropolitan stop { stop-color: #9b0056; }
.lt__train--metropolitan { fill: url(#lt-g-metropolitan); }

/* NOT TfL's #000000: a black dot on the app's near-black ground is not a dim train, it is an absent
   line. Lifted to a light grey — deliberately lighter than the Jubilee's #a0a5a9 so the two greys stay
   tellable apart. */
#lt-g-northern stop { stop-color: #d0d0d0; }
.lt__train--northern { fill: url(#lt-g-northern); }

/* NOT TfL's #003688 for the same reason: a dark navy dot vanishes against the #122a3e ground. Lifted
   just far enough to read, keeping the line's blue identity. */
#lt-g-piccadilly stop { stop-color: #3060c8; }
.lt__train--piccadilly { fill: url(#lt-g-piccadilly); }

#lt-g-victoria stop { stop-color: #0098d4; }
.lt__train--victoria { fill: url(#lt-g-victoria); }

#lt-g-waterloo-city stop { stop-color: #95cdba; }
.lt__train--waterloo-city { fill: url(#lt-g-waterloo-city); }

/* Reduced motion: the trains hold still. Pausing rather than removing the animation is what keeps them
   in the RIGHT places — a paused animation with a negative delay renders the exact point on the curve
   the train has reached, which no static transform could reproduce without evaluating the spline at
   runtime. Polling also stops after one pass; see londonTrains.tsx. */
@media (prefers-reduced-motion: reduce) {
  .lt__train { animation-play-state: paused; }
}
```

- [ ] **Step 6: Write the layer component**

Create `src/background/londonTrains.tsx`:

```tsx
// londonTrains.tsx — the live-trains layer for the "London map · live" variant: one line-coloured dot
// per Underground train, placed from TfL's arrival predictions.
//
// The performance shape that matters: JS runs once per tick to fetch ONE line (~350 KB) and re-derive
// placements. Every dot's motion is a pre-baked per-segment CSS animation, so the compositor owns all of
// it and the main thread is idle in between — no per-frame work behind the live terminals.
//
// It renders a FRAGMENT, not an <svg>: the component is passed as londonMap's child and lands inside the
// tube <g>, so it inherits the map's viewBox and drift for free and needs no projection of its own.
import { useEffect, useRef, useState } from "react";
import {
  arrivalsUrl, derivePlacements, mergeLineFeed, nextLineIndex, parseArrivals, trainStyle,
  TUBE_LINE_IDS, type Feed, type Sighting, type Train,
} from "./londonTrains";
import "./londonTrains.css";
import "./londonTrainSegments.data.css";

// One line per tick, all 11 refreshed about every two minutes. Slow polling is affordable because each
// vehicle arrives with its whole onward journey, so a fetch keeps a train moving for minutes (spec §4);
// the tick doubles as the re-derive, which is what advances a train from one segment to the next.
const TICK_MS = 11_000;

// User units, so a dot scales with the viewBox fit like the glow radius and unlike the strokes — about
// 8 device px across the halo at a typical window, with a ~2px core inside it.
const TRAIN_RADIUS = 6;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Honours the variant contract's "hold still". A duplicate of nightSky's hook, deliberately: variants
// are independent units that must stay separately deletable, and 12 lines is a cheaper price for that
// than a shared module both would depend on.
function useStillTrains(): boolean {
  const [still, setStill] = useState(() => window.matchMedia?.(REDUCED_MOTION).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_MOTION);
    if (!mq) return;
    const onChange = () => setStill(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return still;
}

// A hidden window freezes CSS animations but keeps timers running, so polling would carry on fetching
// megabytes to move dots nobody can see, and every train would jump on return. VISIBILITY, not focus:
// an unfocused but visible window still animates, and a background is meant to be ambient.
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export function LondonTrains() {
  const still = useStillTrains();
  const visible = useVisible();
  // Refs, not state: the feed and the sightings are the tick's own working memory, and re-rendering on
  // every change to them would defeat the point of only re-rendering once a tick.
  const feed = useRef<Feed>(new Map());
  const sightings = useRef<ReadonlyMap<string, Sighting>>(new Map());
  const rota = useRef(0);
  const [trains, setTrains] = useState<Train[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let passes = 0;
    let timer = 0;
    const tick = async () => {
      const lineId = TUBE_LINE_IDS[rota.current];
      rota.current = nextLineIndex(rota.current, TUBE_LINE_IDS.length);
      try {
        const response = await fetch(arrivalsUrl(lineId));
        if (!response.ok) throw new Error(`TfL ${response.status}`);
        const vehicles = parseArrivals(await response.json(), lineId, Date.now());
        if (cancelled) return;
        feed.current = mergeLineFeed(feed.current, lineId, vehicles);
      } catch {
        // A background has nowhere to show an error (spec §7): keep the last known positions and try
        // again next tick. Never having succeeded at all is simply the static map.
      }
      if (cancelled) return;
      const derived = derivePlacements(feed.current, Date.now(), sightings.current);
      sightings.current = derived.sightings;
      setTrains(derived.trains);
      // Reduced motion: one pass over the rota places every train, and then ticking stops for good —
      // no animation to drive and nothing that may move, so there is nothing left to poll for.
      if (still && ++passes >= TUBE_LINE_IDS.length) window.clearInterval(timer);
    };
    void tick();
    timer = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [visible, still]);

  return (
    <>
      {/* One gradient per line, colour-free: the stops take both their shape and their colour from the
          stylesheet, which is what keeps the 11 hexes out of this file. */}
      <defs>
        {TUBE_LINE_IDS.map((lineId) => (
          <radialGradient key={lineId} id={`lt-g-${lineId}`}>
            <stop className="lt__stop--core" offset="0" />
            <stop className="lt__stop--mid" offset="0.4" />
            <stop className="lt__stop--edge" offset="1" />
          </radialGradient>
        ))}
      </defs>
      {/* Keyed by vehicleId so React reuses an element across refreshes and its animation survives. */}
      {trains.map((train) => (
        <circle
          key={train.vehicleId}
          className={`lt__train lt__train--${train.lineId}`}
          r={TRAIN_RADIUS}
          style={trainStyle(train.placement)}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 7: Let the map carry a child layer**

Modify `src/background/londonMap.tsx` — add the import, the parameter, and the child. This is the ONLY
change to shipped map code, and with no child the output is byte-identical to today's:

```tsx
import type { ReactNode } from "react";
```

```tsx
// `children` is the vehicles seam (spec §8): a live-trains layer is passed in and rendered inside the
// tube <g>, so it inherits the viewBox, the `slice` fit and the drift with no projection of its own.
// With no child this renders exactly as it always did.
export function LondonMap({ children }: { children?: ReactNode }) {
```

and inside the tube group, after the `<path>`:

```tsx
      <g className="lm__tube">
        {/* … existing comment and <path> unchanged … */}
        <path className="lm__line lm__line--tube" d={layers.tube} />
        {children}
      </g>
```

- [ ] **Step 8: Verify nothing regressed**

Run: `npx vitest run && npm run build`
Expected: all tests pass; `tsc` and Vite both clean. (`npm run build` is the check that matters here —
the component is not unit-testable in a `node` environment, so tsc is what proves the wiring.)

- [ ] **Step 9: Commit**

```bash
git add src/background/londonTrains.ts src/background/londonTrains.tsx src/background/londonTrains.css \
        src/background/londonTrains.test.ts src/background/londonMap.tsx
git commit -m "feat(background): render live trains over the London map"
```

---

### Task 7: Ship the variant — registry entry, docs and verification

**Files:**
- Modify: `src/background/registry.tsx` (one added entry)
- Modify: `src/background/registry.test.ts` (one added case)
- Modify: `README.md` (attribution note)
- Modify: `CLAUDE.md` (as-built note)

**Interfaces:**
- Consumes: `LondonMap`, `LondonTrains`.
- Produces: background id `"london-map-live"`, label `"London map · live"`.

- [ ] **Step 1: Write the failing test**

Append to `src/background/registry.test.ts`:

```ts
describe("the live London map", () => {
  const live = BACKGROUNDS.find((b) => b.id === "london-map-live");

  // A SEPARATE variant, not a setting on the static map (spec §8): picking a background must never
  // silently start network activity you did not ask for, and the trains have to be deletable wholesale.
  it("is its own entry alongside the static map", () => {
    expect(live).toBeDefined();
    expect(BACKGROUNDS.some((b) => b.id === "london-map")).toBe(true);
  });
  it("credits TfL, whose licence requires it for the live feed too", () => {
    expect(live?.attribution).toContain("Powered by TfL Open Data");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/registry.test.ts`
Expected: FAIL — `expected undefined to be defined`.

- [ ] **Step 3: Add the registry entry**

Modify `src/background/registry.tsx` — import the trains layer:

```tsx
import { LondonTrains } from "./londonTrains";
```

and add, after the `london-map` entry (extract the shared attribution string to a `const TFL_ATTRIBUTION`
above `BACKGROUNDS` and use it for both entries, keeping its existing comment):

```tsx
  {
    id: "london-map-live",
    label: "London map · live",
    // The same map with real Underground trains on it. A separate entry rather than a setting on the
    // static one, so choosing a background never silently starts polling, and so the trains can be
    // deleted wholesale (spec §8). Offline it degrades to precisely the static variant.
    render: () => (
      <LondonMap>
        <LondonTrains />
      </LondonMap>
    ),
    attribution: TFL_ATTRIBUTION,
  },
```

- [ ] **Step 4: Run the whole suite plus both builds**

```bash
npx vitest run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: JS tests green (Tasks 1–7's new cases included), `tsc` + Vite clean, 137 Rust tests still
green (nothing here touches Rust).

- [ ] **Step 5: Document the variant**

In `README.md`, beside the existing map attribution, note that the live variant additionally reads TfL's
Unified API (`api.tfl.gov.uk/Line/{id}/Arrivals`) at runtime — no key, no account — and that the static
variant makes no network calls at all.

In `CLAUDE.md`, add an as-built bullet after the London-map one recording: the five new files and the two
touched; that segment keyframes are baked **downstream** from `londonMap.data.ts` by
`scripts/bake-train-segments.mjs` (no network, map data untouched); that branch resolution is structural
via the station-after-next; that motion is pre-baked `@keyframes` + a negative delay because
`offset-path` is not compositor-accelerated in WebKit; that reduced motion pauses the animations rather
than repositioning (a paused negative-delay animation is the only way to hold a train on the curve
without evaluating the spline at runtime); and that polling is one line per ~11s, visibility-gated.

- [ ] **Step 6: GUI smoke (the definition of done)**

Run `npm run tauri dev`, then in Settings pick **London map · live** and check:

1. Dots appear within ~15s, in line colours, and **glide** along the drawn lines rather than jumping
   between stations — watch a curved outer segment (Metropolitan) to confirm the dot tracks the bow of
   the line and not the chord.
2. They stay on the lines: no dot drifting through blank space.
3. Interaction: type in a terminal while trains run — no stutter. (Spec §10.1's open risk. If ~280
   animated elements do bite, the mitigations are fewer lines or larger dots at lower count.)
4. Offline: turn Wi-Fi off, reselect the variant → the still map, no error, no blank ground. Turn it back
   on → trains reappear within a couple of minutes.
5. Hidden window: switch to another app for a minute, come back → trains are still sensible, not piled
   up or all jumping at once.
6. Reduced motion: `defaults write -g NSWindowAnimationsEnabled -bool false` is *not* the switch — use
   System Settings → Accessibility → Display → **Reduce motion**, then reselect the variant: dots appear
   and hold completely still, on the lines.
7. The static **London map** variant is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/background/registry.tsx src/background/registry.test.ts README.md CLAUDE.md
git commit -m "feat(background): add the London map · live variant"
```

---

## Notes for the implementer

- **Do not substitute `offset-path`** for the baked keyframes, however much tidier it looks: it is not
  compositor-accelerated in WebKit and would put ~280 elements on the main thread behind live terminals
  (spec §6.1).
- **Do not re-run `scripts/bake-london-map.mjs`** or edit `londonMap.data.ts`. OSM moves upstream, so a
  re-bake's diff cannot be reviewed against the previous one.
- If curve-following proves fiddly, spec §6.1's escape hatch is un-splining the tube layer in the map's
  bake — but that IS a map re-bake, so raise it with the user rather than taking it unilaterally.
- The `lt-glide` fallback and `resolvePlacement`'s reflection are one-tick stopgaps: the next tick gives
  the train a sighting to glide from, and the tick after that usually resolves its branch.
