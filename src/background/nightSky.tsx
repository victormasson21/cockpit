// nightSky.tsx — the "night sky" background variant: white glowing dots, some fixed and slowly
// breathing, some crossing the screen as shooting stars.
//
// The performance shape that matters: JS runs ONLY at a star's birth and death. All motion is one CSS
// animation per element, so the browser drives it on the compositor and the main thread is idle in
// between — no per-frame work behind the live terminals. Each star's glow is a STATIC radial gradient, so
// it rasterises once into that element's layer; only opacity and transform animate.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./nightSky.css";

// ── Configuration ──────────────────────────────────────────────────────────────────────────────────
// Every random element is a [min, max] range. Tune the sky here; nothing else needs to change.
type Range = readonly [min: number, max: number];

export const NIGHT_SKY = {
  fixed: {
    count: 70, // how many exist at once — a death immediately spawns a replacement
    size: [1, 2.6] as Range, // px, the dot itself
    // px, overall WIDTH of the halo — its gradient reaches zero alpha exactly at this diameter, so
    // there is never an edge against the sky. This and glowAlpha together are "how much glow".
    glow: [8, 26] as Range,
    glowAlpha: [0.45, 0.9] as Range, // brightness of the halo; the pair above is the knob to tune first
    peak: [0.35, 1] as Range, // opacity held between the fade in and the fade out
    life: [90, 240] as Range, // seconds from first appearance to fully gone
  },
  shooting: {
    // Long-run average rate. Arrivals are a Poisson process, so the gaps vary a lot around it — see
    // nextShootingGap.
    perMinute: 7,
    minGap: 0.9, // seconds; the floor that stops two streaks landing on top of each other
    maxConcurrent: 3, // hard ceiling on streaks in flight — the backstop against a burst
    size: [1.4, 2.6] as Range,
    glow: [12, 30] as Range, // px, halo width — a touch wider than fixed stars, they are the event
    glowAlpha: [0.6, 0.95] as Range,
    peak: [0.6, 1] as Range,
    travel: [45, 90] as Range, // vh of screen crossed before it dies
    duration: [1.1, 2.8] as Range, // seconds to cross
    // deg of travel: 0 = rightwards, 90 = straight down, 180 = leftwards. Spanning either side of 90
    // is what gives both down-right and down-left streaks; keep it inside (0, 180) so none fly upward.
    angle: [20, 160] as Range,
    tail: [25, 70] as Range, // px of streak trailing the head
  },
} as const;

// ── Pure star construction (unit-tested; the RNG is injected so tests are deterministic) ────────────

export type Rng = () => number; // contract: [0, 1)

export const pick = (r: Range, rng: Rng): number => r[0] + rng() * (r[1] - r[0]);

export interface FixedStar {
  id: string;
  leftPct: number; topPct: number;
  size: number; glow: number; glowAlpha: number; peak: number;
  life: number;
  age: number; // seconds already elapsed, applied as a negative delay
}

export interface ShootingStar {
  id: string;
  leftPct: number; topPct: number;
  size: number; glow: number; glowAlpha: number; peak: number;
  travel: number; duration: number; angle: number; tail: number;
}

// `age` is what stops the whole sky blooming in unison at launch: a star born with a negative delay is
// already part-way through its life, so the field looks established on the first frame.
export function makeFixedStar(id: string, rng: Rng, cfg = NIGHT_SKY.fixed, aged = true): FixedStar {
  const life = pick(cfg.life, rng);
  return {
    id,
    leftPct: rng() * 100,
    topPct: rng() * 100,
    size: pick(cfg.size, rng),
    glow: pick(cfg.glow, rng),
    glowAlpha: pick(cfg.glowAlpha, rng),
    peak: pick(cfg.peak, rng),
    life,
    age: aged ? rng() * life : 0,
  };
}

// Where a streak of this angle should start, horizontally. A leftward star born near the left edge spends
// most of its life clipped, so it starts on the side it is travelling AWAY from — which is what makes the
// crossing visible for its full duration rather than a flash at the margin.
export function startXPct(angle: number, rng: Rng): number {
  const dx = Math.cos((angle * Math.PI) / 180);
  if (dx < -0.15) return 55 + rng() * 45; // heading left → start right
  if (dx > 0.15) return rng() * 45; // heading right → start left
  return rng() * 100; // near-vertical → anywhere is fine
}

// Travel is applied along the streak's own axis in vh, so on a wide window a near-horizontal streak
// crosses far less of the frame than a vertical one covering the same number of units — which is why the
// sky reads as "mostly top-to-bottom" even though the angle is uniform. Stretching by the horizontal
// component evens out the fraction of the view each direction covers. Crossing TIME is unchanged, so
// shallow streaks are simply faster.
export const NOMINAL_ASPECT = 1.6; // a typical window; only sets how far shallow streaks are stretched

export function travelVh(base: number, angle: number, aspect = NOMINAL_ASPECT): number {
  const horizontal = Math.abs(Math.cos((angle * Math.PI) / 180));
  return base * (1 + (aspect - 1) * horizontal);
}

// Shooting stars start biased towards the upper screen, so they fall INTO the view rather than out of it.
export function makeShootingStar(id: string, rng: Rng, cfg = NIGHT_SKY.shooting): ShootingStar {
  const angle = pick(cfg.angle, rng);
  return {
    id,
    angle,
    leftPct: startXPct(angle, rng),
    topPct: rng() * 40,
    size: pick(cfg.size, rng),
    glow: pick(cfg.glow, rng),
    glowAlpha: pick(cfg.glowAlpha, rng),
    peak: pick(cfg.peak, rng),
    travel: travelVh(pick(cfg.travel, rng), angle),
    duration: pick(cfg.duration, rng),
    tail: pick(cfg.tail, rng),
  };
}

// Bounds the streaks in flight. Even with births paused while the window is hidden, a coalesced burst of
// timers must not be able to produce a swarm — dropping the extra spawn is right, because queueing it
// would just move the swarm later.
export function admitShootingStar(current: ShootingStar[], star: ShootingStar, max: number): ShootingStar[] {
  return current.length >= max ? current : [...current, star];
}

// Milliseconds until the next shooting star, drawn from an exponential distribution — i.e. arrivals are
// a Poisson process, like real meteors. Most gaps come in under the mean, long lulls happen occasionally,
// and streaks sometimes arrive in pairs. A uniform ±50% jitter (what this used to be) can do none of
// that: bounded gaps read as a metronome with wobble over a few minutes.
// `minGap` is the floor, so a pair never lands on top of itself.
export function nextShootingGap(cfg: { perMinute: number; minGap: number }, rng: Rng): number {
  const mean = 60_000 / cfg.perMinute;
  // rng() is [0, 1), so 1 - rng() is (0, 1] — the log is always defined and the gap never negative.
  return Math.max(cfg.minGap * 1000, -mean * Math.log(1 - rng()));
}

// The models carry numbers; the CSS owns the look. Custom properties are the handoff.
export function fixedStarStyle(s: FixedStar): CSSProperties {
  return {
    left: `${s.leftPct}%`, top: `${s.topPct}%`,
    width: `${s.size}px`, height: `${s.size}px`,
    animationDuration: `${s.life}s`,
    animationDelay: `-${s.age}s`,
    "--peak": String(s.peak),
    "--glow": `${s.glow}px`,
    "--glow-alpha": String(s.glowAlpha),
  } as CSSProperties;
}

export function shootingStarStyle(s: ShootingStar): CSSProperties {
  return {
    left: `${s.leftPct}%`, top: `${s.topPct}%`,
    width: `${s.size}px`, height: `${s.size}px`,
    animationDuration: `${s.duration}s`,
    "--peak": String(s.peak),
    "--glow": `${s.glow}px`,
    "--glow-alpha": String(s.glowAlpha),
    "--angle": `${s.angle}deg`,
    "--travel": `${s.travel}vh`,
    "--tail": `${s.tail}px`,
  } as CSSProperties;
}

// ── Component ──────────────────────────────────────────────────────────────────────────────────────

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Honours the variant contract's "hold still": the sky becomes a static starfield, no births, no motion.
function useStillSky(): boolean {
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

// A hidden window freezes CSS animations but keeps timers running, so births would continue while deaths
// (which are animationend firing) could not — the streaks piled up and then all animated at once on
// return. This is the signal that stops that. Note it is VISIBILITY, not focus: an unfocused but visible
// window still animates normally, and the sky is meant to be ambient, so pausing on mere blur would stop
// it while you can plainly see it.
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export function NightSky() {
  const still = useStillSky();
  const visible = useVisible();
  const seq = useRef(0);
  const nextId = () => `s${seq.current++}`;
  // Built once, lazily: re-running this on every render would reshuffle the whole sky.
  const [fixed, setFixed] = useState<FixedStar[]>(() =>
    Array.from({ length: NIGHT_SKY.fixed.count }, () => makeFixedStar(`s${seq.current++}`, Math.random)),
  );
  const [shooting, setShooting] = useState<ShootingStar[]>([]);

  // Each shooting star schedules the next one, so every gap is a fresh draw from the distribution.
  useEffect(() => {
    if (still) return;
    // Hidden: stop giving birth, and drop anything mid-flight — a frozen streak would otherwise resume
    // together with the rest the moment the window comes back.
    if (!visible) {
      setShooting((prev) => (prev.length ? [] : prev));
      return;
    }
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setShooting((prev) => admitShootingStar(prev, makeShootingStar(nextId(), Math.random), NIGHT_SKY.shooting.maxConcurrent));
        schedule();
      }, nextShootingGap(NIGHT_SKY.shooting, Math.random));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [still, visible]);

  return (
    <div className="ns">
      {fixed.map((s) => (
        <div
          key={s.id}
          className={`ns__star${still ? "" : " ns__star--fixed"}`}
          style={fixedStarStyle(s)}
          // A finished life is replaced in place: the population stays constant and the spent element
          // is dropped by React (a new id means a new node, so nothing accumulates).
          onAnimationEnd={() => setFixed((prev) => prev.map((p) => (p.id === s.id ? makeFixedStar(nextId(), Math.random, NIGHT_SKY.fixed, false) : p)))}
        />
      ))}
      {shooting.map((s) => (
        <div
          key={s.id}
          className="ns__star ns__star--shooting"
          style={shootingStarStyle(s)}
          onAnimationEnd={() => setShooting((prev) => prev.filter((p) => p.id !== s.id))}
        />
      ))}
    </div>
  );
}
