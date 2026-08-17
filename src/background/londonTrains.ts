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
