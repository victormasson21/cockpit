// bake-london-map.mjs — fetches the London map geometry once, offline, and writes it as a committed
// TypeScript module. Run by hand (`node scripts/bake-london-map.mjs`), NOT as part of the build: the
// app ships finished geometry, so at runtime there is no network call, no API key, and therefore no
// error state a background would have nowhere to display.
//
// Attribution is a licence condition of both sources and is emitted into the generated file's header;
// the app shows it in Settings beside the background picker.
import { writeFile } from "node:fs/promises";
import { bakeLayer, projectionFor, project, splineD } from "./mapGeometry.mjs";

const BBOX = { west: -0.2549, east: 0.0495, south: 51.448, north: 51.566 };
const WIDTH = 2000;
const TOLERANCE_PX = 1;
const OUT = new URL("../src/background/londonMap.data.ts", import.meta.url);

// The road tiers, grouped as they are STYLED (see the spec's stroke table) rather than as OSM tags
// them. Measured: the three tiers below total ~51 KB of path data, so there is headroom — adding
// `tertiary: ["tertiary", "tertiary_link"]` here is the whole change if the map wants more texture.
//
// `motorway` yields ZERO ways inside the §3 bbox — there is genuinely no motorway-tagged road in it
// (the M4 and the M1 both start outside), so the tier bakes to an empty string and the variant renders
// an empty <path>. It stays wired because that costs one empty path and makes the tier free if the box
// is ever widened; the point of saying so here is that there are TWO visible road tiers, not three, and
// nobody should tune `.lm__line--motorway` expecting to see it change.
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

// Overpass's Apache front-end 406s Node's default (undici) User-Agent outright — verified against
// this exact endpoint before writing this line: curl and a UA'd fetch both reach the real Overpass
// backend (and its normal 504s under load); an un-UA'd Node fetch never gets past the front-end.
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

// A tube line's branches arrive as separate stopPointSequences, and the two directions mostly repeat
// each other, so sequences are deduped by their station-id signature in both orders.
//
// This dedupes whole SEQUENCES, which leaves shared trunk sections drawn once per branch: 452 station
// placements across only 272 distinct stations, ~10 deep on the Northern line's core. Harmless only
// because the variant paints the whole network as ONE <path>, so its opacity composites once — see the
// warning beside that path in londonMap.tsx before splitting the layer per line.
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
    layers[tier] = bakeLayer(lines, projection, TOLERANCE_PX);
    console.log(`${tier}: ${lines.length} ways -> ${(layers[tier].length / 1024).toFixed(0)} KB`);
  }

  const thames = await fetchWays(['["waterway"="river"]["name"="River Thames"]'], "thames");
  layers.thames = bakeLayer(thames, projection, TOLERANCE_PX);
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
// Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016 and Geomni UK
// Map data © and database rights [2019]. That is verbatim the form TfL's Transport Data Service terms
// require, years and brackets included — do not tidy it.
// Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
export const LONDON_MAP = ${JSON.stringify(data)} as const;
`,
  );
  console.log(`wrote ${OUT.pathname}`);
}

await main();
