// londonTrainsModel.ts — pure logic for the "London map · live" variant: TfL arrival predictions in, a
// placement per train out. No DOM and no fetch live here (those are in londonTrains.tsx), which is what
// makes the whole derivation — including the branch disambiguation and its fallback ladder — testable.
//
// Named ...Model rather than londonTrains.ts, matching dropdownModel.ts beside Dropdown.tsx: on macOS's
// case-insensitive filesystem an extensionless `./londonTrains` resolves the .ts BEFORE the .tsx, so a
// pure module and a component cannot share a basename — the component would simply never be found.
import type { CSSProperties } from "react";
import { LONDON_MAP } from "./londonMap.data";
import { SEGMENT_ARC_LENGTHS } from "./londonTrainSegments.lengths";

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

// lat/lon into the SAME pixel space the geometry was baked into, using the projection the bake recorded
// — so a hand-placed point lands exactly where the map would have drawn it. Verified against the baked
// stations: King's Cross and Oxford Circus both reproduce to within 0.05px. y grows downwards from the
// bbox's northern edge, matching SVG. Mirrors `project` in scripts/mapGeometry.mjs, which is where the
// same arithmetic ran at bake time; nothing but this comment connects the two, and nothing needs to —
// the constants travel with the data.
export function project(lat: number, lon: number, p = LONDON_MAP.projection): Point {
  return { x: (lon - p.west) * p.scaleX, y: (p.north - lat) * p.scaleY };
}

// The @keyframes rule for a segment, plus whether the train runs against it. One rule per station PAIR
// is baked (lo → hi), so the other direction is `animation-direction: reverse` rather than a second
// rule. scripts/trainSegments.mjs builds this name the same way; that script's test pins the two
// together, because nothing but that test connects them.
export function segmentAnimation(fromId: string, toId: string): { name: string; reverse: boolean } {
  const [lo, hi] = [fromId, toId].sort();
  return { name: `lt-${lo}-${hi}`, reverse: fromId !== lo };
}

// ── The feed ────────────────────────────────────────────────────────────────────────────────────────

export interface Prediction { naptanId: string; timeToStation: number }

// One train, with its whole onward journey: TfL returns ~15 predictions per vehicleId, not just the next
// stop, which is what lets a single fetch keep a train moving for minutes (spec §3).
export interface Vehicle {
  key: string;
  vehicleId: string;
  lineId: string;
  predictions: Prediction[];
  fetchedAt: number;
}

export type Feed = ReadonlyMap<string, Vehicle>; // keyed by vehicleKey, NOT by vehicleId — see below

// ⚠️ `vehicleId` IS NOT UNIQUE ACROSS LINES. It is the train-set number ("065", "205"), and MEASURED
// against the live feed 105 of them were in use by more than one line at once — one by four. Keying the
// feed on it alone destroyed 161 of 375 trains in service (43%), because each line's refresh overwrote
// the other's entry; the survivors inherited a stranger's predictions and teleported across London when
// their line refreshed. This composite is the identity of a train, and it is also the React key.
export const vehicleKey = (lineId: string, vehicleId: string): string => `${lineId}:${vehicleId}`;

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
    const held = byVehicle.get(vehicleId);
    if (held) held.push({ naptanId, timeToStation });
    else byVehicle.set(vehicleId, [{ naptanId, timeToStation }]);
  }
  return [...byVehicle].map(([vehicleId, predictions]) => ({
    key: vehicleKey(lineId, vehicleId),
    vehicleId,
    lineId,
    fetchedAt,
    predictions: predictions.sort((a, b) => a.timeToStation - b.timeToStation),
  }));
}

// A line's fetch is the complete truth about that line: a train absent from the new payload has finished
// its journey and must leave the map.
//
// ⚠️ ORDER IS LOAD-BEARING, which is not obvious. This map's insertion order becomes the order of the
// trains array, which becomes the order of the <g> elements React renders. The obvious implementation —
// delete the line's entries, then set the new ones — moves EVERY surviving train on that line to the end
// of the map, because Map.set appends a key it has just deleted. MEASURED: refreshing one line moved 71
// of 255 keys, all 46 of that line's trains among them. React then reorders those DOM nodes, and a
// re-inserted element re-runs @starting-style — so the whole line replayed its 600ms fade-in every time
// it refreshed, which read as "the dots fade in whenever they update".
//
// So a surviving train is overwritten IN PLACE, which keeps its slot (Map.set on an existing key does not
// move it), and only genuinely new trains are appended — where a new element belongs, and where fading
// one in is exactly right.
export function mergeLineFeed(feed: Feed, lineId: string, vehicles: Vehicle[]): Map<string, Vehicle> {
  const incoming = new Map(vehicles.map((v) => [v.key, v]));
  const next = new Map<string, Vehicle>();
  for (const [key, held] of feed) {
    if (held.lineId !== lineId) {
      next.set(key, held);
      continue;
    }
    const fresh = incoming.get(key);
    if (fresh) {
      next.set(key, fresh);
      incoming.delete(key);
    }
  }
  for (const v of incoming.values()) next.set(v.key, v);
  return next;
}

export const nextLineIndex = (i: number, total: number): number => (i + 1) % total;

// ── Deriving a position (spec §5, amended — see the measurements below) ─────────────────────────────
//
// The spec's fallback ladder went: ambiguous branch -> glide from the last position toward `next`; no
// last position -> place it back along the segment by the elapsed fraction. BOTH were MEASURED AGAINST
// THE LIVE FEED AND REMOVED. A glide is a straight line to a station that can be most of London away, so
// it flew dots 34-208px off the network (and up to 1,859px between ticks); `reflectBehind` extrapolated
// past `next` by a whole segment vector, which is off-network whenever that vector is not a real
// adjacency. Both replaced by the invariant below, which is what the user actually wants:
//
//   A TRAIN IS ONLY EVER DRAWN ON A REAL DRAWN SEGMENT, OR STILL AT A REAL STATION. Nothing else.
//
// Structural resolution earns that: 78% of live trains (165-170 of 218) resolve a unique previous
// station, and those render a median 0-1.2px off the drawn line. Where the branch is genuinely ambiguous
// we now CHOOSE among the real candidates rather than leaving the network.

export const MIN_SEGMENT_SECONDS = 25;
export const MAX_SEGMENT_SECONDS = 300;

// A segment's duration comes from its LENGTH, not from the feed's timings. This looks like the weaker
// source and is in fact much the stronger, for two reasons:
//   - The gap between the two soonest predictions is the duration of the segment AFTER this one, and its
//     p10 is 27s against a typical eta several times that. 43% of live trains had eta > that gap, so
//     progress clamped to 0: the dot sat at the previous station and then raced the whole segment.
//   - It is STABLE. Geometry does not change between ticks, so `animation-duration` stops being
//     rewritten on every re-derive — which is what let ~170 animations re-set in unison every 11s.
// Calibrated so a median central-London segment (~74px) takes ~90s, against a median observed
// prediction gap of 105s.
export const NOMINAL_PX_PER_SECOND = 0.82;

// The bake measured each segment's arc ALONG THE SPLINE the animation actually runs on; the chord is
// only the fallback for a pair the table does not know (which in production means a bug — the contract
// test in scripts/trainSegments.test.mjs pins the table to the baked rules — but in the unit tests means
// a hand-built fixture, which is exactly when the chord is the right answer).
export function segmentSeconds(from: Point, to: Point, arcLength?: number): number {
  const px = arcLength ?? Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(MAX_SEGMENT_SECONDS, Math.max(MIN_SEGMENT_SECONDS, px / NOMINAL_PX_PER_SECOND));
}

const ARC_LENGTHS: Record<string, number> = SEGMENT_ARC_LENGTHS;

export type Placement =
  // On a drawn segment, playing that segment's baked @keyframes. from/to are carried for the frame test
  // and for choosing between ambiguous branches; the CURVE itself is the CSS rule's.
  | { kind: "segment"; name: string; reverse: boolean; seconds: number; progress: number; from: Point; to: Point }
  | { kind: "still"; at: Point };

// `resynced` marks a sighting whose position was INFERRED after a freeze rather than observed. See
// resyncSightings: a hidden window stops the animations but not the clock, so ageing a frozen placement
// invents a position the dot never actually reached. That is fine for choosing a branch (the two
// candidates are stations apart) but not for a correction, which needs the true rendered position to
// within a pixel — so corrections are skipped for one tick after a resync.
export interface Sighting { placement: Placement; atMs: number; resynced?: true }
export interface Correction { dx: number; dy: number }
export interface Train {
  key: string;
  vehicleId: string;
  lineId: string;
  placement: Placement;
  correction?: Correction;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

// How far along a branch the station-after-next may sit. Skip-stop services (the Metropolitan's
// fast/semi-fast trains) predict only their CALLING points, so requiring strict adjacency resolved
// nothing for them and parked the dot at `next` for minutes. 5 covers the Met's longest real
// non-stopping run (Harrow-on-the-Hill to Moor Park skips four stations — confirmed live, a train sat
// unresolved at exactly that depth); small enough that a pair matching only across half a line still
// reads as noise.
export const RESOLVE_WINDOW = 5;

// Which station a train on this line must have come from, given where it is going next and the station
// after that. The pair (next, after-next) is what distinguishes via-Bank from via-CX: no string
// matching, no cross-poll state. More than one answer means the branches genuinely disagree.
export function resolvePrevious(lineId: string, nextId: string, afterId: string, index = TUBE): string[] {
  const found = new Set<string>();
  for (const seq of index.sequencesByLine.get(lineId) ?? []) {
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].id !== nextId) continue;
      // The previous station is the IMMEDIATE neighbour on the OPPOSITE side from the station-after-next
      // — the after-next may be several stations along (skip-stop), but the track approaching `next` is
      // the same segment either way, which is the one the dot is drawn on.
      for (let j = 1; j <= RESOLVE_WINDOW; j++) {
        if (seq[i + j]?.id === afterId && seq[i - 1]) found.add(seq[i - 1].id);
        if (seq[i - j]?.id === afterId && seq[i + 1]) found.add(seq[i + 1].id);
      }
    }
  }
  return [...found];
}

// Where a placement has reached, `elapsedSeconds` after it was derived. Only ever used to CHOOSE between
// ambiguous branch candidates, so a segment is measured along its chord rather than its curve: the error
// is the few px §6.1 measures, which cannot change which of two stations is nearer.
export function placementPosition(placement: Placement, elapsedSeconds: number): Point {
  if (placement.kind === "still") return placement.at;
  const { from, to, seconds, progress } = placement;
  const f = clamp01(progress + (seconds > 0 ? elapsedSeconds / seconds : 1));
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
}

// Both branches are real track, so ANY candidate keeps the dot on the network — the only question is
// which is likelier. The one nearest where the train already was wins; with nothing to go on, the first
// is taken, which is deterministic (resolvePrevious walks the sequences in a fixed order) and therefore
// stable across ticks rather than flickering between two branches.
export function choosePrevious(candidates: string[], near: Point | null, index = TUBE): string | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  if (!near) return candidates[0];
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const id of candidates) {
    const at = index.stations.get(id);
    if (!at) continue;
    const d = Math.hypot(at.x - near.x, at.y - near.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
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
  const upcoming = v.predictions
    .map((p) => ({ id: p.naptanId, eta: p.timeToStation - age }))
    .filter((p) => p.eta > 0);

  // Its known journey has run out: every prediction we hold has expired, so we do NOT know where it is —
  // it may have terminated, or it may be running on beyond what this payload told us. Parking it at its
  // last known station invents a position, and MEASURED against the live feed that invention is one of
  // the biggest teleports in the system: the next refetch of that line finds the train somewhere else
  // and snaps it there. A dot quietly vanishing until its line refreshes is the honest render.
  if (!upcoming.length) return null;

  const next = upcoming[0];
  const nextAt = point(next.id);
  if (!nextAt) return null; // a station outside the baked set → drop the train (spec §5)

  // Not merely upcoming[1]: a looping line (the Circle) can predict the same station twice, and a
  // repeat says nothing about which way the train is facing.
  const after = upcoming.find((p) => p.id !== next.id);
  const afterAt = after ? point(after.id) : null;
  const wasAt = previous ? placementPosition(previous.placement, (nowMs - previous.atMs) / 1000) : null;
  const fromId = after && afterAt
    ? choosePrevious(resolvePrevious(v.lineId, next.id, after.id, index), wasAt, index)
    : null;
  const fromAt = fromId ? point(fromId) : null;

  // Nothing resolved — a single remaining prediction, or a pair that is adjacent on no branch of this
  // line. Hold at the station: it is the one place we KNOW is on the network.
  if (!fromId || !fromAt) return { kind: "still", at: nextAt };

  const { name, reverse } = segmentAnimation(fromId, next.id);
  const seconds = segmentSeconds(fromAt, nextAt, ARC_LENGTHS[name]);
  // eta longer than the segment takes means the train has not started it yet — it is dwelling back at
  // `from`, which is where clamping to 0 correctly parks it.
  return { kind: "segment", name, reverse, seconds, progress: clamp01(1 - next.eta / seconds), from: fromAt, to: nextAt };
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

// How far a re-derive may disagree with the running animation before it is worth interrupting it.
// 8% of a segment is a few px on a median segment — below noticing, and well above the jitter a fresh
// prediction produces.
export const PROGRESS_TOLERANCE = 0.08;

// The fix for "the whole map twitches every 11s". A re-derive that lands on the SAME segment at
// substantially the same place must emit the SAME style object, so React writes nothing and the running
// animation is never interrupted. Returning the previous placement (progress and all) is what makes the
// emitted style byte-identical; the caller must keep that sighting's original atMs with it, or the
// implied position would drift by one tick every tick.
export function keepRunning(previous: Sighting | undefined, next: Placement, nowMs: number): Placement {
  const p = previous?.placement;
  if (!p || p.kind !== "segment") return next;
  const impliedNow = p.progress + (nowMs - previous.atMs) / 1000 / p.seconds;
  if (next.kind === "still") {
    // A journey's LAST prediction resolves no station-after-next, so the fresh placement demotes to
    // "still at the destination" — but its eta > 0 says the train has demonstrably not arrived. While
    // the running segment still has ground to cover, keep it: snapping the dot forward to a station it
    // has not reached is wrong by up to a whole segment, and this is every train's end-of-journey state.
    return next.at.x === p.to.x && next.at.y === p.to.y && impliedNow < 1 ? p : next;
  }
  if (p.name !== next.name || p.reverse !== next.reverse || p.seconds !== next.seconds) return next;
  return Math.abs(impliedNow - next.progress) > PROGRESS_TOLERANCE ? next : p;
}

// The counterpart to keepRunning, for the one thing keepRunning cannot detect: a hidden window FREEZES
// the CSS animations but not the clock the derivation runs on, so on return every running animation is
// behind by however long we were away — and both sides of keepRunning's comparison are computed from
// that same clock, so they still agree and it keeps the stale placement. Demoting each sighting to a
// plain "still" at wherever it had got to states the truth (we know where the train was; nothing is
// running any more), which makes keepRunning re-emit every placement — it only ever keeps a segment —
// while choosePrevious keeps the position it needs to pick a branch. Harmless if a webview turns out
// not to freeze after all: the re-emitted delay is then the position the animation already held.
export function resyncSightings(previous: ReadonlyMap<string, Sighting>, nowMs: number): Map<string, Sighting> {
  const out = new Map<string, Sighting>();
  for (const [key, seen] of previous) {
    const at = placementPosition(seen.placement, (nowMs - seen.atMs) / 1000);
    out.set(key, { placement: { kind: "still", at }, atMs: nowMs, resynced: true });
  }
  return out;
}

// ── Correcting without jumping ──────────────────────────────────────────────────────────────────────

// How far a correction may reach before the train is snapped instead, in user units. It is bounded
// because a correction is the ONE place a dot leaves its line: it renders on the new segment's real curve
// displaced by a shrinking offset, so for the length of the slide it sits up to this far off the track.
// MEASURED over a full 121s refresh of all 11 lines: same-segment corrections run p50 17 / p90 43 /
// max 62, while the still<->segment re-places run p50 106 / max 367. 50 takes the first group and leaves
// the second to snap, which is the point — sliding those is §5's deleted glide in a shorter coat.
export const CORRECTION_LIMIT = 50;

// Below this a slide is not worth scheduling: the dot is already where it is going.
export const CORRECTION_MIN = 0.5;

// The offset that puts a re-placed train back where it was ALREADY being drawn, for the layer to decay
// to zero. Both ends are chord approximations (placementPosition), which is acceptable exactly where it
// matters most: when the two placements share a segment, the chord-vs-spline error is the same curve
// sampled at two nearby points, so it very largely cancels. Across different segments it does not cancel,
// but CORRECTION_LIMIT bounds those and the residual is a few px that the decay removes anyway.
export function correctionFor(
  previous: Sighting | undefined,
  placement: Placement,
  nowMs: number,
): Correction | undefined {
  if (!previous || previous.resynced) return undefined;
  const was = placementPosition(previous.placement, (nowMs - previous.atMs) / 1000);
  const now = placementPosition(placement, 0);
  const dx = was.x - now.x;
  const dy = was.y - now.y;
  const distance = Math.hypot(dx, dy);
  return distance > CORRECTION_LIMIT || distance < CORRECTION_MIN ? undefined : { dx, dy };
}

// One pass over the feed: every vehicle that can be placed yields a sighting (which is what the next
// pass compares against), and the ones near the frame also yield an element.
export function derivePlacements(
  feed: Feed,
  nowMs: number,
  previous: ReadonlyMap<string, Sighting>,
  index = TUBE,
): { trains: Train[]; sightings: Map<string, Sighting> } {
  const trains: Train[] = [];
  const sightings = new Map<string, Sighting>();
  for (const v of feed.values()) {
    const seen = previous.get(v.key);
    const fresh = resolvePlacement(v, nowMs, seen, index);
    if (!fresh) continue;
    const placement = keepRunning(seen, fresh, nowMs);
    const kept = placement === seen?.placement;
    // A kept animation keeps its ORIGINAL start time, so its implied position stays truthful.
    sightings.set(v.key, { placement, atMs: kept && seen ? seen.atMs : nowMs });
    if (placementVisible(placement)) {
      // Only a re-placed train can jump, and `undefined` for the rest is what keeps TrainDot's memo
      // bail-out intact: a kept train's props stay identical object-for-object.
      const correction = kept ? undefined : correctionFor(seen, placement, nowMs);
      trains.push({ key: v.key, vehicleId: v.vehicleId, lineId: v.lineId, placement, correction });
    }
  }
  return { trains, sightings };
}

// ── The handoff to CSS ──────────────────────────────────────────────────────────────────────────────

// The model carries numbers; the stylesheet owns the look (the same split as nightSky's *Style helpers).
// Note what is NOT here: reduced motion. A paused animation with a negative delay renders the exact
// point on the CURVE that a train has reached and never moves from it, so holding still is one rule in
// the stylesheet rather than a second code path with a chord-approximated position.
export function trainStyle(placement: Placement): CSSProperties {
  if (placement.kind === "still") {
    return { animationName: "none", transform: `translate(${placement.at.x}px, ${placement.at.y}px)` };
  }
  return {
    animationName: placement.name,
    animationDuration: `${placement.seconds}s`,
    animationDelay: `-${placement.progress * placement.seconds}s`,
    animationDirection: placement.reverse ? "reverse" : "normal",
  };
}
