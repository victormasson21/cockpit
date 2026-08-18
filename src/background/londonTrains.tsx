// londonTrains.tsx — the live-trains layer for the "London map · live" variant: one line-coloured dot
// per Underground train, placed from TfL's arrival predictions.
//
// The performance shape that matters: JS runs once per tick to fetch ONE line (~350 KB) and re-derive
// placements. Every dot's motion is a pre-baked per-segment CSS animation, so the compositor owns all of
// it and the main thread is idle in between — no per-frame work behind the live terminals.
//
// It renders a FRAGMENT, not an <svg>: the component is passed as londonMap's child and lands inside the
// tube <g>, so it inherits the map's viewBox and drift for free and needs no projection of its own.
import { memo, useEffect, useRef, useState } from "react";
import {
  arrivalsUrl, derivePlacements, mergeLineFeed, nextLineIndex, parseArrivals, trainStyle,
  TUBE_LINE_IDS, type Feed, type Placement, type Sighting, type Train,
} from "./londonTrainsModel";
import "./londonTrains.css";
import "./londonTrainSegments.data.css";

// One line per tick, all 11 refreshed about every two minutes. Slow polling is affordable because each
// vehicle arrives with its whole onward journey, so a fetch keeps a train moving for minutes (spec §4);
// the tick doubles as the re-derive, which is what advances a train from one segment to the next.
const TICK_MS = 11_000;

// The HALO's radius, in user units — so a dot scales with the viewBox fit like the map's glow radius, and
// unlike its strokes (which `vector-effect` pins to device pixels). At a typical ~0.79 fit that is ~6.7px
// device radius: a ~13px glow around a ~2px solid core, the core's share being SOLID_STOP below.
const TRAIN_RADIUS = 8.5;

// Where the solid core ends, as a fraction of the radius — 15% of ~6.7px is a ~2px core. Note this
// fraction has to SHRINK whenever the glow widens, or the core grows with it. The halo picks up
// a hair later (HALO_STOP) rather than at the same offset, because two stops at an identical offset are
// not reliably rendered; the gap is deliberately far too small to read as a ramp, which is the point. A
// core this small CANNOT look crisp if the gradient fades from the centre outwards, so the drop from
// solid to halo is a hard edge. That is not the "hard rim" the glow avoids — that rule is about the
// halo's OUTER edge, which still fades to zero alpha.
const SOLID_STOP = 0.15;
const HALO_STOP = 0.155;
const HALO_MID_STOP = 0.4;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Honours the variant contract's "hold still". A duplicate of nightSky's hook, deliberately: variants are
// independent units that must stay separately deletable, and a dozen lines is a cheaper price for that
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
// megabytes to move dots nobody can see, and every train would jump on return. VISIBILITY, not focus: an
// unfocused but visible window still animates, and a background is meant to be ambient.
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

// Memoised, which is worth real frames here: a tick re-derives all ~270 trains, but keepRunning returns
// the SAME placement OBJECT for every train whose animation is still valid (about 60% of them), so a
// shallow prop compare bails out of those entirely — no re-render, no style write, no DOM touch. Without
// this, every dot on screen is reconciled every 11 seconds. It only works because that object identity is
// deliberately preserved; if keepRunning ever starts returning fresh equal objects, this silently
// degrades to reconciling everything again.
const TrainDot = memo(function TrainDot({ lineId, placement }: { lineId: string; placement: Placement }) {
  return <circle className={`lt__train lt__train--${lineId}`} r={TRAIN_RADIUS} style={trainStyle(placement)} />;
});

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
      // there is no animation to drive and nothing that may move, so there is nothing left to poll for.
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
      {/* One gradient per line, colour-free: the stops take their colour from the stylesheet, which is
          what keeps the 11 hexes out of this file. The OFFSETS are the dot's shape — see SOLID_STOP. */}
      <defs>
        {TUBE_LINE_IDS.map((lineId) => (
          <radialGradient key={lineId} id={`lt-g-${lineId}`}>
            <stop className="lt__stop--core" offset="0" />
            <stop className="lt__stop--solid" offset={SOLID_STOP} />
            <stop className="lt__stop--halo" offset={HALO_STOP} />
            <stop className="lt__stop--halo-mid" offset={HALO_MID_STOP} />
            <stop className="lt__stop--edge" offset="1" />
          </radialGradient>
        ))}
      </defs>
      {/* Keyed per train so React reuses an element across refreshes and its animation survives. The key
          is line-scoped: vehicleId alone collides across lines (see vehicleKey), which would make two
          different trains share one element. */}
      {trains.map((train) => (
        <TrainDot key={train.key} lineId={train.lineId} placement={train.placement} />
      ))}
    </>
  );
}
