# London Map Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second background variant — a minimal, lines-only geographic map of London (roads, the Underground, the Thames) in white strokes with a slight glow — built from open data baked to SVG paths at build time.

**Architecture:** A one-off Node script fetches OSM roads (via Overpass) and TfL tube geometry, merges/simplifies/projects them, and writes a committed TypeScript data file. The runtime variant is a static import rendered as 8 `<path>` elements in one `<svg>`, with a single CSS transform for slow drift. No runtime network, no API key, no Rust.

**Tech Stack:** Node 18+ ESM (bake script, zero new dependencies), React 19 + TypeScript (variant), Vitest (pure-logic tests), SVG + CSS.

**Spec:** `docs/superpowers/specs/2026-08-05-london-map-background-design.md`

## Global Constraints

- **Variant contract** (`src/background/background.css`): animate only `transform`/`opacity`/`filter`, and hold still under `prefers-reduced-motion`.
- **Variant colours are literal**, not tokens — a background *is* colour, so variant stylesheets are a literal-colour site like `deepSlate.css` and `TERM_THEME`.
- **British English** in prose and comments. `kebab-case` filenames except React components, which follow the existing `camelCase.tsx` in `src/background/`.
- **Comments explain why, not what.** One line at the top of every file stating its role; one line above each non-obvious block. Never restate what the code says.
- **No new dependencies.** The bake script uses only Node built-ins and global `fetch`.
- **Bounding box** (exact, spec §3): `west: -0.2549`, `east: 0.0495`, `south: 51.448`, `north: 51.566`.
- **Render target:** `WIDTH = 2000` px, simplification tolerance `1` px.
- **Do not change `DEFAULT_BACKGROUND`** — Night Sky stays the default.
- Tests: `npx vitest run`. Build: `npm run build`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/mapGeometry.mjs` | **Create.** Pure geometry: merge, simplify, project, spline, path emit. No I/O, so it is unit-tested. |
| `scripts/mapGeometry.test.mjs` | **Create.** Tests for the above. |
| `scripts/bake-london-map.mjs` | **Create.** The I/O half: fetch TfL + Overpass, orchestrate, write the data file. |
| `src/background/londonMap.data.ts` | **Create (generated).** Committed output of the bake. Never hand-edited. |
| `src/background/londonMap.tsx` | **Create.** The variant component. |
| `src/background/londonMap.css` | **Create.** Strokes, glow, drift. |
| `src/background/registry.tsx` | **Modify.** One entry + an optional `attribution` field on `BackgroundVariant`. |
| `src/background/registry.test.ts` | **Modify.** Cover the new field and the new entry. |
| `src/views/AppearanceSettings.tsx` | **Modify.** Render the selected variant's attribution. |

The split is I/O versus pure logic: geometry is subtle and worth pinning with tests, fetching is not testable headlessly and is verified by running it. That mirrors the repo's existing habit of extracting pure helpers (`paneSet.ts`, `chips.ts`, `drop.ts`) beside the effectful code.

---

### Task 1: Pure bake geometry

**Files:**
- Create: `scripts/mapGeometry.mjs`
- Test: `scripts/mapGeometry.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces, all operating on `[x, y]` (or `[lon, lat]`) number-pair arrays:
  - `mergeChains(lines: number[][][]) => number[][][]`
  - `simplify(points: number[][], tolerance: number) => number[][]`
  - `projectionFor(bbox: {west,east,south,north}, width: number) => {west, north, scaleX, scaleY, width, height}`
  - `project(lat: number, lon: number, p: Projection) => [number, number]`
  - `toPathD(lines: number[][][]) => string`
  - `splineD(points: number[][]) => string`

- [ ] **Step 1: Write the failing tests**

Create `scripts/mapGeometry.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/mapGeometry.test.mjs`
Expected: FAIL — `Failed to load .../scripts/mapGeometry.mjs`.

- [ ] **Step 3: Implement the geometry module**

Create `scripts/mapGeometry.mjs`:

```js
// mapGeometry.mjs — pure geometry for the London-map bake: joining, thinning, projecting and emitting
// polylines. No I/O lives here, which is what makes it unit-testable; fetching and writing are in
// bake-london-map.mjs.

const key = (p) => `${p[0]},${p[1]}`;

// OSM starts a new way at every junction and tag change, so a single road arrives as dozens of 2-4
// point stubs — and a 2-point stub has nothing for Douglas-Peucker to remove. Joining ways that share
// an endpoint first is therefore worth far more than tuning the tolerance: measured on the primary
// tier, 13,667 ways collapse to 1,084 chains, and simplification then reaches 5,269 points instead of
// ~27,000.
export function mergeChains(lines) {
  const ends = new Map();
  const remember = (k, i) => ends.set(k, [...(ends.get(k) ?? []), i]);
  lines.forEach((l, i) => {
    remember(key(l[0]), i);
    remember(key(l[l.length - 1]), i);
  });

  const used = new Array(lines.length).fill(false);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = [...lines[i]];
    let grew = true;
    while (grew) {
      grew = false;
      // Try the tail first, then the head — a chain can be extended from either end, and stopping at
      // the tail alone would leave every road split at whichever way happened to be visited first.
      for (const atFront of [false, true]) {
        const end = atFront ? chain[0] : chain[chain.length - 1];
        for (const j of ends.get(key(end)) ?? []) {
          if (used[j]) continue;
          const candidate = lines[j];
          const seg = key(candidate[0]) === key(end) ? [...candidate] : [...candidate].reverse();
          if (key(seg[0]) !== key(end)) continue; // shares the far end only; leave it for its own turn
          used[j] = true;
          chain = atFront ? [...seg.slice(1).reverse(), ...chain] : [...chain, ...seg.slice(1)];
          grew = true;
          break;
        }
        if (grew) break;
      }
    }
    out.push(chain);
  }
  return out;
}

function perpDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  // Clamped to the segment, so a point beyond an endpoint measures to that endpoint rather than to the
  // infinite line — otherwise a hairpin's tip reads as close to the line it doubles back along.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Douglas-Peucker, iterative rather than recursive: a merged chain can be thousands of points long and
// deep recursion on one is a needless stack risk.
export function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = 0;
    let worstAt = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpDistance(points[k], points[i], points[j]);
      if (d > worst) {
        worst = d;
        worstAt = k;
      }
    }
    if (worstAt !== -1 && worst > tolerance) {
      keep[worstAt] = true;
      stack.push([i, worstAt], [worstAt, j]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Equirectangular. The cos(latitude) correction DIVIDES: a degree of longitude covers less ground the
// further from the equator, so pixels-per-degree of LATITUDE is the larger of the two. Multiplying
// instead squashes London vertically — a test pins the resulting aspect ratio because the slip is easy
// to make and hard to spot by eye.
export function projectionFor({ west, east, south, north }, width) {
  const scaleX = width / (east - west);
  const scaleY = scaleX / Math.cos((((south + north) / 2) * Math.PI) / 180);
  return { west, north, scaleX, scaleY, width, height: Math.round((north - south) * scaleY) };
}

// y grows downwards from the bbox's northern edge, matching SVG's coordinate space.
export function project(lat, lon, p) {
  return [(lon - p.west) * p.scaleX, (p.north - lat) * p.scaleY];
}

// One <path> per class: a single d string may hold many DISCONNECTED subpaths, so an entire road class
// becomes one DOM node instead of one per way. Coordinates round to whole pixels because the render
// target is ~10m/px — sub-pixel precision is dead weight in the bundle.
export function toPathD(lines) {
  return lines
    .map((line) => {
      const rounded = line.map(([x, y]) => [Math.round(x), Math.round(y)]);
      const deduped = rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1][0] || p[1] !== rounded[i - 1][1]);
      return deduped.length < 2 ? "" : `M${deduped.map(([x, y]) => `${x} ${y}`).join("L")}`;
    })
    .join("");
}

// Catmull-Rom through the points, converted to cubic Béziers. Needed because TfL's lineStrings are
// station-to-station chords rather than track geometry, so a tube line drawn from them is polygonal —
// invisible in central London but obvious on long outer segments.
export function splineD(points) {
  if (points.length < 3) return toPathD([points]);
  const r = (n) => Math.round(n * 10) / 10; // 0.1px is well below anything visible, and shortens the string
  let d = `M${r(points[0][0])} ${r(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    // The end segments duplicate their own endpoint as the missing neighbour, which makes the curve
    // start and finish straight instead of overshooting.
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`;
  }
  return d;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/mapGeometry.test.mjs`
Expected: PASS, 20 tests.

- [ ] **Step 5: Confirm the build ignores the scripts directory**

Run: `npm run build`
Expected: PASS. `tsc` should not attempt to type-check `scripts/`. If it reports errors there, add `"exclude": ["scripts"]` to `tsconfig.json` and re-run.

- [ ] **Step 6: Commit**

```bash
git add scripts/mapGeometry.mjs scripts/mapGeometry.test.mjs
git commit -m "feat(background): pure geometry for the London-map bake"
```

---

### Task 2: The bake script and its generated data

**Files:**
- Create: `scripts/bake-london-map.mjs`
- Create (by running it): `src/background/londonMap.data.ts`

**Interfaces:**
- Consumes: everything exported from `scripts/mapGeometry.mjs` (Task 1).
- Produces: `src/background/londonMap.data.ts` exporting `LONDON_MAP` with this exact shape, which Task 3 renders:

```ts
export const LONDON_MAP = {
  projection: { west: number, north: number, scaleX: number, scaleY: number },
  width: number,
  height: number,
  layers: { motorway: string, primary: string, secondary: string, tube: string, thames: string },
  tubeLines: { id: string, stations: { id: string, x: number, y: number }[] }[],
};
```

This task has no unit tests: it is all network I/O, and its real verification is that it runs and emits geometry of the expected size. The pure parts it depends on are already tested in Task 1.

- [ ] **Step 1: Write the bake script**

Create `scripts/bake-london-map.mjs`:

```js
// bake-london-map.mjs — fetches the London map geometry once, offline, and writes it as a committed
// TypeScript module. Run by hand (`node scripts/bake-london-map.mjs`), NOT as part of the build: the
// app ships finished geometry, so at runtime there is no network call, no API key, and therefore no
// error state a background would have nowhere to display.
//
// Attribution is a licence condition of both sources and is emitted into the generated file's header;
// the app shows it in Settings beside the background picker.
import { writeFile } from "node:fs/promises";
import { mergeChains, projectionFor, project, simplify, splineD, toPathD } from "./mapGeometry.mjs";

const BBOX = { west: -0.2549, east: 0.0495, south: 51.448, north: 51.566 };
const WIDTH = 2000;
const TOLERANCE_PX = 1;
const OUT = new URL("../src/background/londonMap.data.ts", import.meta.url);

// The road tiers, grouped as they are STYLED (see the spec's stroke table) rather than as OSM tags
// them. Measured: the three tiers below total ~51 KB of path data, so there is headroom — adding
// `tertiary: ["tertiary", "tertiary_link"]` here is the whole change if the map wants more texture.
const ROAD_TIERS = {
  motorway: ["motorway", "motorway_link"],
  primary: ["trunk", "trunk_link", "primary", "primary_link"],
  secondary: ["secondary", "secondary_link"],
};

const TUBE_LINES = [
  "bakerloo", "central", "circle", "district", "hammersmith-city",
  "jubilee", "metropolitan", "northern", "piccadilly", "victoria", "waterloo-city",
];

const OVERPASS = "https://overpass-api.de/api/interpreter";
const STRIPS = 3; // splitting the bbox keeps each query small enough to survive Overpass's timeout

// Overpass's Apache front-end 406s Node's default (undici) User-Agent outright — an un-UA'd fetch never
// reaches the Overpass backend at all, while curl and a UA'd fetch both do.
const FETCH_HEADERS = { "User-Agent": "cockpit-london-map-bake/1.0 (github.com/victormasson21/cockpit)" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Overpass and TfL both throttle, and Overpass 504s under load even on valid queries, so every call
// retries with a long pause rather than failing the whole bake near the end of a slow run.
async function getJson(url, init, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.log(`    retry ${attempt} after ${err.message}`);
      await sleep(25_000);
    }
  }
}

// Exact tag matches, never a regex. `way["highway"~"^(a|b)$"]` bypasses Overpass's tag index and scans
// the whole bbox, which 504s reliably on both the public endpoint and the kumi mirror; a union of
// exact matches uses the index and returns in seconds.
async function fetchWays(tagFilters, label) {
  // Overpass's bbox filter matches a way if ANY of its nodes fall inside the query bbox, then returns
  // that way's FULL, unclipped geometry — so a way straddling a strip boundary comes back whole from
  // BOTH adjacent strips. Without this, the duplicate reaches mergeChains as two identical entries,
  // which joins the way to itself into one degenerate chain that runs out to its far end and back over
  // itself. Deduping by OSM way id (not by geometry) catches this before mergeChains ever sees it.
  const byId = new Map();
  let duplicates = 0;
  for (let strip = 0; strip < STRIPS; strip++) {
    const w = BBOX.west + ((BBOX.east - BBOX.west) * strip) / STRIPS;
    const e = BBOX.west + ((BBOX.east - BBOX.west) * (strip + 1)) / STRIPS;
    const union = tagFilters.map((f) => `way${f}(${BBOX.south},${w},${BBOX.north},${e});`).join("");
    const data = await getJson(OVERPASS, {
      method: "POST",
      headers: FETCH_HEADERS,
      body: new URLSearchParams({ data: `[out:json][timeout:180];(${union});out geom;` }),
    });
    for (const way of data.elements) {
      if (!way.geometry) continue;
      if (byId.has(way.id)) {
        duplicates++;
        continue;
      }
      byId.set(way.id, way.geometry.map((g) => [g.lon, g.lat]));
    }
    await sleep(5000);
  }
  console.log(`    ${label}: dropped ${duplicates} duplicate way(s) at strip boundaries`);
  return [...byId.values()];
}

// Merge BEFORE projecting. Two ways meeting at a junction share an OSM node, so their endpoints are
// bit-identical in lat/lon and match exactly; projecting and rounding first would break that identity
// and leave every road fragmented.
function bakeLayer(lines, projection) {
  const merged = mergeChains(lines);
  const thinned = merged.map((chain) => simplify(chain.map(([lon, lat]) => project(lat, lon, projection)), TOLERANCE_PX));
  return toPathD(thinned);
}

// A tube line's branches arrive as separate stopPointSequences, and the two directions mostly repeat
// each other, so sequences are deduped by their station-id signature in both orders.
async function fetchTubeLine(id) {
  const sequences = [];
  const seen = new Set();
  for (const direction of ["inbound", "outbound"]) {
    const data = await getJson(`https://api.tfl.gov.uk/Line/${id}/Route/Sequence/${direction}`);
    for (const seq of data.stopPointSequences ?? []) {
      const stations = seq.stopPoint.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }));
      if (stations.length < 2) continue;
      const ids = stations.map((s) => s.id);
      const signature = ids.join(">");
      const reversed = [...ids].reverse().join(">");
      if (seen.has(signature) || seen.has(reversed)) continue;
      seen.add(signature);
      sequences.push(stations);
    }
    await sleep(1000);
  }
  return sequences;
}

async function main() {
  const projection = projectionFor(BBOX, WIDTH);
  console.log(`frame ${projection.width}x${projection.height} (aspect ${(projection.width / projection.height).toFixed(2)})`);

  const layers = {};
  for (const [tier, values] of Object.entries(ROAD_TIERS)) {
    const lines = await fetchWays(values.map((v) => `["highway"="${v}"]`), tier);
    layers[tier] = bakeLayer(lines, projection);
    console.log(`${tier}: ${lines.length} ways -> ${(layers[tier].length / 1024).toFixed(0)} KB`);
  }

  const thames = await fetchWays(['["waterway"="river"]["name"="River Thames"]'], "thames");
  layers.thames = bakeLayer(thames, projection);
  console.log(`thames: ${thames.length} ways -> ${(layers.thames.length / 1024).toFixed(1)} KB`);

  // Station pixel coordinates are baked alongside the strokes so the vehicles step can interpolate a
  // train between two stations without converting a lat/lon at runtime at all.
  const tubeLines = [];
  const tubePaths = [];
  for (const id of TUBE_LINES) {
    for (const [i, stations] of (await fetchTubeLine(id)).entries()) {
      const placed = stations.map((s) => {
        const [x, y] = project(s.lat, s.lon, projection);
        return { id: s.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      });
      tubeLines.push({ id: i === 0 ? id : `${id}-${i}`, stations: placed });
      tubePaths.push(splineD(placed.map((s) => [s.x, s.y])));
    }
    console.log(`tube ${id}: done`);
  }
  layers.tube = tubePaths.join("");

  const total = Object.values(layers).reduce((n, d) => n + d.length, 0);
  console.log(`total path data: ${(total / 1024).toFixed(0)} KB across ${Object.keys(layers).length} layers`);

  const data = {
    projection: {
      west: projection.west,
      north: projection.north,
      scaleX: Math.round(projection.scaleX * 100) / 100,
      scaleY: Math.round(projection.scaleY * 100) / 100,
    },
    width: projection.width,
    height: projection.height,
    layers,
    tubeLines,
  };

  await writeFile(
    OUT,
    `// londonMap.data.ts — GENERATED by scripts/bake-london-map.mjs. Do not edit by hand; re-run the
// script instead. Geometry is pre-projected into the pixel space described by \`projection\`, so
// nothing here needs transforming at runtime.
//
// Powered by TfL Open Data. Contains OS data (c) Crown copyright and database rights.
// Map data (c) OpenStreetMap contributors, available under the Open Database Licence.
export const LONDON_MAP = ${JSON.stringify(data)} as const;
`,
  );
  console.log(`wrote ${OUT.pathname}`);
}

await main();
```

- [ ] **Step 2: Run the bake**

Run: `node scripts/bake-london-map.mjs`

Expected, on the order of several minutes because of the deliberate pauses between calls:
- A frame line reading roughly `frame 2000x1246 (aspect 1.61)`. **If the aspect is not ~1.6, stop** — the projection is inverted and Task 1's tests should have caught it.
- Per-tier sizes in the region of motorway+primary ≈ 42 KB and secondary ≈ 9 KB.
- `total path data:` under ~100 KB.
- `wrote .../src/background/londonMap.data.ts`.

Overpass 504s and retries in the log are expected and harmless. If a tier fails all 4 attempts, re-run — the script is idempotent.

- [ ] **Step 3: Sanity-check the generated file**

Node cannot import a `.ts` module, so check the file as text and parse the object out of it:

```bash
ls -lh src/background/londonMap.data.ts
head -c 300 src/background/londonMap.data.ts
node -e '
const fs = require("node:fs");
const src = fs.readFileSync("src/background/londonMap.data.ts", "utf8");
const json = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
const m = JSON.parse(json);
console.log("frame", m.width + "x" + m.height, "aspect", (m.width / m.height).toFixed(2));
for (const [k, d] of Object.entries(m.layers)) console.log(k, (d.length / 1024).toFixed(1) + " KB", d.startsWith("M") ? "ok" : "MALFORMED");
console.log("tubeLines", m.tubeLines.length, "stations", m.tubeLines.reduce((n, l) => n + l.stations.length, 0));
'
```

Expected: a file of roughly 60–120 KB; aspect ~1.6; every layer non-empty and starting with `M`; `tubeLines` at least 11 (branching lines contribute more than one) with several hundred stations in total.

- [ ] **Step 4: Verify the build accepts the generated module**

Run: `npm run build`
Expected: PASS. A large `as const` object is fine for tsc; if it complains about the literal's size, drop `as const` from the generated file's template and re-run the bake.

- [ ] **Step 5: Commit the script and its output together**

They must land in one commit: the data is only reviewable in the context of the script that produced it, and a revert should take both.

```bash
git add scripts/bake-london-map.mjs src/background/londonMap.data.ts
git commit -m "feat(background): bake London roads, tube and Thames to SVG paths"
```

---

### Task 3: The variant

**Files:**
- Create: `src/background/londonMap.tsx`
- Create: `src/background/londonMap.css`
- Modify: `src/background/registry.tsx`
- Modify: `src/background/registry.test.ts`
- Modify: `src/views/AppearanceSettings.tsx`

**Interfaces:**
- Consumes: `LONDON_MAP` from Task 2.
- Produces: `LondonMap` component; `BackgroundVariant.attribution?: string`.

- [ ] **Step 1: Write the failing registry tests**

Add to `src/background/registry.test.ts`, inside the existing `describe("BACKGROUNDS", ...)` block:

```ts
  it("ships the London map variant", () => {
    expect(BACKGROUNDS.some((b) => b.id === "london-map")).toBe(true);
  });
  // Both the TfL and OpenStreetMap licences require credit, and a background has nowhere to show it —
  // so the variant carries the text and the picker displays it. An empty string would silently
  // satisfy the type while breaching the licence.
  it("has non-empty attribution wherever attribution is declared", () => {
    for (const b of BACKGROUNDS) {
      if (b.attribution !== undefined) expect(b.attribution.trim().length).toBeGreaterThan(0);
    }
  });
  it("credits both open-data sources on the London map", () => {
    const attribution = BACKGROUNDS.find((b) => b.id === "london-map")?.attribution ?? "";
    expect(attribution).toMatch(/TfL/);
    expect(attribution).toMatch(/OpenStreetMap/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/background/registry.test.ts`
Expected: FAIL — three failures: no `london-map` entry, and `attribution` not a property of `BackgroundVariant`.

- [ ] **Step 3: Write the component**

Create `src/background/londonMap.tsx`:

> **The snippet below is the plan as written, and the shipped file differs in three ways** — all three found by the whole-branch review, all three now in the code and in the spec. Read the file, not this, if you are looking for what exists: (1) the tube layer is inside its own `<g>`, which §7 promised and this snippet forgot; (2) the blur is an SVG `<filter>` with a `userSpaceOnUse` region pinned to the frame, because a CSS `filter: blur()` would take its region from a bounding box ~7× the frame; (3) the glow group sets its own wider `stroke-width` in the CSS, without which the halo is a dimmed copy rather than a halo.

```tsx
// londonMap.tsx — the "London map" background variant: a lines-only geographic map of London (roads,
// the Underground, the Thames), baked to SVG paths at build time.
//
// The performance shape that matters: the geometry is a static import and NOTHING animates except one
// CSS transform on the <svg> itself, so the map rasterises once into a single composited layer and the
// main thread stays idle behind the live terminals. One <path> per class is what keeps this at seven
// DOM nodes rather than the ~13,600 ways OSM actually returns.
import { LONDON_MAP } from "./londonMap.data";
import "./londonMap.css";

const { width, height, layers } = LONDON_MAP;

// Painted back to front: the dimmest substrate first, the tube last so it reads as the map's subject —
// which it is, being the layer that will carry live trains.
const ORDER = ["secondary", "primary", "motorway", "thames", "tube"] as const;

// Only the major classes get a halo. A glow under every secondary road is mush to look at, and the
// blurred copy is the expensive half of rasterising the layer.
const GLOWING = new Set<(typeof ORDER)[number]>(["primary", "motorway", "tube"]);

export function LondonMap() {
  return (
    // `slice` is `cover` with no CSS involved: the frame fills the window and the surplus is cropped.
    <svg className="lm" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g className="lm__glow">
        {ORDER.filter((k) => GLOWING.has(k)).map((k) => (
          <path key={k} className={`lm__line lm__line--${k}`} d={layers[k]} />
        ))}
      </g>
      {ORDER.map((k) => (
        <path key={k} className={`lm__line lm__line--${k}`} d={layers[k]} />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

Create `src/background/londonMap.css`:

```css
/* londonMap.css — the London-map variant's artwork. Colours are literal here by design: a background
   IS colour (see the variant contract in background.css).

   Only one transform animates, on the <svg> element itself, so the whole map lives on the compositor
   and is never repainted. */

.lm {
  position: absolute;
  /* Oversized and offset by half the overshoot, so the drift below can never pull an edge into view. */
  left: -2%;
  top: -2%;
  width: 104%;
  height: 104%;
  fill: none;
  stroke: #fff;
  stroke-linecap: round;
  stroke-linejoin: round;
  animation: lm-drift 240s ease-in-out infinite alternate;
}

/* The drift is on the <svg>, not on an inner <g>: a CSS transform on an HTML-level element gets its own
   composited layer, whereas SVG group transforms are not reliably promoted and would repaint the map. */
@keyframes lm-drift {
  from { transform: translate(-0.6%, -0.4%) scale(1); }
  to { transform: translate(0.6%, 0.4%) scale(1.02); }
}

/* Strokes are in device pixels, not user units: the viewBox is scaled down to fit the window, so
   without this every width would shrink by the fit factor and the numbers below would mean nothing
   predictable while tuning. */
.lm__line { vector-effect: non-scaling-stroke; }

.lm__line--secondary { stroke-width: 0.6px; opacity: 0.1; }
.lm__line--primary { stroke-width: 1px; opacity: 0.18; }
.lm__line--motorway { stroke-width: 1.4px; opacity: 0.26; }
.lm__line--thames { stroke-width: 3px; opacity: 0.14; }
.lm__line--tube { stroke-width: 1.2px; opacity: 0.45; }

/* The halo: the same strokes again, blurred, painted underneath. NOT box-shadow or drop-shadow — a
   shadow leaves the stroke's own area fully opaque and only softens outwards, which reads as a hard
   core with a soft rim. That was the lesson from the night sky's star glow. */
.lm__glow {
  filter: blur(2.5px);
  opacity: 0.55;
}

/* Reduced motion: the map holds still. It is static anyway, so only the drift has to stop. */
@media (prefers-reduced-motion: reduce) {
  .lm { animation: none; }
}
```

- [ ] **Step 5: Register the variant and add the attribution field**

In `src/background/registry.tsx`, add the import beside the existing one:

```tsx
import { LondonMap } from "./londonMap";
```

Add the field to the interface:

```tsx
export interface BackgroundVariant {
  id: string;
  label: string; // shown in the Settings picker
  render: () => ReactElement;
  // Variants built from third-party open data whose licence requires credit carry it here. A
  // background has nowhere to display it, so the Settings picker shows it instead.
  attribution?: string;
}
```

Add the entry to `BACKGROUNDS`, after `night-sky`:

```tsx
  {
    id: "london-map",
    label: "London map",
    render: () => <LondonMap />,
    attribution:
      "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights. "
      + "Map data © OpenStreetMap contributors, available under the Open Database Licence.",
  },
```

- [ ] **Step 6: Show the attribution in Settings**

In `src/views/AppearanceSettings.tsx`, extend the registry import to include `resolveBackground`:

```tsx
import { BACKGROUNDS, DEFAULT_BACKGROUND, NO_BACKGROUND, resolveBackground } from "../background/registry";
```

Resolve the selected variant beside the existing `current`:

```tsx
  const variant = resolveBackground(current);
```

And render its credit after the existing hint paragraph:

```tsx
      {variant?.attribution && <p className="appearance__hint">{variant.attribution}</p>}
```

- [ ] **Step 7: Run the full suite and the build**

Run: `npx vitest run && npm run build`
Expected: PASS. The registry's existing unique-id and default-resolution tests must still pass — the new entry must not become the default.

- [ ] **Step 8: Commit**

```bash
git add src/background/londonMap.tsx src/background/londonMap.css src/background/registry.tsx \
        src/background/registry.test.ts src/views/AppearanceSettings.tsx
git commit -m "feat(background): add the London map variant"
```

---

### Task 4: Tune by eye, and decide on tertiary roads

**Files:**
- Modify: `src/background/londonMap.css` (stroke values, glow, drift)
- Modify: `scripts/bake-london-map.mjs` (only if tertiary roads are adopted)
- Modify: `docs/superpowers/specs/2026-08-05-london-map-background-design.md` (record the values actually chosen)

The stroke table in the spec is a starting point, stated there as such. This task exists because nobody can judge these numbers without looking at them, and the tertiary question was explicitly left open for the same reason.

- [ ] **Step 1: Look at it**

Run: `npm run tauri dev`

Then Settings → Appearance → Background → **London map**, and switch to the **Calm** view, which leaves the most space.

- [ ] **Step 2: Work through the smoke checklist**

- [ ] The map reads as London — the Thames is legible and the tube stands out from the roads.
- [ ] Strokes are visible but recede behind the UI; nothing competes with terminal text.
- [ ] The glow is a soft halo, not a hard core with a rim, and shows no banding.
- [ ] No edge of the map is ever exposed as it drifts (watch for a full drift cycle, or temporarily shorten `lm-drift` to `20s` to check quickly, then restore it).
- [ ] Scrolling a terminal and switching views stays smooth — the map must not cause repaints.
- [ ] Gutters and empty slots in the **Cockpit** and **Worktrees** views show the map without it looking like chrome.
- [ ] With macOS Reduce Motion on (System Settings → Accessibility → Display), the map holds still.
- [ ] Settings shows the TfL and OpenStreetMap credit under the picker when London map is selected, and not when Night sky is.

- [ ] **Step 3: Tune the stroke table**

Four knobs, and they are no longer all in one file:

- The five `stroke-width`/`opacity` pairs in `src/background/londonMap.css`. Widths are in device pixels thanks to `vector-effect`, so these numbers mean what they say. `.lm__line--motorway` is **not** one of them in practice — that tier bakes empty in this bbox, so changing it does nothing visible (spec §2).
- `.lm__glow .lm__line`'s `stroke-width` in the same file — the halo's own width. This is what makes a halo exist at all: blur conserves alpha, so a glow stroke at the crisp width just dims away.
- `.lm__glow`'s `opacity` — the halo's single brightness knob, balanced against that width.
- `GLOW_BLUR` in `src/background/londonMap.tsx`, not the CSS. The blur is an SVG `<filter>` there for a reason the comment beside it spells out; read it before moving it back to `filter: blur()`. Note the unit mismatch while tuning: `GLOW_BLUR` is in **user units** (scaled by the viewBox fit) while the stroke widths are in **device pixels** (pinned), so the ratio you settle on is only exact at the window size you tune at. Tune at a normal working window size, and re-check the glow once at a very different one.

- [ ] **Step 4: Judge tertiary roads**

Add the tier to `ROAD_TIERS` in `scripts/bake-london-map.mjs`:

```js
  tertiary: ["tertiary", "tertiary_link"],
```

Then add `"tertiary"` to `ORDER` in `londonMap.tsx` (first, as the dimmest substrate — not in `GLOWING`), and give it a rule in the CSS, dimmer than secondary:

```css
.lm__line--tertiary { stroke-width: 0.5px; opacity: 0.07; }
```

Re-run `node scripts/bake-london-map.mjs`, look at it again, and keep or revert. Note the reported size — the measured baseline is ~51 KB for the three existing tiers.

- [ ] **Step 5: Record the outcome and commit**

Update the spec's §4 stroke table with the values actually chosen, and §2 and §8 if tertiary was adopted, so the document describes what shipped rather than what was proposed.

```bash
git add -A
git commit -m "feat(background): tune the London map strokes"
```

---

## Self-Review

**Spec coverage.** §1 needs no task (rationale). §2 layers → Task 2 (`ROAD_TIERS`, Thames, `TUBE_LINES`) and Task 3 (`ORDER`). §3 bbox → Task 2's `BBOX`, aspect pinned by Task 1's test. §4 strokes/glow/drift → Task 3's CSS, tuned in Task 4. §5.1 bake pipeline and all three gotchas → Task 2 (indexed queries in `fetchWays`, merge-before-project in `bakeLayer`, splining in `fetchTubeLine`/`splineD`). §5.2 runtime → Task 3. §5.3 projection and framing → Task 1's `projectionFor` plus Task 3's `preserveAspectRatio`. §5.4 testable surface → Task 1. §6 failure modes → no runtime failure path exists by construction; reduced motion and attribution are both in Task 3, with attribution verified in Task 4's checklist. §7 vehicle guarantees → Task 2 bakes the full network with NaptanId-keyed pixel coordinates, and Task 3 gives the tube layer its own `<g>`. §8 sizes → Task 2's logging. §9 deferred → nothing to build.

**Placeholders.** None: every code step carries the actual code, every run step names the command and the expected result, and Task 4's tuning steps give concrete starting values and the exact edits rather than "adjust as needed".

**Type consistency.** `LONDON_MAP`'s shape is declared once in Task 2's Interfaces block and consumed in Task 3 with matching keys (`width`, `height`, `layers`, and the five layer names, which match `ROAD_TIERS`' keys plus `thames` and `tube`). `projectionFor` returns the `{west, north, scaleX, scaleY, width, height}` that `project` and the emitted `projection` field both expect. `attribution?: string` is declared in Task 3 Step 5 and read in Step 6 and in the tests from Step 1.

**One risk worth naming.** Task 4's checklist asks whether the drifting `<svg>` causes repaints. If the blurred `<g>` turns out to re-rasterise every frame under the drift, the fix is to drop the drift rather than the glow — the glow is the requested look, the drift was my suggestion.
