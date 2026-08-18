// londonTrains.tsx — the live-trains layer for the "London map · live" variant: one line-coloured dot
// per Underground train, placed from TfL's arrival predictions.
//
// The performance shape that matters: JS runs once per tick to fetch ONE line (~350 KB) and re-derive
// placements. Every dot's motion is a pre-baked per-segment CSS animation, so the compositor owns all of
// it and the main thread is idle in between — no per-frame work behind the live terminals.
//
// It renders a <g>, not an <svg>: the component is passed as londonMap's child and lands inside the
// tube <g>, so it inherits the map's viewBox and drift for free and needs no projection of its own.
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  arrivalsUrl, derivePlacements, mergeLineFeed, nextLineIndex, parseArrivals, resyncSightings,
  project, STALE_SECONDS, trainStyle, TUBE_LINE_IDS,
  type Correction, type Feed, type Placement, type Sighting, type Train,
} from "./londonTrainsModel";
import "./londonTrains.css";
import "./londonTrainSegments.data.css";

// One line per tick, all 11 refreshed about every two minutes. Slow polling is affordable because each
// vehicle arrives with its whole onward journey, so a fetch keeps a train moving for minutes (spec §4);
// the tick doubles as the re-derive, which is what advances a train from one segment to the next.
const TICK_MS = 11_000;

// The cadence used until every line has been fetched once — a cold start, or coming back from a spell
// away long enough that the stale predictions were dropped. It refills the whole map in ~15s rather than
// the ~2min the idle rota takes, without ever fetching two lines at once (all 11 together is 3.9 MB and
// one long parse on the main thread, which is why the rota exists at all).
const CATCH_UP_MS = 1_500;

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

// The vehicle id's offset from the dot's centre, in the same user units as TRAIN_RADIUS — so the label
// sits bottom-right of the core, inside the faint outer third of the halo rather than beyond it. These
// are the GEOMETRY half of the label; its size and colour are the stylesheet's (as with the gradient
// stops above). y is a text BASELINE, so it clears the core by more than the number suggests.
const LABEL_DX = 5;
const LABEL_DY = 9;

// How long a re-placed train takes to slide onto its corrected position. Short enough to read as a train
// catching up — which is real behaviour, trains do speed up and slow down — rather than as a dot drifting.
const CORRECTION_MS = 250;

// Where the rota indicator sits — a real place on the map rather than a screen corner, projected through
// the baked projection so it lands exactly where the map would have drawn it. Being inside the tube <g>
// it inherits the map's drift, which is what a marker pinned to the ground should do.
const NEXT_LINE_AT = project(51.5221942, -0.0411387);

// User units like TRAIN_RADIUS, so the marker scales with the viewBox fit rather than staying a fixed
// device size — at a typical ~0.79 fit, 3.2 reads as a ~5px dot.
const NEXT_LINE_RADIUS = 3.2;

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
const TrainDot = memo(function TrainDot(
  { lineId, vehicleId, placement, correction, still }: {
    lineId: string;
    vehicleId: string;
    placement: Placement;
    correction?: Correction;
    still: boolean;
  },
) {
  const group = useRef<SVGGElement>(null);
  // Absorb a re-place instead of jumping to it. The @keyframes drive `transform`, and a running animation
  // outranks any transition on the same property — so the offset rides the SEPARATE `translate` property,
  // which COMPOSES with transform rather than competing for it. The dot therefore follows the new
  // segment's real splined curve throughout, merely displaced by a vanishing offset; it is never tweened
  // along a straight line between two points, which is what would take it off its line.
  //
  // WAAPI rather than a CSS transition because a transition needs two RENDERED values, i.e. a second
  // React render per corrected train on every tick. A webview without the `translate` property drops the
  // keyframe and simply snaps, which is the behaviour this replaces.
  //
  // Layout effect, not effect: the offset has to be in place before the browser paints the new
  // `transform`, or the dot is visible at its corrected position for one frame before sliding back.
  useLayoutEffect(() => {
    if (!correction || still || !group.current) return;
    group.current.animate(
      [{ translate: `${correction.dx}px ${correction.dy}px` }, { translate: "0px 0px" }],
      { duration: CORRECTION_MS, easing: "ease-out" },
    );
  }, [correction, still]);
  // The segment animation drives the <g>, NOT the circle: the dot and its label then move as one
  // element, so they cannot drift apart the way two separately-animated siblings could. The label needs
  // no transform of its own — a plain x/y in the same user space rides along with the group.
  return (
    <g ref={group} className="lt__vehicle" style={trainStyle(placement)}>
      <circle className={`lt__train lt__train--${lineId}`} r={TRAIN_RADIUS} />
      <text className={`lt__label lt__label--${lineId}`} x={LABEL_DX} y={LABEL_DY}>
        {vehicleId}
      </text>
    </g>
  );
});

export function LondonTrains() {
  const still = useStillTrains();
  const visible = useVisible();
  // Refs, not state: the feed and the sightings are the tick's own working memory, and re-rendering on
  // every change to them would defeat the point of only re-rendering once a tick.
  const feed = useRef<Feed>(new Map());
  const sightings = useRef<ReadonlyMap<string, Sighting>>(new Map());
  const rota = useRef(0);
  // When each line last came back, which is NOT derivable from the feed: a line running no trains (late
  // at night, or a suspension) has no vehicles to carry a fetchedAt, so it would read as never fetched
  // and hold the catch-up cadence open for ever.
  const lineFetchedAt = useRef(new Map<string, number>());
  const [trains, setTrains] = useState<Train[]>([]);
  // Which line the rota refreshes next, for the indicator below. State rather than a ref, because unlike
  // the feed it is rendered; it lands in the same batch as setTrains, so it costs no extra render.
  const [nextLine, setNextLine] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Becoming visible ends a freeze, and a frozen animation is exactly what the derivation cannot see.
    sightings.current = resyncSightings(sightings.current, Date.now());
    let cancelled = false;
    let passes = 0;
    let hurries = 0;
    let timer = 0;
    // Aborted on unmount, on hide, and when the variant is switched away — a line's payload is ~350 KB,
    // and without this it keeps downloading for a layer that no longer exists.
    const controller = new AbortController();
    // Any line whose trains would already have been dropped as stale, plus any never fetched at all.
    const missingLine = (now: number) =>
      TUBE_LINE_IDS.some((id) => now - (lineFetchedAt.current.get(id) ?? 0) > STALE_SECONDS * 1000);
    const tick = async () => {
      const lineId = TUBE_LINE_IDS[rota.current];
      rota.current = nextLineIndex(rota.current, TUBE_LINE_IDS.length);
      // Set as soon as the rota turns, not when the next tick fires, so the indicator names the line for
      // the whole wait rather than for the instant it is fetched.
      setNextLine(TUBE_LINE_IDS[rota.current]);
      let fetched = false;
      try {
        const response = await fetch(arrivalsUrl(lineId), { signal: controller.signal });
        if (!response.ok) throw new Error(`TfL ${response.status}`);
        const vehicles = parseArrivals(await response.json(), lineId, Date.now());
        if (cancelled) return;
        feed.current = mergeLineFeed(feed.current, lineId, vehicles);
        lineFetchedAt.current.set(lineId, Date.now());
        fetched = true;
      } catch {
        // A background has nowhere to show an error (spec §7): keep the last known positions and try
        // again next tick. Never having succeeded at all is simply the static map. An abort lands here
        // too, and is caught by the `cancelled` guard below rather than by inspecting the error.
      }
      if (cancelled) return;
      const now = Date.now();
      const derived = derivePlacements(feed.current, now, sightings.current);
      sightings.current = derived.sightings;
      setTrains(derived.trains);
      // Reduced motion: one pass over the rota places every train, and then ticking stops for good —
      // there is no animation to drive and nothing that may move, so there is nothing left to poll for.
      // Nulled so the indicator goes out with it: nothing will refresh again, and a dot naming a line
      // that never updates is a small standing lie.
      if (still && ++passes >= TUBE_LINE_IDS.length) {
        setNextLine(null);
        return;
      }
      // Hurry only while the map is genuinely short of a line, and only off the back of a fetch that
      // WORKED, and at most one pass per return-to-visible. All three bounds matter, because this is the
      // one way a deliberately polite poller could become rude: without the second, an API that is down
      // leaves every line missing for ever; without the third, so does a SINGLE line that persistently
      // errors while the other ten succeed — `missingLine` would stay true and the fast cadence would
      // never stand down. The cap makes the request rate provably bounded whatever TfL does: at most 11
      // extra requests per return, then the idle cadence, which still refills the map.
      const hurry = fetched && hurries < TUBE_LINE_IDS.length && missingLine(now);
      if (hurry) hurries++;
      timer = window.setTimeout(() => void tick(), hurry ? CATCH_UP_MS : TICK_MS);
    };
    // Self-scheduling, NOT setInterval: each tick books the next only once it has finished, so a fetch
    // slower than TICK_MS can never overlap the one behind it — two derives racing to place the same
    // trains, off the same feed, in an order neither controls.
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [visible, still]);

  return (
    // A <g> rather than a fragment, purely so the layer has a class: londonTrains.css dims the map's
    // white tube halo under `.lm:has(.lt)`, i.e. on this LAYER being mounted. Keying that on a train
    // element instead would tie the map's brightness to the data — a visible pop when the first
    // response lands, and no dimming at all offline, which is the one case the tube is on its own.
    <g className="lt">
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
      {/* The rota indicator, at a fixed geographic point (NEXT_LINE_AT). Its colour is set inline as
          var(--lt-<line>) rather than as a twelfth per-line rule: the palette states each hex once, and a
          mechanical id-to-colour mapping would only repeat what the id already says. Drawn after the
          trains so a dot passing through cannot hide it. */}
      {trains.map((train) => (
        <TrainDot
          key={train.key}
          lineId={train.lineId}
          vehicleId={train.vehicleId}
          placement={train.placement}
          correction={train.correction}
          still={still}
        />
      ))}
      {nextLine && (
        <circle
          className="lt-next"
          cx={NEXT_LINE_AT.x}
          cy={NEXT_LINE_AT.y}
          r={NEXT_LINE_RADIUS}
          style={{ fill: `var(--lt-${nextLine})` }}
        />
      )}
    </g>
  );
}
