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
