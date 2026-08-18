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
} from "./londonTrainsModel";
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
      {/* Keyed per train so React reuses an element across refreshes and its animation survives. The key
          is line-scoped: vehicleId alone collides across lines (see vehicleKey), which would make two
          different trains share one element. */}
      {trains.map((train) => (
        <circle
          key={train.key}
          className={`lt__train lt__train--${train.lineId}`}
          r={TRAIN_RADIUS}
          style={trainStyle(train.placement)}
        />
      ))}
    </>
  );
}
