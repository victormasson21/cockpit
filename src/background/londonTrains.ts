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
