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
